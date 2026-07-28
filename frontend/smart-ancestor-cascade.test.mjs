import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sourcePath = fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const cssSource = readFileSync(fileURLToPath(new URL('../static/css/smart-canvas.css', import.meta.url)), 'utf8');

function extractFunction(name){
    const markers = [`function ${name}(`, `async function ${name}(`];
    const starts = markers.map(marker => source.indexOf(marker)).filter(index => index >= 0);
    assert.ok(starts.length, `missing production function ${name}`);
    const start = Math.min(...starts);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    let state = 'code';
    let escaped = false;
    for(let index = bodyStart; index < source.length; index++){
        const char = source[index];
        const next = source[index + 1];
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
        if(char === "'") state = 'single';
        else if(char === '"') state = 'double';
        else if(char === '`') state = 'template';
        else if(char === '{') depth++;
        else if(char === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`unterminated production function ${name}`);
}

function buildPlan(nodes, connections, targetId){
    const sandbox = vm.createContext({
        nodes,
        canvas:{connections},
        isHistoryGroupNode:node => Boolean(node?.historyFor || node?.isHistoryGroup),
        isSmartImageNode:node => Boolean(node && (!node.type || node.type === 'smart-image')),
        smartNodeHasDisplayResult:node => Boolean((node?.images || []).some(image => image?.url)),
        smartNodeInFlight:node => Boolean(node?.running || node?.pending || node?.queued)
    });
    const names = [
        'smartAncestorRunnableKind',
        'smartAncestorPinHasOutput',
        'smartAncestorNodeSort',
        'buildSmartAncestorRunPlan'
    ];
    vm.runInContext(`${names.map(extractFunction).join('\n')}\nglobalThis.plan = buildSmartAncestorRunPlan(${JSON.stringify(targetId)});`, sandbox);
    return sandbox.plan;
}

const generated = (id, x=0, y=0, extra={}) => ({
    id,
    type:'smart-image',
    x,
    y,
    runAt:1,
    images:[{url:`/${id}.png`, generatedResult:true}],
    ...extra
});
const edge = (from, to) => ({from, to, kind:'input'});

test('runs only ancestors of the selected node and excludes downstream siblings', () => {
    const upload = {id:'upload', type:'smart-image', originalMediaSource:'upload', runSettings:{engine:'api'}, images:[{url:'/upload.png'}]};
    const plan = buildPlan(
        [upload, generated('a'), generated('b'), generated('target'), generated('sibling')],
        [edge('upload', 'a'), edge('a', 'b'), edge('b', 'target'), edge('a', 'sibling')],
        'target'
    );
    assert.equal(plan.invalid, '');
    assert.deepEqual([...plan.stepIds], ['a', 'b', 'target']);
    assert.deepEqual(new Set(plan.reachableIds), new Set(['upload', 'a', 'b', 'target']));
    assert.deepEqual(
        new Set(plan.reachableConnections.map(connection => `${connection.from}->${connection.to}`)),
        new Set(['upload->a', 'a->b', 'b->target'])
    );
    assert.ok(!plan.activeIds.includes('sibling'));
});

test('treats a legacy uploaded image with incidental UI settings as passive', () => {
    const legacyUpload = {id:'upload', type:'smart-image', runSettings:{engine:'api'}, images:[{url:'/upload.png'}]};
    const plan = buildPlan(
        [legacyUpload, generated('target')],
        [edge('upload', 'target')],
        'target'
    );
    assert.deepEqual([...plan.stepIds], ['target']);
});

test('runs independent dependencies in the same concurrent layer', () => {
    const plan = buildPlan(
        [generated('a', 0, 20), generated('b', 0, 10), generated('target', 100, 0)],
        [edge('a', 'target'), edge('b', 'target')],
        'target'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(plan.layers)), [['b', 'a'], ['target']]);
});

test('runs an enabled LLM prompt node before its downstream generation node', () => {
    const prompt = {id:'prompt', type:'smart-prompt', llmEnabled:true, text:'new prompt', x:0, y:0};
    const plan = buildPlan(
        [prompt, generated('target', 100, 0)],
        [edge('prompt', 'target')],
        'target'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(plan.layers)), [['prompt'], ['target']]);
});

test('a pinned node cuts off itself and its exclusive upstream path', () => {
    const upload = {id:'upload', type:'smart-image', originalMediaSource:'upload', images:[{url:'/upload.png'}]};
    const plan = buildPlan(
        [upload, generated('a'), generated('checkpoint', 0, 0, {cascadePinned:true}), generated('target')],
        [edge('upload', 'a'), edge('a', 'checkpoint'), edge('checkpoint', 'target')],
        'target'
    );
    assert.deepEqual([...plan.stepIds], ['target']);
    assert.deepEqual([...plan.pinnedBoundaryIds], ['checkpoint']);
    assert.deepEqual(new Set(plan.skippedIds), new Set(['upload', 'a', 'checkpoint']));
    assert.deepEqual(
        new Set(plan.reachableConnections.map(connection => `${connection.from}->${connection.to}`)),
        new Set(['upload->a', 'a->checkpoint', 'checkpoint->target'])
    );
    assert.deepEqual(plan.connections.map(connection => `${connection.from}->${connection.to}`), ['checkpoint->target']);
});

test('shared upstream still runs when required by an unpinned branch', () => {
    const plan = buildPlan(
        [
            generated('a', 0, 0),
            generated('checkpoint', 100, 0, {cascadePinned:true}),
            generated('live', 100, 50),
            generated('target', 200, 0)
        ],
        [edge('a', 'checkpoint'), edge('a', 'live'), edge('checkpoint', 'target'), edge('live', 'target')],
        'target'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(plan.layers)), [['a'], ['live'], ['target']]);
    assert.ok(!plan.skippedIds.includes('a'));
});

test('a pinned selected node is automatically included and marked for unpinning', () => {
    const plan = buildPlan(
        [generated('a'), generated('target', 100, 0, {cascadePinned:true})],
        [edge('a', 'target')],
        'target'
    );
    assert.equal(plan.unpinTarget, true);
    assert.deepEqual([...plan.stepIds], ['a', 'target']);
});

test('rejects active loops and cyclic connections', () => {
    const withLoop = buildPlan(
        [generated('a'), {id:'loop', type:'smart-loop'}, generated('target')],
        [edge('a', 'loop'), edge('loop', 'target')],
        'target'
    );
    assert.equal(withLoop.invalid, 'loop');

    const cyclic = buildPlan(
        [generated('a'), generated('b'), generated('target')],
        [edge('a', 'b'), edge('b', 'a'), edge('b', 'target')],
        'target'
    );
    assert.equal(cyclic.invalid, 'cycle');
});

test('concurrent generation does not mutate or read composer settings after dispatch', () => {
    const generationSource = extractFunction('runGeneration');
    assert.doesNotMatch(generationSource, /(?:^|[^\w.])settings\s*=/, 'runGeneration must not assign the composer settings object');
    const comfySource = [
        extractFunction('runComfyGeneration'),
        extractFunction('runComfyText'),
        extractFunction('runComfyEnhance'),
        extractFunction('runComfyEdit')
    ].join('\n');
    assert.doesNotMatch(comfySource, /\bsettings\./, 'Comfy execution must use its explicit settings snapshot');
});

test('ancestor run node visuals expose wait, active, done, and failed states', () => {
    const run = {
        plan:{
            stepIds:['wait','active','done','failed'],
            reachableIds:['wait','active','done','failed','source','skipped','boundary'],
            skippedIds:['skipped','boundary'],
            pinnedBoundaryIds:['boundary']
        },
        runningIds:new Set(['active']),
        completedIds:new Set(['done']),
        failedIds:new Set(['failed'])
    };
    const sandbox = vm.createContext({smartAncestorCascadeRun:run, smartAncestorCascadePreview:null});
    vm.runInContext(
        `${extractFunction('smartAncestorNodeVisualState')}
        globalThis.states = ['outside','wait','active','done','failed','source','skipped','boundary'].map(smartAncestorNodeVisualState);`,
        sandbox
    );
    assert.deepEqual([...sandbox.states], ['', 'wait', 'active', 'done', 'failed', 'source', 'skipped', 'boundary']);
});

test('one-click runs silence per-node desktop notifications', () => {
    const successSource = extractFunction('notifySmartTaskSuccess');
    const failureSource = extractFunction('notifySmartTaskFailure');
    assert.match(successSource, /if\(!smartOneClickRunActive\(\)\)\s+smartBackgroundNotify/);
    assert.match(failureSource, /if\(!smartOneClickRunActive\(\)\)\s+smartBackgroundNotify/);
    assert.match(extractFunction('runSmartAncestorCascade'), /smartBackgroundNotify\('一键运行完成'/);
    assert.match(extractFunction('runSmartCascade'), /smartBackgroundNotify\('一键运行完成'/);
});

test('running-node animations retain a stable phase across DOM rebuilds', () => {
    const renderSource = extractFunction('render');
    assert.match(renderSource, /continuousAnimationDelay\(1500,\s*node\.runStartedAt\)/);
    assert.match(renderSource, /continuousAnimationDelay\(1350,\s*smartAncestorCascadeRun\?\.startedAt\)/);
    assert.match(renderSource, /--loading-shimmer-delay:\$\{shimmerDelay\}ms/);
    assert.match(renderSource, /--ancestor-node-delay:\$\{ancestorNodeDelay\}ms/);
    assert.match(cssSource, /animation-delay:var\(--loading-shimmer-delay,\s*0ms\)/);
    assert.match(cssSource, /animation-delay:var\(--ancestor-node-delay,\s*0ms\)/);
});

test('collapsed prompt resizing does not reinterpret exact legacy heights', () => {
    const sandbox = vm.createContext({
        node:{type:'smart-prompt', w:316, h:340},
        isSmartGroupCompactMember:() => false,
        promptNodeMinHeight:() => 170,
        PROMPT_NODE_DEFAULT_W:316,
        Math,
        Number
    });
    vm.runInContext(`${extractFunction('promptNodeLayoutSize')}\nglobalThis.heights = [194, 230, 292, 340, 400].map(h => promptNodeLayoutSize({...node, h}).height);`, sandbox);
    assert.deepEqual([...sandbox.heights], [194, 230, 292, 340, 400]);
});

test('collapsed prompt nodes and their text box use the smaller minimum height', () => {
    const minHeightSource = extractFunction('promptNodeMinHeight');
    assert.match(minHeightSource, /PROMPT_NODE_COLLAPSED_MIN_H\s*\+\s*promptNodeSplitExtraHeight/);
    assert.match(source, /const PROMPT_NODE_COLLAPSED_MIN_H = 170;/);
    assert.match(cssSource, /\.prompt-node-text\s*\{[^}]*min-height:48px;/);
});

test('expanded prompt layouts reserve the same smaller text-box minimum', () => {
    assert.match(source, /const PROMPT_NODE_EXPANDED_BASE_H = 320;/);
    assert.match(extractFunction('promptNodeExpandedHeight'), /return PROMPT_NODE_EXPANDED_BASE_H \+/);
});

test('node resize owns the cursor and clears magnetic port state', () => {
    const bindSource = extractFunction('bindNodeEvents');
    assert.match(bindSource, /resetMagneticPort\(\);[\s\S]*classList\.add\('smart-node-resize',\s*'smart-node-box-resize'\)/);
    assert.match(cssSource, /body\.smart-node-box-resize \.shell \* \{\s*cursor:nwse-resize !important;/);
    assert.match(cssSource, /body\.smart-node-box-resize \.node-port \{\s*pointer-events:none !important;/);
});

test('unselected paused video actions retain a transparent hit area and normal auto-hide', () => {
    assert.match(
        cssSource,
        /\.image-node:has\(\.smart-canvas-video\[data-smart-user-paused="1"\]\)\s*>\s*\.floating-node-actions\s*\{\s*pointer-events:auto;\s*\}/
    );
    assert.doesNotMatch(
        cssSource,
        /\.image-node:has\(\.smart-canvas-video\[data-smart-user-paused="1"\]\)\s*>\s*\.floating-node-actions\s*\{[^}]*opacity:1;/
    );
    const bindNodeSource = extractFunction('bindNodeEvents');
    assert.match(bindNodeSource, /actions\.addEventListener\('mouseenter',[\s\S]*classList\.add\('is-controls-interacting'\)/);
    assert.match(bindNodeSource, /actions\.addEventListener\('mouseleave',[\s\S]*classList\.remove\('is-controls-interacting'\)/);
});

test('video action chrome does not activate ports or interrupt hover playback', () => {
    const magneticPortSource = extractFunction('updateMagneticPort');
    assert.match(magneticPortSource, /\.floating-node-actions/);
    assert.match(magneticPortSource, /\.smart-video-controls/);
    assert.match(magneticPortSource, /\.smart-video-capture-menu/);
    assert.match(cssSource, /\.floating-node-actions\s*\{[^}]*cursor:default;/);
    assert.match(cssSource, /\.smart-video-capture-menu\s*\{[^}]*cursor:default;/);

    const bindVideoSource = extractFunction('bindSmartCanvasVideo');
    assert.match(bindVideoSource, /event\.relatedTarget\?\.closest\?\.\('\.floating-node-actions,\.image-resolution-badge'\)/);
    const bindNodeSource = extractFunction('bindNodeEvents');
    assert.match(bindNodeSource, /if\(videoHost\.contains\(event\.relatedTarget\)\)\s*return;/);
    assert.match(bindNodeSource, /!isNodeSelected\(id\)[\s\S]*resetSmartCanvasVideo\(video\)/);
});

test('video node border remains highlighted while hovering its floating actions', () => {
    assert.match(
        cssSource,
        /\.image-node:has\(>\s*\.floating-node-actions:hover\)\s+\.image-wrap\s*>\s*\.media-video-card\s*\{\s*border-color:var\(--strong\);\s*\}/
    );
});

test('video resolution badge uses a normal cursor without interrupting hover playback', () => {
    assert.match(
        cssSource,
        /:is\(\.image-wrap,\.thumb-item\):has\(\.smart-canvas-video\[data-smart-has-played="1"\]\)\s*>\s*\.image-resolution-badge\s*\{[^}]*pointer-events:auto;[^}]*cursor:default;/
    );
    assert.match(
        cssSource,
        /\.shell\.port-magnetic-ready\s+\.image-wrap:has\(\.smart-canvas-video\)\s*>\s*\.image-resolution-badge\s*\{\s*cursor:default !important;\s*\}/
    );
    const bindVideoSource = extractFunction('bindSmartCanvasVideo');
    assert.match(bindVideoSource, /\.floating-node-actions,\.image-resolution-badge/);
    assert.match(extractFunction('updateMagneticPort'), /\.image-resolution-badge/);
    const bindNodeSource = extractFunction('bindNodeEvents');
    assert.match(bindNodeSource, /querySelectorAll\('\.image-resolution-badge'\)[\s\S]*badge\.addEventListener\('mouseenter'/);
    assert.match(bindNodeSource, /badge\.addEventListener\('mouseleave'[\s\S]*resetSmartCanvasVideo\(video\)/);
});

test('live generation force-hides and disables all hover video chrome', () => {
    assert.match(
        cssSource,
        /\.image-node\.node-generating \.floating-node-actions,[\s\S]*?\.image-node\.node-generating \.node-resize-handle\s*\{[\s\S]*?opacity:0 !important;[\s\S]*?pointer-events:none !important;/
    );
    assert.match(
        cssSource,
        /\.image-node\.node-generating \.smart-canvas-video-host\s*\{\s*pointer-events:none !important;\s*\}/
    );
    assert.match(
        cssSource,
        /\.image-node\.node-generating \.smart-canvas-video-host \.smart-video-controls,[\s\S]*?\.smart-video-capture-menu,[\s\S]*?\.smart-video-play\s*\{[\s\S]*?opacity:0 !important;[\s\S]*?visibility:hidden !important;[\s\S]*?pointer-events:none !important;[\s\S]*?transition:none !important;/
    );
});

test('hover preview marks the complete ancestor chain before execution', () => {
    const preview = {
        stepIds:['a','target'],
        reachableIds:['upload','a','checkpoint','hidden-upstream','target'],
        skippedIds:['checkpoint','hidden-upstream'],
        pinnedBoundaryIds:['checkpoint']
    };
    const sandbox = vm.createContext({smartAncestorCascadeRun:null, smartAncestorCascadePreview:preview});
    vm.runInContext(
        `${extractFunction('smartAncestorNodeVisualState')}
        globalThis.states = ['outside','upload','a','checkpoint','hidden-upstream','target'].map(smartAncestorNodeVisualState);`,
        sandbox
    );
    assert.deepEqual([...sandbox.states], ['', 'source', 'preview', 'boundary', 'skipped', 'preview']);
});

test('ancestor route keeps normal selection flow except on the actively moving edge', () => {
    const connectionRenderer = extractFunction('renderConnections');
    assert.match(connectionRenderer, /hasSelectionFlow = isSelectedLine && !\(isAncestorCascade && ancestorState === 'active'\)/);
    assert.match(connectionRenderer, /conn-ancestor-flow/);
    assert.match(connectionRenderer, /conn-ancestor-preview/);
    assert.match(connectionRenderer, /conn-ancestor-skipped/);
    assert.match(connectionRenderer, /conn-selection-flow-ancestor/);
    assert.match(connectionRenderer, /conn-selection-flow-ancestor-skipped/);
    assert.match(connectionRenderer, /conn-ancestor-selected/);
    assert.match(connectionRenderer, /conn-ancestor-flow-selected/);
    assert.match(connectionRenderer, /cutControl = !isAncestorContextLine/);
});
