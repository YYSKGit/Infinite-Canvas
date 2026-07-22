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
            'runApiVideoGeneration'
        ], {
            nodes,
            settings:{},
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
            videoDuration:5,
            videoAspect:'9:16',
            videoResolution:'480p'
        }, {});

        assert.equal(capturedRequests.length, 1);
        assert.equal(capturedRequests[0].url, '/api/canvas-video');
        const body = JSON.parse(capturedRequests[0].options.body);
        assert.deepEqual(body.images.map(image => image.url), ['/a.png']);
        assert.equal(body.images.length, 1);
    });
}

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
