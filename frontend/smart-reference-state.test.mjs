import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const smartCanvasPath = fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url));
const smartCanvasSource = readFileSync(smartCanvasPath, 'utf8');
const smartCanvasHtml = readFileSync(new URL('../static/smart-canvas.html', import.meta.url), 'utf8');
const smartCanvasCss = readFileSync(new URL('../static/css/smart-canvas.css', import.meta.url), 'utf8');

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

test('reference controls keep canvas picker first, media in the middle, and popup picker last', () => {
    assert.doesNotMatch(smartCanvasHtml, /composerHeadQuickActions/);
    assert.match(smartCanvasHtml, /id="inputThumbsRow"/);
    assert.match(smartCanvasHtml, /id="canvasReferencePickBanner"[\s\S]*?data-lucide="mouse-pointer-2"[\s\S]*?id="canvasReferencePickReturn"[\s\S]*?id="canvasReferencePickClose"/);
    const renderSource = extractFunction('renderInputThumbsRow');
    assert.match(renderSource, /inputThumbsRow\.innerHTML = `\$\{nodePickButton\}\$\{listHtml\}\$\{addButton\}`/);
    assert.doesNotMatch(renderSource, /input-thumb-count/);
    assert.match(renderSource, /classList\.add\('has-actions'\)/);
    assert.match(smartCanvasCss, /\.canvas-reference-pick-banner \{[^}]*position:absolute[^}]*left:50%/);
    assert.match(smartCanvasCss, /\.input-thumb-list \{[^}]*max-width:calc\(100% - 108px\)[^}]*scrollbar-width:none/);
    assert.match(smartCanvasCss, /\.input-reference-action \{[^}]*width:46px[^}]*height:46px[^}]*margin-top:1px/);
    assert.match(smartCanvasCss, /\.input-thumbs-row \{[^}]*padding:0 2px/);
    assert.match(smartCanvasCss, /\.composer:not\(\.expanded\) \.input-thumbs-row \{[^}]*margin-top:-3px[^}]*margin-bottom:-4px/);
    assert.match(smartCanvasCss, /\.composer:not\(\.expanded\) \.input-prompt-preview\.has-text \{[^}]*margin-top:2px[^}]*margin-bottom:-2px/);
    assert.match(smartCanvasCss, /\.input-reference-action:hover,\.input-reference-action:focus-visible \{[^}]*background:color-mix\(in srgb, var\(--card\) 56%, var\(--soft\)\)[^}]*border-color:color-mix\(in srgb, var\(--text\) 28%, var\(--line\)\)/);
    assert.match(smartCanvasCss, /\.input-reference-action\.active \{[^}]*background:var\(--card\)[^}]*border-color:var\(--text\)[^}]*color:var\(--text\)/);
    assert.match(smartCanvasCss, /\.canvas-reference-pick-banner \{[^}]*border:1px solid var\(--line\)/);
    assert.match(smartCanvasCss, /\.canvas-reference-pick-icon \{[^}]*border:1px solid var\(--line\)/);
    assert.match(smartCanvasCss, /\.shell\.canvas-reference-picking \.composer,[\s\S]*?\.shell\.canvas-reference-picking \.composer-expand-backdrop,[\s\S]*?\.shell\.canvas-reference-picking \.smart-node-floating-menu \{ display:none !important; \}/);
    assert.match(smartCanvasCss, /\.canvas-reference-picked::after \{[^}]*border-color:var\(--connection-flow\)/);
    assert.match(smartCanvasCss, /\.canvas-reference-locked \{ cursor:not-allowed; \}/);
    assert.match(smartCanvasCss, /\.mention-picker \{[^}]*z-index:70/);
    assert.match(smartCanvasCss, /\.composer-card > \.mention-picker \{ z-index:110; \}/);
});

test('canvas picker resolves one stable media item and preserves smart-group ownership', () => {
    const {canvasReferencePickCandidateForNode} = loadProductionFunctions(
        ['canvasReferencePickCandidateForNode'],
        {
            imagesForNode:node => node.refs || [],
            mediaKindForItem:item => item.kind || 'image',
            isSmartGroupNode:node => node.type === 'smart-group'
        }
    );
    const single = {id:'single', refs:[{url:'/single.png', nodeId:'single', imageIndex:0, kind:'image'}]};
    assert.equal(canvasReferencePickCandidateForNode(single).url, '/single.png');
    const group = {id:'group', type:'smart-group', refs:[
        {url:'/owned.png', nodeId:'group', imageIndex:0, kind:'image'},
        {url:'/child.mp4', nodeId:'child', imageIndex:0, kind:'video'}
    ]};
    assert.equal(canvasReferencePickCandidateForNode(group), null);
    assert.equal(canvasReferencePickCandidateForNode(group, 0).url, '/owned.png');
    assert.equal(canvasReferencePickCandidateForNode(group, 1), null);
    const targetSource = extractFunction('canvasReferencePickCandidateFromTarget');
    assert.match(targetSource, /smart-progress-task-content[\s\S]*?runningHubProgressTasks\(clickedNode\)\.flatMap\(smartProgressTaskResultItems\)/);
});

test('node-picked references are copied into manual state as independent snapshots', () => {
    let undoCount = 0;
    let saveCount = 0;
    const {addManualReferenceToNode} = loadProductionFunctions(
        ['addManualReferenceToNode'],
        {
            mediaKindForItem:item => item.kind || 'image',
            inputRefKey:item => item.nodeId && item.imageIndex !== '' ? `${item.nodeId}|${item.imageIndex}` : `url|${item.url}`,
            blockedInputRefKeys:() => new Set(),
            visibleReferenceImagesFor:node => node.manualInputRefs || [],
            pushUndo:() => { undoCount++; },
            closeMentionPicker:() => {},
            renderInputThumbsRow:() => {},
            scheduleSave:() => { saveCount++; },
            toast:() => {},
            trf:key => key,
            SMART_REFERENCE_IMAGE_MAX:20
        }
    );
    const target = {id:'target'};
    const source = {url:'/picked.png', name:'Picked', nodeId:'source', imageIndex:2, kind:'image', asset_uris:{runninghub:'asset://picked'}};
    assert.equal(addManualReferenceToNode(target, source, {closePicker:false}), 'added');
    source.url = '/changed.png';
    source.asset_uris.runninghub = 'asset://changed';
    assert.equal(target.manualInputRefs.length, 1);
    assert.equal(target.manualInputRefs[0].url, '/picked.png');
    assert.equal(target.manualInputRefs[0].asset_uris.runninghub, 'asset://picked');
    assert.equal(target.manualInputRefs[0].manualAdded, true);
    assert.equal(undoCount, 1);
    assert.equal(saveCount, 1);
    assert.equal(addManualReferenceToNode(target, {...source, url:'/picked.png'}, {closePicker:false}), 'duplicate');
    assert.equal(target.manualInputRefs.length, 1);
});

test('canvas picker toggles multiple media and returns only when an effective session exits', () => {
    const clickSource = extractFunction('handleCanvasReferencePickClick');
    assert.match(clickSource, /closest\?\.\('\.composer,\.canvas-reference-pick-banner,\.smart-minimap'\)/);
    assert.match(clickSource, /toggleCanvasReferenceForNode\(targetNode, candidate\.ref\)/);
    assert.match(clickSource, /canvasReferencePickIsLockedUpstream\(targetNode, candidate\.ref\)[\s\S]*?smart\.referencePickUpstreamLocked/);
    assert.match(clickSource, /\['added','selected','removed'\]\.includes\(result\)[\s\S]*?canvasReferencePickState\.changed = true/);
    assert.doesNotMatch(clickSource.slice(clickSource.indexOf('toggleCanvasReferenceForNode')), /finishCanvasReferencePick\(\)/);
    const toggleSource = extractFunction('toggleCanvasReferenceForNode');
    assert.match(toggleSource, /manualInputRefs[\s\S]*?blockedInputRefs[\s\S]*?return 'removed'/);
    assert.match(toggleSource, /blocked\.delete\(key\)[\s\S]*?return 'selected'/);
    assert.match(extractFunction('startCanvasReferencePick'), /changed:false/);
    assert.match(extractFunction('startCanvasReferencePick'), /restoreCanvasReferencePickLockedUpstream\(node\)/);
    assert.match(extractFunction('finishCanvasReferencePick'), /returnIfChanged[\s\S]*?state\?\.changed[\s\S]*?returnToCanvasReferenceTarget\(target, state\.viewport\)/);
    assert.match(smartCanvasSource, /shell\.addEventListener\('mousedown',[\s\S]*?canvasReferencePickState[\s\S]*?closest\?\.\('\.image-node'\)[\s\S]*?stopImmediatePropagation\(\)/);
    assert.match(smartCanvasSource, /canvasReferencePickState && e\.key === 'Escape'[\s\S]*?finishCanvasReferencePick\(\{returnIfChanged:true\}\)/);
    assert.match(smartCanvasSource, /canvasReferencePickClose\?\.addEventListener\('click',[\s\S]*?finishCanvasReferencePick\(\{returnIfChanged:true\}\)/);
});

test('canvas picker removes manual refs and blocks or restores existing refs as one toggle', () => {
    let undoCount = 0;
    let commitCount = 0;
    let addCount = 0;
    const key = item => `${item.nodeId || ''}|${item.imageIndex ?? ''}`;
    const matches = (left, right) => key(left) === key(right) || left.url === right.url;
    const visible = node => [...(node.upstream || []), ...(node.manualInputRefs || [])];
    const selected = (node, ref) => {
        const blocked = new Set(node.blockedInputRefs || []);
        return visible(node).some(item => matches(item, ref) && !blocked.has(key(item)));
    };
    const {toggleCanvasReferenceForNode} = loadProductionFunctions(
        ['toggleCanvasReferenceForNode'],
        {
            canvasReferencePickIsSelected:selected,
            canvasReferencePickIsLockedUpstream:() => false,
            canvasReferencePickRefMatches:matches,
            blockedInputRefKeys:node => new Set(node.blockedInputRefs || []),
            visibleReferenceImagesFor:visible,
            inputRefKey:key,
            pushUndo:() => { undoCount++; },
            commitCanvasReferencePickToggle:() => { commitCount++; },
            addManualReferenceToNode:() => { addCount++; return 'added'; }
        }
    );
    const manual = {url:'/manual.png', nodeId:'manual-source', imageIndex:0};
    const manualTarget = {manualInputRefs:[manual]};
    assert.equal(toggleCanvasReferenceForNode(manualTarget, manual), 'removed');
    assert.equal(manualTarget.manualInputRefs, undefined);

    const upstream = {url:'/upstream.png', nodeId:'upstream-source', imageIndex:1};
    const upstreamTarget = {upstream:[upstream]};
    assert.equal(toggleCanvasReferenceForNode(upstreamTarget, upstream), 'removed');
    assert.equal([...upstreamTarget.blockedInputRefs].join(','), 'upstream-source|1');
    assert.equal(toggleCanvasReferenceForNode(upstreamTarget, upstream), 'selected');
    assert.equal(upstreamTarget.blockedInputRefs, undefined);
    assert.equal(undoCount, 3);
    assert.equal(commitCount, 3);
    assert.equal(addCount, 0);
});

test('connected upstream references stay selected and cannot be toggled by the picker', () => {
    const upstream = {url:'/upstream.png', nodeId:'upstream-source', imageIndex:0};
    const loaded = loadProductionFunctions(
        ['canvasReferencePickRefMatches', 'canvasReferencePickConnectedUpstreamRefs', 'canvasReferencePickIsLockedUpstream'],
        {
            inputRefKey:item => `${item.nodeId || ''}|${item.imageIndex ?? ''}`,
            canonicalSmartMediaUrl:item => item.url,
            smartImageUsesWorkflowInput:() => false,
            inputImagesFor:node => node.upstream || [],
            workflowInputImagesFor:() => [],
            smartLoopContext:{}
        }
    );
    assert.equal(loaded.canvasReferencePickIsLockedUpstream({upstream:[upstream]}, upstream), true);
    assert.equal(loaded.canvasReferencePickIsLockedUpstream({upstream:[]}, upstream), false);
    const guarded = loadProductionFunctions(
        ['toggleCanvasReferenceForNode'],
        {canvasReferencePickIsLockedUpstream:() => true}
    );
    assert.equal(guarded.toggleCanvasReferenceForNode({}, upstream), 'locked');
});

test('canvas picker exit returns to its target only after an effective toggle', () => {
    let returnCount = 0;
    const target = {id:'target'};
    const loaded = loadProductionFunctions(
        ['finishCanvasReferencePick'],
        {
            canvasReferencePickState:{targetNodeId:'target', changed:false},
            nodes:[target],
            syncCanvasReferencePickBanner:() => {},
            inputThumbsRow:{dataset:{thumbsSig:'old'}},
            selectedNode:() => target,
            renderInputThumbsRow:() => {},
            returnToCanvasReferenceTarget:() => { returnCount++; }
        }
    );
    assert.equal(loaded.finishCanvasReferencePick({returnIfChanged:true}), true);
    assert.equal(returnCount, 0);
    loaded.sandbox.canvasReferencePickState = {targetNodeId:'target', changed:true};
    assert.equal(loaded.finishCanvasReferencePick({returnIfChanged:true}), true);
    assert.equal(returnCount, 1);
});

test('canvas picker restores the exact viewport captured when selection started', () => {
    const target = {id:'target'};
    const viewport = {x:120.25, y:-86.5, scale:0.72};
    const frames = [];
    const composerClasses = new Set();
    const worldClasses = new Set();
    let applyCount = 0;
    const loaded = loadProductionFunctions(
        [
            'stopCanvasReferenceViewportAnimation',
            'canvasReferenceViewportEase',
            'animateCanvasReferenceViewport',
            'startCanvasReferencePick',
            'returnToCanvasReferenceTarget'
        ],
        {
            canvasReferencePickState:null,
            canvasReferencePickReturnFrame:0,
            viewport,
            composer:{classList:{
                add:name => composerClasses.add(name),
                remove:name => composerClasses.delete(name)
            }},
            world:{classList:{
                add:name => worldClasses.add(name),
                remove:name => worldClasses.delete(name)
            }},
            window:{matchMedia:() => ({matches:false})},
            requestAnimationFrame:callback => { frames.push(callback); return frames.length; },
            cancelAnimationFrame:() => {},
            closeMentionPicker:() => {},
            closeAllSmartPopovers:() => {},
            restoreCanvasReferencePickLockedUpstream:() => {},
            syncCanvasReferencePickBanner:() => {},
            inputThumbsRow:null,
            renderInputThumbsRow:() => {},
            canvasReferencePickTargetNode:() => target,
            selectedId:'',
            selectedIds:['other'],
            selectedImage:{nodeId:'other', index:2},
            applyViewport:() => { applyCount++; },
            syncSelectionUi:() => {},
            updateComposer:() => {}
        }
    );
    assert.equal(loaded.startCanvasReferencePick(target), true);
    assert.equal(loaded.sandbox.canvasReferencePickState.viewport.x, 120.25);
    assert.equal(loaded.sandbox.canvasReferencePickState.viewport.y, -86.5);
    assert.equal(loaded.sandbox.canvasReferencePickState.viewport.scale, 0.72);

    viewport.x = 640;
    viewport.y = 360;
    viewport.scale = 1.8;
    assert.equal(loaded.returnToCanvasReferenceTarget(target), true);
    assert.equal(composerClasses.has('canvas-reference-viewport-animating'), true);
    assert.equal(worldClasses.has('canvas-reference-viewport-animating'), true);
    assert.equal(frames.length, 1);
    frames.shift()(0);
    frames.shift()(110);
    assert.equal(viewport.x, 607.515625);
    assert.equal(viewport.y, 332.09375);
    assert.equal(viewport.scale, 1.7325);
    frames.shift()(440);
    assert.equal(viewport.x, 120.25);
    assert.equal(viewport.y, -86.5);
    assert.equal(viewport.scale, 0.72);
    assert.equal(applyCount, 3);
    assert.equal(loaded.sandbox.canvasReferencePickReturnFrame, 0);
    assert.equal(composerClasses.has('canvas-reference-viewport-animating'), false);
    assert.equal(worldClasses.has('canvas-reference-viewport-animating'), false);
    assert.doesNotMatch(extractFunction('returnToCanvasReferenceTarget'), /nodeRect|centerViewportOnWorldPoint/);
    assert.match(extractFunction('finishCanvasReferencePick'), /returnToCanvasReferenceTarget\(target, state\.viewport\)/);
    assert.match(extractFunction('animateCanvasReferenceViewport'), /canvasReferenceViewportEase\(progress\)/);
    assert.match(extractFunction('stopCanvasReferenceViewportAnimation'), /classList\.remove\('canvas-reference-viewport-animating'\)/);
    assert.match(smartCanvasCss, /\.composer\.canvas-reference-viewport-animating,\.composer\.canvas-wheel-viewport-scaling \{[^}]*transition:opacity[^}]*visibility[^}]*\}/);
    assert.match(smartCanvasCss, /\.world\.canvas-reference-viewport-animating \.smart-node-floating-menu,\.world\.canvas-wheel-viewport-scaling \.smart-node-floating-menu \{[^}]*transition:opacity[^}]*\}/);
    assert.match(smartCanvasSource, /shell\.onmousedown[\s\S]*?stopCanvasReferenceViewportAnimation\(\)/);
    assert.match(smartCanvasSource, /shell\.addEventListener\('wheel'[\s\S]*?stopCanvasReferenceViewportAnimation\(\)/);
});

test('wheel zoom temporarily synchronizes the composer counter-scale without changing other viewport paths', () => {
    const composerClasses = new Set();
    const worldClasses = new Set();
    const scheduled = [];
    let clearCount = 0;
    const loaded = loadProductionFunctions(['beginComposerWheelScaleSync'], {
        composerWheelScaleSyncTimer:null,
        composer:{classList:{
            add:name => composerClasses.add(name),
            remove:name => composerClasses.delete(name)
        }},
        world:{classList:{
            add:name => worldClasses.add(name),
            remove:name => worldClasses.delete(name)
        }},
        setTimeout:callback => { scheduled.push(callback); return scheduled.length; },
        clearTimeout:() => { clearCount++; }
    });
    loaded.beginComposerWheelScaleSync();
    assert.equal(composerClasses.has('canvas-wheel-viewport-scaling'), true);
    assert.equal(worldClasses.has('canvas-wheel-viewport-scaling'), true);
    loaded.beginComposerWheelScaleSync();
    assert.equal(clearCount, 1);
    scheduled.at(-1)();
    assert.equal(composerClasses.has('canvas-wheel-viewport-scaling'), false);
    assert.equal(worldClasses.has('canvas-wheel-viewport-scaling'), false);
    assert.equal(loaded.sandbox.composerWheelScaleSyncTimer, null);
    assert.match(smartCanvasSource, /shell\.addEventListener\('wheel'[\s\S]*?stopCanvasReferenceViewportAnimation\(\)[\s\S]*?beginComposerWheelScaleSync\(\)[\s\S]*?applyViewport\(\)/);
});

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

test('retired source-ratio settings migrate to automatic sizing', () => {
    const {normalizeImageSettingsForCapabilities} = loadProductionFunctions([
        'normalizeImageSettingsForCapabilities'
    ], {
        settings:{},
        imageCapabilitiesFor:source => ({sizeMode:source.sizeMode || ''}),
        normalizeImageGenerationCount:value => Number(value) || 1
    });

    const automatic = {ratio:'source', resolution:'2k', sizeMode:'aspect_resolution', count:1};
    normalizeImageSettingsForCapabilities(automatic);
    assert.equal(automatic.ratio, 'auto');

    const pixelOnly = {ratio:'source', resolution:'2k', sizeMode:'pixel', count:1};
    normalizeImageSettingsForCapabilities(pixelOnly);
    assert.equal(pixelOnly.ratio, 'square');

    const pixelEdit = {ratio:'auto', resolution:'2k', sizeMode:'pixel', count:1};
    normalizeImageSettingsForCapabilities(pixelEdit, {hasReferenceImage:true});
    assert.equal(pixelEdit.ratio, 'auto');
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
