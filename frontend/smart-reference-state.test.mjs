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

test('generation mode support ignores stale API video state for RunningHub', () => {
    const {generationModeSupported} = loadProductionFunctions(['generationModeSupported'], {
        settings:{},
        apiProviderById:id => id === 'venice-by-protocol' ? {protocol:'venice'} : null,
        isVeniceProviderId:id => id === 'venice'
    });

    assert.equal(generationModeSupported({engine:'runninghub', apiKind:'video'}), true);
    assert.equal(generationModeSupported({engine:'api', apiKind:'video', provider_id:'venice'}), false);
    assert.equal(generationModeSupported({engine:'api', apiKind:'image', provider_id:'venice-by-protocol'}), true);
    assert.equal(generationModeSupported({engine:'comfy', apiKind:'image', provider_id:'venice'}), false);
});

test('unsupported settings clear saved generation mode state', () => {
    const {generationModeSupported, clearUnsupportedGenerationMode} = loadProductionFunctions([
        'generationModeSupported',
        'clearUnsupportedGenerationMode'
    ], {
        settings:{},
        apiProviderById:() => null,
        isVeniceProviderId:id => id === 'venice'
    });
    const unsupportedNode = {generationPromptId:'character-sheet', generationPromptSnapshot:{id:'character-sheet'}};
    assert.equal(clearUnsupportedGenerationMode(unsupportedNode, {engine:'modelscope', apiKind:'image'}), true);
    assert.equal('generationPromptId' in unsupportedNode, false);
    assert.equal('generationPromptSnapshot' in unsupportedNode, false);

    const runningHubNode = {generationPromptId:'character-sheet', generationPromptSnapshot:{id:'character-sheet'}};
    assert.equal(clearUnsupportedGenerationMode(runningHubNode, {engine:'runninghub', apiKind:'video'}), false);
    assert.equal(runningHubNode.generationPromptId, 'character-sheet');
});

test('buildPromptRequest compiles generation mode only for supported request settings', () => {
    let compileCalls = 0;
    const {buildPromptRequest} = loadProductionFunctions(['buildPromptRequest'], {
        collectPromptParts:() => [{type:'text', text:'plain prompt'}],
        originalPromptTextFromParts:() => 'plain prompt',
        blockedInputRefKeys:() => new Set(),
        defaultReferenceImagesFor:() => [],
        uniqueReferenceImages:refs => refs,
        inputRefKey:() => '',
        promptReferenceKind:() => 'image',
        promptMentionTokenLabel:(kind, index) => `${kind}${index}`,
        venicePromptReferenceLabel:(kind, index) => `@${kind}${index}`,
        isSmartGroupNode:() => false,
        textForNode:() => '',
        inputPromptTextFor:() => '',
        smartGenerationRequestRef:ref => ref,
        generationModeSupported:sourceSettings => sourceSettings.engine === 'runninghub',
        compileGenerationModePrompt:(_node, prompt) => {
            compileCalls++;
            return `compiled:${prompt}`;
        },
        settings:{engine:'api'},
        SMART_REFERENCE_IMAGE_MAX:10
    });

    const unsupported = buildPromptRequest({id:'target'}, [], false, null, {engine:'comfy', apiKind:'image'});
    assert.equal(unsupported.prompt, 'plain prompt');
    assert.equal(compileCalls, 0);

    const runningHub = buildPromptRequest({id:'target'}, [], false, null, {engine:'runninghub', apiKind:'video'});
    assert.equal(runningHub.prompt, 'compiled:plain prompt');
    assert.equal(compileCalls, 2);
});

test('Venice image edits and single-slot RunningHub workflows fan out input images', () => {
    const imageRefs = [
        {url:'/a.png', kind:'image'},
        {url:'/b.png', kind:'image'}
    ];
    let runningHubImageFields = 1;
    const loaded = loadProductionFunctions([
        'smartImageGenerationRefBatches',
        'smartImageGenerationJobs',
        'smartExpectedGenerationTaskCount'
    ], {
        settings:{},
        imageRefsOnly:refs => refs.filter(ref => ref.kind === 'image'),
        mediaKindForItem:ref => ref.kind || 'image',
        isApiLikeEngine:engine => engine === 'api',
        isVeniceProviderId:providerId => providerId === 'venice',
        normalizeImageGenerationCount:value => value >= 4 ? 4 : (value >= 2 ? 2 : 1),
        rhActiveFields:() => Array.from({length:runningHubImageFields}, (_, index) => ({fieldType:'IMAGE', index})),
        rhFieldKind:field => field.fieldType === 'IMAGE' ? 'image' : 'text'
    });

    const veniceSettings = {engine:'api', apiKind:'image', provider_id:'venice', count:2};
    assert.deepEqual(
        Array.from(loaded.smartImageGenerationRefBatches(imageRefs, veniceSettings), batch => Array.from(batch, ref => ref.url)),
        [['/a.png'], ['/b.png']]
    );
    assert.equal(loaded.smartImageGenerationJobs(imageRefs, veniceSettings).length, 4);
    assert.equal(loaded.smartExpectedGenerationTaskCount(imageRefs, veniceSettings), 4);

    const runningHubSettings = {engine:'runninghub', count:1};
    assert.deepEqual(
        Array.from(loaded.smartImageGenerationRefBatches(imageRefs, runningHubSettings), batch => Array.from(batch, ref => ref.url)),
        [['/a.png'], ['/b.png']]
    );

    runningHubImageFields = 2;
    assert.deepEqual(
        Array.from(loaded.smartImageGenerationRefBatches(imageRefs, runningHubSettings), batch => Array.from(batch, ref => ref.url)),
        [['/a.png', '/b.png']]
    );

    const genericSettings = {engine:'api', apiKind:'image', provider_id:'generic', count:1};
    assert.deepEqual(
        Array.from(loaded.smartImageGenerationRefBatches(imageRefs, genericSettings), batch => Array.from(batch, ref => ref.url)),
        [['/a.png', '/b.png']]
    );
});

test('fan-out is scoped away from Venice video and Comfy generation', () => {
    const refs = [{url:'/a.png', kind:'image'}, {url:'/b.png', kind:'image'}];
    const loaded = loadProductionFunctions([
        'smartImageGenerationRefBatches',
        'smartImageGenerationJobs',
        'smartExpectedGenerationTaskCount'
    ], {
        settings:{},
        imageRefsOnly:values => values.filter(ref => ref.kind === 'image'),
        mediaKindForItem:ref => ref.kind || 'image',
        isApiLikeEngine:engine => engine === 'api',
        isVeniceProviderId:providerId => providerId === 'venice',
        normalizeImageGenerationCount:value => value >= 4 ? 4 : (value >= 2 ? 2 : 1),
        rhActiveFields:() => [],
        rhFieldKind:() => 'text'
    });

    assert.equal(loaded.smartExpectedGenerationTaskCount(refs, {
        engine:'api',
        apiKind:'video',
        provider_id:'venice',
        count:8
    }), 1);
    assert.equal(loaded.smartExpectedGenerationTaskCount(refs, {
        engine:'comfy',
        apiKind:'image',
        count:8
    }), 1);
});

test('Venice fan-out submits one reference image per API task', async () => {
    const requestBodies = [];
    let taskIndex = 0;
    const loaded = loadProductionFunctions([
        'smartImageGenerationRefBatches',
        'smartImageGenerationJobs',
        'apiImageReferencePayload',
        'runApiGeneration'
    ], {
        settings:{},
        imageRefsOnly:refs => refs.filter(ref => ref.kind === 'image'),
        mediaKindForItem:ref => ref.kind || 'image',
        isApiLikeEngine:engine => engine === 'api',
        isVeniceProviderId:providerId => providerId === 'venice',
        normalizeImageGenerationCount:value => value >= 4 ? 4 : (value >= 2 ? 2 : 1),
        rhActiveFields:() => [],
        rhFieldKind:() => 'text',
        beginVeniceCreditsFastRefresh:() => 'credits-token',
        endVeniceCreditsFastRefresh:() => {},
        ensureVeniceProgress:() => {},
        finishVeniceProgressTask:() => {},
        smartLogActualGenerationRequest:() => {},
        smartPayloadReferenceMediaCounts:() => ({total:1, images:1, videos:0, audios:0}),
        sizeForRun:() => '1024x1024',
        imageSizeSpecForRun:() => ({mode:'preset', aspect_ratio:'1:1', resolution:'1K'}),
        normalizeImageSettingsForCapabilities:value => ({...value, quality:'medium'}),
        imageQualityForRequest:value => value.quality || '',
        rememberSmartRunTaskId:() => {},
        runningHubProgressNodeForContext:() => null,
        tr:key => key,
        VENICE_IMAGE_ESTIMATE_MS:1000,
        SMART_REFERENCE_IMAGE_MAX:20,
        fetch:async (_url, options) => {
            requestBodies.push(JSON.parse(options.body));
            const id = `task-${++taskIndex}`;
            return {
                ok:true,
                json:async () => ({task_id:id}),
                text:async () => ''
            };
        }
    });

    const result = await loaded.runApiGeneration(
        'edit each image',
        [{url:'/a.png', kind:'image'}, {url:'/b.png', kind:'image'}],
        {engine:'api', apiKind:'image', provider_id:'venice', model:'z-image-turbo', count:2}
    );

    assert.equal(result.taskIds.length, 4);
    assert.deepEqual(
        requestBodies.map(body => body.reference_images.map(ref => ref.url)),
        [['/a.png'], ['/a.png'], ['/b.png'], ['/b.png']]
    );
    assert.ok(requestBodies.every(body => body.size_spec?.aspect_ratio === '1:1'));
});

test('Venice edit pending size follows input only for automatic aspect', () => {
    const loaded = loadProductionFunctions(['veniceEditUsesSourcePendingSize'], {
        isApiLikeEngine:engine => engine === 'api',
        isVeniceProviderId:id => id === 'venice',
        imageSizeSpecForRun:source => ({mode:source.ratio === 'auto' ? 'auto_aspect' : 'preset'})
    });
    const base = {engine:'api', apiKind:'image', provider_id:'venice'};

    assert.equal(loaded.veniceEditUsesSourcePendingSize({...base, ratio:'auto'}, 'venice', true), true);
    assert.equal(loaded.veniceEditUsesSourcePendingSize({...base, ratio:'wide'}, 'venice', true), false);
    assert.equal(loaded.veniceEditUsesSourcePendingSize({...base, ratio:'auto'}, 'venice', false), false);
});

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
        generationModeSupported:() => false,
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

test('Venice quote badges prioritize the remaining generation count', () => {
    const loaded = loadProductionFunctions(['veniceQuoteRemainingCountText', 'veniceQuoteBadgeText'], {
        veniceCreditsState:{remaining:528}
    });
    assert.equal(loaded.veniceQuoteRemainingCountText(44), '12');
    assert.equal(loaded.veniceQuoteBadgeText(44), '12');
    assert.equal(loaded.veniceQuoteBadgeText(0), '免费');
});

test('Venice image quote totals use the expanded fan-out task count', () => {
    let rendered = null;
    const loaded = loadProductionFunctions([
        'veniceImageQuoteTaskCount',
        'renderVeniceImageQuoteAmount'
    ], {
        settings:{count:2},
        smartLoopContext:null,
        generationReferenceImagesForRun:() => [
            {url:'/a.png', kind:'image'},
            {url:'/b.png', kind:'image'}
        ],
        buildPromptRequest:(_subject, refs) => ({refs}),
        smartExpectedGenerationTaskCount:(refs, sourceSettings) => refs.length * sourceSettings.count,
        veniceQuoteBadgeText:quote => String(quote),
        setVeniceImageQuoteStatus:(status, text, title) => {
            rendered = {status, text, title};
        }
    });

    const taskCount = loaded.veniceImageQuoteTaskCount({id:'subject'});
    assert.equal(taskCount, 4);
    loaded.renderVeniceImageQuoteAmount(11, taskCount);
    assert.equal(rendered.status, 'ready');
    assert.equal(rendered.text, '44');
    assert.match(rendered.title, /× 4 = 44/);
});

test('Venice image quote payload excludes aspect ratio and local task count', () => {
    const settings = {
        provider_id:'venice',
        model:'gpt-image-2',
        ratio:'1:1',
        resolution:'2k',
        quality:'high',
        count:1
    };
    const loaded = loadProductionFunctions(['veniceImageQuoteRequestPayload'], {
        settings,
        veniceImageQuoteResolution:() => String(settings.resolution).toUpperCase(),
        imageQualityForRequest:() => settings.quality,
        veniceImageQuoteHasReferenceImage:() => false
    });

    const first = loaded.veniceImageQuoteRequestPayload({id:'subject'});
    settings.ratio = '16:9';
    settings.count = 4;
    const second = loaded.veniceImageQuoteRequestPayload({id:'subject'});

    assert.deepEqual({...first}, {
        provider_id:'venice',
        model:'gpt-image-2',
        resolution:'2K',
        quality:'high',
        has_reference_image:false
    });
    assert.deepEqual({...second}, {...first});
    assert.equal('size' in first, false);
    assert.equal('size_spec' in first, false);
    assert.equal('task_count' in first, false);
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

test('restored Venice credits seed the change detector before the first live refresh', () => {
    const cached = {
        providerId:'venice',
        remaining:1000,
        total:2000,
        available:1000,
        lastRequestAt:Date.now(),
        updatedAt:Date.now()
    };
    const loaded = loadProductionFunctions(['restoreVeniceCreditsCache'], {
        localStorage:{getItem:key => key === 'credits-cache' ? JSON.stringify(cached) : null},
        VENICE_CREDITS_CACHE_KEY:'credits-cache',
        veniceCreditsState:{
            providerId:'',
            remaining:null,
            total:null,
            available:null,
            nextRefillAt:null,
            tierCap:null,
            usedThisCycle:null,
            userType:'',
            lastRequestAt:0,
            updatedAt:0,
            status:'idle',
            error:''
        },
        veniceCreditsObservedProviderId:'',
        veniceCreditsObservedRemaining:null
    });

    loaded.restoreVeniceCreditsCache();

    assert.equal(loaded.sandbox.veniceCreditsState.providerId, 'venice');
    assert.equal(loaded.sandbox.veniceCreditsState.remaining, 1000);
    assert.equal(loaded.sandbox.veniceCreditsObservedProviderId, 'venice');
    assert.equal(loaded.sandbox.veniceCreditsObservedRemaining, 1000);
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
        'smartLoggableTaskId',
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
    const loaded = loadProductionFunctions(['smartRunTaskLabel', 'smartLoggableTaskId', 'smartRunRequestMeta'], {
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
