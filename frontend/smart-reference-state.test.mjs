import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const smartCanvasPath = fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url));
const smartCanvasSource = readFileSync(smartCanvasPath, 'utf8');

function extractFunction(name){
    const markers = [`function ${name}(`, `async function ${name}(`];
    const starts = markers.map(marker => smartCanvasSource.indexOf(marker)).filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `missing production function ${name}`);
    const start = Math.min(...starts);
    const bodyStart = smartCanvasSource.indexOf('{', start);
    let depth = 0;
    let state = 'code';
    let escaped = false;
    for(let index = bodyStart; index < smartCanvasSource.length; index++){
        const char = smartCanvasSource[index];
        const next = smartCanvasSource[index + 1];
        if(state === 'line-comment'){
            if(char === '\n') state = 'code';
            continue;
        }
        if(state === 'block-comment'){
            if(char === '*' && next === '/'){
                state = 'code';
                index++;
            }
            continue;
        }
        if(state !== 'code'){
            if(escaped){
                escaped = false;
                continue;
            }
            if(char === '\\'){
                escaped = true;
                continue;
            }
            if((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) state = 'code';
            continue;
        }
        if(char === '/' && next === '/'){
            state = 'line-comment';
            index++;
            continue;
        }
        if(char === '/' && next === '*'){
            state = 'block-comment';
            index++;
            continue;
        }
        if(char === "'"){
            state = 'single';
            continue;
        }
        if(char === '"'){
            state = 'double';
            continue;
        }
        if(char === '`'){
            state = 'template';
            continue;
        }
        if(char === '{') depth++;
        if(char === '}' && --depth === 0) return smartCanvasSource.slice(start, index + 1);
    }
    assert.fail(`unterminated production function ${name}`);
}

function loadProductionFunctions(names, context={}){
    const sandbox = vm.createContext({...context});
    const exports = names.map(name => `${name}:${name}`).join(',');
    vm.runInContext(`${names.map(extractFunction).join('\n')}\nglobalThis.__functions = {${exports}};`, sandbox);
    return {sandbox, ...sandbox.__functions};
}

test('buildPromptRequest preserves upstream provenance in the refs saved for reruns', () => {
    let promptParts = [];
    const {buildPromptRequest} = loadProductionFunctions(['smartGenerationRequestRef', 'buildPromptRequest'], {
        collectPromptParts:() => promptParts,
        originalPromptTextFromParts:() => '',
        blockedInputRefKeys:() => new Set(),
        defaultReferenceImagesFor:() => [],
        uniqueReferenceImages:refs => refs.map(ref => ({...ref})),
        inputRefKey:ref => `${ref.nodeId || ''}|${ref.imageIndex ?? ''}|${ref.url || ''}`,
        promptReferenceKind:ref => ref.kind || 'image',
        promptMentionTokenLabel:(kind, index) => `${kind}${index}`,
        venicePromptReferenceLabel:(kind, index) => `@${kind}${index}`,
        smartOriginalMediaUrl:ref => ref?.url || '',
        isSmartGroupNode:() => false,
        textForNode:() => '',
        inputPromptTextFor:() => '',
        mediaKindForItem:ref => ref.kind || 'image',
        settings:{engine:'api'},
        SMART_REFERENCE_IMAGE_MAX:10
    });
    const request = buildPromptRequest(
        {id:'target'},
        [
            {url:'/a.png', name:'A', nodeId:'source-a', imageIndex:0, kind:'image'},
            {url:'/b.png', name:'B', nodeId:'source-b', imageIndex:0, kind:'image'}
        ],
        false,
        null
    );
    assert.deepEqual(
        request.refs.map(ref => ({url:ref.url, nodeId:ref.nodeId, imageIndex:ref.imageIndex})),
        [
            {url:'/a.png', nodeId:'source-a', imageIndex:0},
            {url:'/b.png', nodeId:'source-b', imageIndex:0}
        ]
    );

    promptParts = [{type:'image', url:'/mentioned.png', name:'mentioned', kind:'image'}];
    const mentionedRequest = buildPromptRequest(
        {id:'target'},
        [{url:'/a.png', name:'A', nodeId:'source-a', imageIndex:0, kind:'image'}],
        false,
        null
    );
    const mentionedRef = Array.from(mentionedRequest.refs).find(ref => ref.url === '/mentioned.png');
    assert.equal(mentionedRef.promptMentioned, true);
});

test('partial upstream disconnect prunes both provenanced and legacy stale refs', () => {
    const target = {
        id:'target',
        runInputRefs:[
            {url:'/a.png', name:'A'},
            {url:'/b.png', name:'B'}
        ]
    };
    const nodes = [
        {id:'source-a', images:[{url:'/a.png'}]},
        {id:'source-b', images:[{url:'/b.png'}]},
        target
    ];
    const loaded = loadProductionFunctions([
        'canonicalSmartMediaUrlSet',
        'savedRunInputLiveStateForNode',
        'shouldKeepSavedRunInputRef',
        'liveSavedRunInputRefsForNode',
        'pruneStaleSavedRunInputRefs'
    ], {
        nodes,
        canonicalSmartMediaUrl:ref => typeof ref === 'string' ? ref : ref?.url || '',
        upstreamLineNodeIds:node => node.id === 'target' ? ['source-a', 'target'] : [node.id],
        imagesForNode:node => (node?.images || []).map((image, imageIndex) => ({...image, nodeId:node.id, imageIndex})),
        isHistoryGroupNode:node => Boolean(node?.historyFor),
        manualReferenceImagesFor:() => [],
        collectMentionedImagesFromPrompt:() => []
    });
    assert.equal(loaded.pruneStaleSavedRunInputRefs(target), true);
    assert.deepEqual(target.runInputRefs.map(ref => ref.url), ['/a.png']);

    target.runInputRefs = [
        {url:'/a.png', nodeId:'source-a', imageIndex:0},
        {url:'/b.png', nodeId:'source-b', imageIndex:0}
    ];
    assert.equal(loaded.pruneStaleSavedRunInputRefs(target), true);
    assert.deepEqual(target.runInputRefs.map(ref => ref.url), ['/a.png']);
});

for(const priorRunFailed of [false, true]){
    test(`video request body contains only the live image after a ${priorRunFailed ? 'failed' : 'successful'} prior run`, async () => {
        const capturedRequests = [];
        const target = {
            id:'target',
            runFailed:priorRunFailed,
            runInputRefs:[
                {url:'/a.png', name:'A'},
                {url:'/b.png', name:'B'}
            ]
        };
        const nodes = [
            {id:'source-a', images:[{url:'/a.png', name:'A', kind:'image'}]},
            {id:'source-b', images:[{url:'/b.png', name:'B', kind:'image'}]},
            target
        ];
        const loaded = loadProductionFunctions([
            'canonicalSmartMediaUrlSet',
            'savedRunInputLiveStateForNode',
            'shouldKeepSavedRunInputRef',
            'liveSavedRunInputRefsForNode',
            'isGeneratedSmartOutputNode',
            'generationReferenceImagesForRun',
            'visibleReferenceImagesFor',
            'videoProviderDescriptor',
            'videoCapabilitiesFor',
            'runApiVideoGeneration'
        ], {
            nodes,
            settings:{},
            apiProviders:[],
            smartLoopContext:null,
            transientSmartCloudLinks:[],
            canonicalSmartMediaUrl:ref => typeof ref === 'string' ? ref : ref?.url || '',
            upstreamLineNodeIds:node => node.id === 'target' ? ['source-a', 'target'] : [node.id],
            imagesForNode:node => (node?.images || []).map((image, imageIndex) => ({...image, nodeId:node.id, imageIndex})),
            isHistoryGroupNode:node => Boolean(node?.historyFor),
            manualReferenceImagesFor:() => [],
            collectMentionedImagesFromPrompt:() => [],
            promptReferenceImagesFor:() => [],
            defaultReferenceImagesFor:() => [{url:'/a.png', name:'A', nodeId:'source-a', imageIndex:0, kind:'image'}],
            isSmartImageNode:() => true,
            smartImageUsesWorkflowInput:() => false,
            cleanSavedRunRefsForNode:(node, refs) => refs,
            uniqueReferenceImages:refs => {
                const seen = new Set();
                return refs.filter(ref => ref?.url && !seen.has(ref.url) && seen.add(ref.url));
            },
            isVeniceVideoProvider:() => false,
            videoProviderById:providerId => ({id:providerId, protocol:'openai', base_url:'https://example.test/v1'}),
            volcengineProvider:() => ({id:'volcengine', protocol:'volcengine'}),
            beginVeniceCreditsFastRefresh:() => null,
            endVeniceCreditsFastRefresh:() => {},
            applyUploadedUrlsToSmartRefs:refs => refs,
            videoProviderPlatform:() => 'custom-api',
            imageRefsOnly:refs => refs.filter(ref => ref?.kind === 'image'),
            videoRefsOnly:() => [],
            audioRefsOnly:() => [],
            manualSmartVideoLink:() => null,
            manualSmartMediaLinks:() => [],
            normalizeVeniceVideoAspect:value => value,
            smartLogActualGenerationRequest:() => {},
            resultMediaUrls:result => result.videos || [],
            scheduleVeniceCreditsRefresh:() => {},
            smartResponseErrorMessage:async () => 'request failed',
            tr:key => key,
            toast:() => {},
            JimengPendingSignal:class JimengPendingSignal extends Error {},
            fetch:async (url, options) => {
                capturedRequests.push({url, options});
                return {ok:true, json:async () => ({videos:['/output.mp4']})};
            }
        });
        const refs = loaded.generationReferenceImagesForRun(target, true, null);
        assert.deepEqual(Array.from(refs, ref => ref.url), ['/a.png']);
        const visibleRefs = loaded.visibleReferenceImagesFor(target);
        assert.deepEqual(Array.from(visibleRefs, ref => ref.url), ['/a.png']);

        await loaded.runApiVideoGeneration('prompt', refs, {
            videoProvider:'custom-api',
            videoModel:'seedance-2-0-enhanced-reference-to-video',
            videoDuration:1,
            videoAspect:'9:16',
            videoResolution:'480p'
        }, {});

        assert.equal(capturedRequests.length, 1);
        assert.equal(capturedRequests[0].url, '/api/canvas-video');
        const body = JSON.parse(capturedRequests[0].options.body);
        assert.deepEqual(body.images.map(image => image.url), ['/a.png']);
        assert.equal(body.images.length, 1);
        assert.equal(body.duration, 4);
    });
}

test('video frame-role mode accepts one or two images but not zero or three', () => {
    const {canUseVideoFrameRoles} = loadProductionFunctions(['canUseVideoFrameRoles']);
    const supported = {frameRoles:true};
    assert.equal(canUseVideoFrameRoles(supported, 0), false);
    assert.equal(canUseVideoFrameRoles(supported, 1), true);
    assert.equal(canUseVideoFrameRoles(supported, 2), true);
    assert.equal(canUseVideoFrameRoles(supported, 3), false);
    assert.equal(canUseVideoFrameRoles({frameRoles:false}, 1), false);
});

test('Venice video capabilities expose only parameters consumed by its request adapter', () => {
    const loaded = loadProductionFunctions(['videoProviderDescriptor', 'videoCapabilitiesFor'], {
        settings:{},
        apiProviders:[{id:'venice-test', protocol:'venice', base_url:'https://api.venice.ai/api/v1'}],
        videoProviderById:providerId => ({id:providerId, protocol:'venice', base_url:'https://api.venice.ai/api/v1'}),
        volcengineProvider:() => ({id:'volcengine', protocol:'volcengine'})
    });
    const caps = loaded.videoCapabilitiesFor({videoProvider:'venice-test', videoModel:'seedance'});
    assert.deepEqual({...caps.duration}, {min:4, max:15});
    assert.equal(caps.generateAudio, true);
    assert.equal(caps.enhancePrompt, false);
    assert.equal(caps.enableUpsample, false);
    assert.equal(caps.watermark, false);
    assert.equal(caps.cameraFixed, false);
    assert.equal(caps.frameRoles, false);
    assert.equal(caps.trustedAsset, false);
});

test('Venice credit fast refresh is scoped to Venice providers only', () => {
    const activeRequests = new Set();
    const refreshes = [];
    const context = {
        veniceCreditsActiveRequests:activeRequests,
        veniceCreditsFastRefreshUntil:0,
        veniceCreditsNextAutoRetryAt:123,
        VENICE_CREDITS_FAST_TAIL_MS:30000,
        isVeniceProviderId:providerId => providerId === 'venice',
        refreshVeniceCredits:options => refreshes.push(options)
    };
    const loaded = loadProductionFunctions([
        'beginVeniceCreditsFastRefresh',
        'endVeniceCreditsFastRefresh'
    ], context);

    const nonVeniceToken = loaded.beginVeniceCreditsFastRefresh('custom-api');
    assert.equal(nonVeniceToken, null);
    assert.equal(activeRequests.size, 0);
    assert.deepEqual(refreshes, []);

    loaded.endVeniceCreditsFastRefresh(nonVeniceToken);
    assert.equal(activeRequests.size, 0);
    assert.equal(loaded.sandbox.veniceCreditsFastRefreshUntil, 0);

    const veniceToken = loaded.beginVeniceCreditsFastRefresh('venice');
    assert.equal(typeof veniceToken, 'symbol');
    assert.equal(activeRequests.size, 1);
    assert.equal(refreshes.length, 1);
    assert.equal(refreshes[0].providerId, 'venice');
    assert.equal(refreshes[0].automatic, true);
    assert.equal(refreshes[0].fast, true);

    loaded.endVeniceCreditsFastRefresh(veniceToken);
    assert.equal(activeRequests.size, 0);
    assert.ok(loaded.sandbox.veniceCreditsFastRefreshUntil > Date.now());
});

test('legacy uploaded self-reference survives while removed manual and prompt refs do not', () => {
    const target = {
        id:'target',
        runInputRefs:[
            {url:'/self-original.png', name:'original'},
            {url:'/manual.png', manualAdded:true},
            {url:'/mentioned.png', promptMentioned:true}
        ]
    };
    const nodes = [
        target,
        {id:'target-history', historyFor:'target', images:[{url:'/self-original.png'}]}
    ];
    const loaded = loadProductionFunctions([
        'canonicalSmartMediaUrlSet',
        'savedRunInputLiveStateForNode',
        'shouldKeepSavedRunInputRef',
        'liveSavedRunInputRefsForNode',
        'pruneStaleSavedRunInputRefs'
    ], {
        nodes,
        canonicalSmartMediaUrl:ref => typeof ref === 'string' ? ref : ref?.url || '',
        upstreamLineNodeIds:node => [node.id],
        imagesForNode:node => (node?.images || []).map((image, imageIndex) => ({...image, nodeId:node.id, imageIndex})),
        isHistoryGroupNode:node => Boolean(node?.historyFor),
        manualReferenceImagesFor:() => [],
        collectMentionedImagesFromPrompt:() => []
    });
    assert.equal(loaded.pruneStaleSavedRunInputRefs(target), true);
    assert.deepEqual(target.runInputRefs.map(ref => ref.url), ['/self-original.png']);
});

test('current manual or prompt reference remains valid without an upstream line', () => {
    const target = {id:'target'};
    const nodes = [target];
    const loaded = loadProductionFunctions([
        'canonicalSmartMediaUrlSet',
        'savedRunInputLiveStateForNode',
        'shouldKeepSavedRunInputRef',
        'liveSavedRunInputRefsForNode'
    ], {
        nodes,
        canonicalSmartMediaUrl:ref => typeof ref === 'string' ? ref : ref?.url || '',
        upstreamLineNodeIds:node => [node.id],
        imagesForNode:node => node?.images || [],
        isHistoryGroupNode:() => false,
        manualReferenceImagesFor:() => [{url:'/manual.png'}],
        collectMentionedImagesFromPrompt:() => [{url:'/mentioned.png'}]
    });
    const kept = loaded.liveSavedRunInputRefsForNode(target, [
        {url:'/manual.png', manualAdded:true},
        {url:'/mentioned.png', promptMentioned:true}
    ]);
    assert.deepEqual(kept.map(ref => ref.url), ['/manual.png', '/mentioned.png']);
});

test('saved metadata keeps provenance but API image payload strips internal state', () => {
    const {savedSmartRunInputRef, apiImageReferencePayload} = loadProductionFunctions([
        'savedSmartRunInputRef',
        'apiImageReferencePayload'
    ], {
        mediaKindForItem:ref => ref.kind || 'image'
    });
    const ref = {
        url:'/a.png',
        name:'A',
        nodeId:'source-a',
        imageIndex:2,
        groupNodeId:'group-a',
        manualAdded:true,
        promptMentioned:true,
        asset_uris:{venice:'asset://a'}
    };
    const saved = savedSmartRunInputRef(ref);
    assert.equal(saved.nodeId, 'source-a');
    assert.equal(saved.imageIndex, 2);
    assert.equal(saved.manualAdded, true);
    assert.equal(saved.promptMentioned, true);
    assert.deepEqual({...saved.asset_uris}, {venice:'asset://a'});

    const payload = apiImageReferencePayload(saved, 0);
    assert.deepEqual({...payload}, {url:'/a.png', name:'A', role:'image_1', kind:'image', mime:''});
    assert.equal('nodeId' in payload, false);
    assert.equal('manualAdded' in payload, false);
});

test('RunningHub logs use the selected RH config instead of stale API model settings', () => {
    const selectedRef = {
        kind:'workflow',
        id:'wf-42',
        entry:{title:'RH Video Workflow'}
    };
    const loaded = loadProductionFunctions([
        'runningHubLogDescriptor',
        'smartRunTaskLabel',
        'smartRunRequestMeta',
        'smartRunSnapshot',
        'smartLogHasLegacyRunningHubMetadata'
    ], {
        settings:{},
        parseRunningHubEntryKey:value => {
            const match = String(value || '').match(/^(app|workflow):(.+)$/);
            return match ? {kind:match[1], id:match[2]} : null;
        },
        selectedRunningHubRef:source => source?.rhConfigKey === 'workflow:wf-42' ? selectedRef : null,
        runningHubEntryLabel:entry => entry?.title || '',
        cloneSmartSettings:source => JSON.parse(JSON.stringify(source || {})),
        smartRequestPromptForRun:prompt => prompt,
        isApiLikeEngine:engine => ['api','volcengine'].includes(engine),
        sizeForRun:() => '',
        modelDisplayName:() => 'Seedream V5 Lite',
        tr:key => key,
        MS_GEN_MODELS:{}
    });
    const run = loaded.smartRunSnapshot(
        {id:'rh-node', type:'smart-image'},
        'prompt',
        [],
        'image',
        null,
        {
            engine:'runninghub',
            rhConfigKey:'workflow:wf-42',
            rhPayment:'wallet',
            provider_id:'custom-api',
            model:'seedream-v5-lite',
            videoProvider:'custom-api',
            videoModel:'seedream-v5-lite'
        }
    );

    assert.deepEqual({...run.runningHub}, {kind:'workflow', id:'wf-42', label:'RH Video Workflow'});
    assert.equal(loaded.smartRunTaskLabel(run), 'RH Video Workflow');
    assert.deepEqual(
        {...loaded.smartRunRequestMeta(run)},
        {
            provider_id:'runninghub',
            model:'RH Video Workflow',
            mode:'workflow',
            config_id:'wf-42',
            useWallet:true,
            workflowId:'wf-42'
        }
    );
    assert.equal(loaded.smartLogHasLegacyRunningHubMetadata({
        platform:'RunningHub',
        model:'Seedream V5 Lite',
        request:{provider_id:'custom-api'}
    }), true);
    assert.equal(loaded.smartLogHasLegacyRunningHubMetadata({
        platform:'RunningHub',
        model:'RH Video Workflow',
        request:{provider_id:'runninghub'}
    }), false);
});

test('engine-specific log metadata wins over output media kind', () => {
    const loaded = loadProductionFunctions(['smartRunTaskLabel', 'smartRunRequestMeta'], {
        runningHubLogDescriptor:() => ({kind:'app', id:'', label:'RunningHub'}),
        modelDisplayName:() => 'stale API model',
        tr:key => key,
        MS_GEN_MODELS:{}
    });
    const comfyVideoRun = {
        kind:'video',
        settings:{
            engine:'comfy',
            comfyMode:'custom',
            comfyWorkflow:'video-workflow.json',
            videoProvider:'custom-api',
            videoModel:'stale-video-model'
        }
    };

    assert.equal(loaded.smartRunTaskLabel(comfyVideoRun), 'video-workflow.json');
    assert.deepEqual(
        {...loaded.smartRunRequestMeta(comfyVideoRun)},
        {workflow_json:'video-workflow.json', mode:'custom'}
    );
});

test('live generation freezes image LOD and keeps decoded media reusable', () => {
    const runningNode = {id:'running', running:true, images:[{url:'/existing.png'}]};
    const loaded = loadProductionFunctions([
        'smartImageLodCandidateActive',
        'smartNodeHasLiveMedia'
    ], {
        nodes:[runningNode],
        nodeHasLiveRunState:node => Boolean(node?.running)
    });
    const img = {
        dataset:{smartImageLodFrame:''},
        closest:selector => selector === '.image-node' ? {dataset:{id:'running'}} : null
    };

    assert.equal(loaded.smartImageLodCandidateActive(img), false);
    assert.equal(loaded.smartNodeHasLiveMedia(runningNode), true);

    runningNode.running = false;
    assert.equal(loaded.smartImageLodCandidateActive(img), true);
});

test('fresh loading overlays inherit the current spinner phase', () => {
    assert.match(extractFunction('nodeBodyHtml'), /--spinner-rotation:\$\{spinnerRotation\}deg/);
});
