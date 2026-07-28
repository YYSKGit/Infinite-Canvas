import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const jsSource = readFileSync(fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url)), 'utf8');
const cssSource = readFileSync(fileURLToPath(new URL('../static/css/smart-canvas.css', import.meta.url)), 'utf8');
const backendSource = readFileSync(fileURLToPath(new URL('../main.py', import.meta.url)), 'utf8');

function extractFunction(name){
    const markers = [`function ${name}(`, `async function ${name}(`];
    const starts = markers.map(marker => jsSource.indexOf(marker)).filter(index => index >= 0);
    assert.ok(starts.length, `missing production function ${name}`);
    const start = Math.min(...starts);
    const bodyStart = jsSource.indexOf('{', start);
    let depth = 0;
    let quote = '';
    let escaped = false;
    for(let index = bodyStart; index < jsSource.length; index++){
        const char = jsSource[index];
        if(quote){
            if(escaped) escaped = false;
            else if(char === '\\') escaped = true;
            else if(char === quote) quote = '';
            continue;
        }
        if(char === "'" || char === '"' || char === '`'){
            quote = char;
            continue;
        }
        if(char === '{') depth++;
        else if(char === '}' && --depth === 0) return jsSource.slice(start, index + 1);
    }
    assert.fail(`unterminated production function ${name}`);
}

test('cancelled RunningHub logs retain the task id', () => {
    const sandbox = vm.createContext({
        cloneSmartSettings:value => structuredClone(value),
        runningHubLogDescriptor:() => ({kind:'workflow', id:'wf-1', label:'Workflow'})
    });
    vm.runInContext(`
        ${extractFunction('smartRunRequestMeta')}
        globalThis.meta = smartRunRequestMeta({
            kind:'image',
            settings:{engine:'runninghub', rhPayment:'wallet'},
            runningHub:{kind:'workflow', id:'wf-1', label:'Workflow'},
            taskIds:['rh-task-123']
        });
    `, sandbox);
    assert.equal(sandbox.meta.provider_id, 'runninghub');
    assert.equal(sandbox.meta.task_id, 'rh-task-123');
    assert.equal(sandbox.meta.workflowId, 'wf-1');
    assert.equal(sandbox.meta.useWallet, true);
});

test('generation nodes expose a dedicated cancel control and cancelled log style', () => {
    assert.match(jsSource, /data-smart-task-cancel=/);
    assert.match(jsSource, /cancelSmartNodeGeneration\(btn\.dataset\.smartTaskCancel/);
    assert.doesNotMatch(jsSource, /class="smart-task-cancel"[^>]*>[\s\S]*?<span>取消<\/span>/);
    assert.match(jsSource, /const statusText = logCancelled \? '取消' :/);
    assert.match(cssSource, /\.smart-task-cancel\s*\{/);
    assert.match(cssSource, /\.smart-task-cancel\s*\{[^}]*width:26px;[^}]*padding:0;/);
    assert.match(cssSource, /\.log-chip\.status-cancelled\s*\{/);
    assert.match(jsSource, /status:'cancelled'/);
    assert.match(jsSource, /log\.error && !logCancelled/);
});

test('timer and cancel corner controls do not overlap, and the composer run button becomes stop', () => {
    assert.match(cssSource, /\.image-node\.node-generating \.run-time-pill\s*\{[^}]*right:39px;[^}]*min-width:26px;[^}]*height:26px;[^}]*padding:0 5px;[^}]*border-radius:10px;/);
    assert.match(cssSource, /\.image-node\.node-generating \.run-time-pill::after\s*\{[^}]*left:100%;[^}]*width:6px;[^}]*background:transparent;[^}]*pointer-events:auto;[^}]*cursor:default;/);
    assert.match(cssSource, /\.smart-task-cancel\s*\{[^}]*width:26px;[^}]*height:26px;[^}]*border-radius:10px;/);
    assert.match(cssSource, /\.smart-task-cancel i,\.smart-task-cancel svg\s*\{[^}]*width:11px;[^}]*height:11px;/);
    assert.match(cssSource, /\.run-time-pill\s*\{[^}]*right:7px;[^}]*top:7px;[^}]*min-width:26px;[^}]*height:26px;[^}]*padding:0 5px;[^}]*border-radius:10px;/);
    assert.match(cssSource, /\.run-time-pill\s*\{[^}]*pointer-events:auto;[^}]*cursor:default;/);
    assert.match(jsSource, /querySelectorAll\('\.run-time-pill'\)[\s\S]*?\['pointerdown', 'mousedown', 'click', 'dblclick'\][\s\S]*?stopImmediatePropagation\(\)/);
    assert.match(cssSource, /\.run-time-pill\.done\s*\{[^}]*background:rgba\(6,95,70,\.86\);/);
    assert.match(cssSource, /\.image-node:has\(\.node-port:is\(:hover,\.is-magnetic,\.is-active,\.is-caught\)\) \.run-time-pill:is\(\.done,\.failed,\.cancelled\)\s*\{\s*opacity:0;/);
    assert.match(cssSource, /\.run-btn\.is-stop\s*\{/);
    const syncButton = extractFunction('syncRunButtonState');
    assert.match(syncButton, /smartRunButtonCancelTarget\(node\)/);
    assert.match(syncButton, /data-lucide="square"/);
    assert.match(syncButton, /classList\.toggle\('is-stop', stopping\)/);
    const clickStart = jsSource.indexOf('runBtn.onclick = event => {');
    const clickEnd = jsSource.indexOf('cascadeRunBtn.onclick', clickStart);
    assert.match(
        jsSource.slice(clickStart, clickEnd),
        /smartRunButtonCancelTarget\(\)[\s\S]*?cancelSmartNodeGeneration\(cancelTarget\.id\)[\s\S]*?runGeneration\(event\)/
    );
});

test('cancelled polling cannot turn retained pre-run images into a success log', () => {
    const start = jsSource.indexOf('async function runGeneration(');
    const end = jsSource.indexOf('async function runPromptLLMNode(', start);
    const runGeneration = jsSource.slice(start, end);
    assert.match(
        runGeneration,
        /await resumeSmartPendingNode\(pendingNode,[\s\S]*?throwIfSmartGenerationCancelled\(runSignal\);[\s\S]*?if\(pendingNode\.jimengPending[\s\S]*?addSmartGenerationLog\(\{run:runLog,\s*outputs:pendingNode\.images/
    );
    const loopStart = jsSource.indexOf('async function runLoopRoundIntoSlot(');
    const loopEnd = jsSource.indexOf('function appendCascadeRefsToReceiver(', loopStart);
    assert.match(
        jsSource.slice(loopStart, loopEnd),
        /await resumeSmartPendingNode\(outputSlot,[\s\S]*?throwIfSmartGenerationCancelled\(roundRunContext\.controller\.signal\);/
    );
    const cascadeStart = jsSource.indexOf('async function runCascadeStepIntoNode(');
    const cascadeEnd = jsSource.indexOf('async function runLoopRoundIntoSlot(', cascadeStart);
    assert.match(
        jsSource.slice(cascadeStart, cascadeEnd),
        /registerSmartGenerationRun\(outputNode,[\s\S]*?await generateUrlsForCurrentSettings\([\s\S]*?cascadeRunContext\)[\s\S]*?throwIfSmartGenerationCancelled\(cascadeRunContext\.controller\.signal\);/
    );
});

test('RunningHub cancellation is proxied through the server without exposing the API key', () => {
    assert.match(backendSource, /@app\.post\("\/api\/runninghub\/cancel"\)/);
    assert.match(backendSource, /runninghub_endpoint_url\(provider,\s*"\/task\/openapi\/cancel"\)/);
    assert.match(backendSource, /body\s*=\s*\{"apiKey":\s*api_key,\s*"taskId":\s*task_id\}/);
    assert.match(jsSource, /JSON\.stringify\(\{taskId,\s*useWallet:Boolean\(useWallet\)\}\)/);
});

test('RunningHub realtime progress is proxied and signed upstream URLs stay server-side', () => {
    assert.match(backendSource, /@app\.websocket\("\/ws\/runninghub-progress"\)/);
    assert.match(backendSource, /runninghub_progress_socket_url\(raw\)/);
    assert.match(backendSource, /websockets\.connect\(\s*upstream_url/);
    assert.match(backendSource, /runninghub_progress_workflow_id\(upstream_url\)/);
    assert.match(backendSource, /"\/api\/openapi\/getJsonApiFormat"/);
    assert.match(backendSource, /\{"type":\s*"node_map",\s*"data":\s*\{"nodes":\s*node_map\}\}/);
    assert.match(backendSource, /event_type not in \{[\s\S]*?"execution_start"[\s\S]*?"executing"[\s\S]*?"progress"[\s\S]*?"execution_success"/);
    const submitStart = backendSource.indexOf('async def runninghub_submit(');
    const submitEnd = backendSource.indexOf('@app.post("/api/runninghub/workflow-submit")', submitStart);
    const workflowStart = submitEnd;
    const workflowEnd = backendSource.indexOf('@app.get("/api/runninghub/workflow-info")', workflowStart);
    assert.doesNotMatch(backendSource.slice(submitStart, submitEnd), /"raw":\s*raw/);
    assert.doesNotMatch(backendSource.slice(workflowStart, workflowEnd), /"raw":\s*raw/);
    assert.match(jsSource, /\/ws\/runninghub-progress\?taskId=/);
    assert.match(jsSource, /\/api\/runninghub\/query\?taskId=.*?useWallet=/);
});

test('RunningHub progress uses a smooth inset border and a persistent resolution-style node badge', () => {
    assert.match(jsSource, /\$\{runningHubProgressBorderHtml\(node,\s*layout\)\}/);
    assert.match(cssSource, /\.rh-progress-border-host\s*\{[^}]*position:absolute;[^}]*pointer-events:none;/);
    assert.match(cssSource, /\.rh-progress-node-badge\.image-resolution-badge\s*\{[^}]*opacity:1\s*!important;/);
    assert.match(cssSource, /@keyframes rh-progress-orbit/);
    assert.match(cssSource, /\.rh-progress-stroke\.is-segment-active/);
    assert.match(cssSource, /animation-delay:var\(--rh-progress-delay,\s*0ms\)/);
    assert.match(cssSource, /stroke-dasharray \.32s cubic-bezier/);
    assert.match(jsSource, /patchRunningHubProgressHost\(currentHost,\s*fresh\)/);

    const sandbox = vm.createContext({
        Date:{now:() => 5000},
        nodeRect:() => ({width:260, height:180}),
        escapeHtml:value => String(value)
    });
    vm.runInContext(`
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('runningHubTaskFraction')}
        ${extractFunction('runningHubProgressLabel')}
        ${extractFunction('runningHubProgressBorderHtml')}
        globalThis.single = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[{index:0,status:'running',nodeName:'KSampler',value:15,max:30}]}
        });
        globalThis.multi = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[
                {index:0,status:'succeeded',value:1,max:1},
                {index:1,status:'running',nodeName:'VAEDecode',value:null,max:null,startedAt:1000},
                {index:2,status:'queued',value:null,max:null}
            ]}
        });
        globalThis.unnamed = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[{index:0,status:'running',nodeId:'10',nodeName:'',value:null,max:null,startedAt:1000}]}
        });
    `, sandbox);
    assert.match(sandbox.single, /is-determinate/);
    assert.match(sandbox.single, /stroke-dasharray="50 50"/);
    assert.match(sandbox.single, /x="1" y="1"[\s\S]*rx="11"/);
    assert.match(sandbox.single, /image-resolution-badge rh-progress-node-badge/);
    assert.match(sandbox.single, /KSampler · 50%/);
    assert.equal((sandbox.multi.match(/class="rh-progress-stroke/g) || []).length, 3);
    assert.match(sandbox.multi, /1\/3 · VAEDecode/);
    assert.match(sandbox.multi, /--rh-progress-delay:-1300ms/);
    assert.doesNotMatch(sandbox.unnamed, />10<\/span>/);
});
