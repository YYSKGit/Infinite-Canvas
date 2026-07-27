import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const sourcePath = fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

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
