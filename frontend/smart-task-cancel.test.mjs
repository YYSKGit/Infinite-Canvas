import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const jsSource = readFileSync(fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url)), 'utf8');
const cssSource = readFileSync(fileURLToPath(new URL('../static/css/smart-canvas.css', import.meta.url)), 'utf8');
const i18nSource = readFileSync(fileURLToPath(new URL('../static/js/i18n/smart-canvas.js', import.meta.url)), 'utf8');
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
        ${extractFunction('smartLoggableTaskId')}
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

test('API image logs hide local wrapper ids and retain upstream ids', () => {
    const sandbox = vm.createContext({});
    vm.runInContext(`
        ${extractFunction('smartLoggableTaskId')}
        ${extractFunction('smartUpstreamTaskIdFromResult')}
        ${extractFunction('smartLogTaskIds')}
        ${extractFunction('smartRunRequestMeta')}
        globalThis.meta = smartRunRequestMeta({
            kind:'image',
            settings:{engine:'api', provider_id:'venice', model:'z-image-turbo'},
            taskIds:['canvas_img_local_1', 'upstream-1', 'canvas_img_local_2', 'upstream-2']
        });
        globalThis.upstream = smartUpstreamTaskIdFromResult(
            {task_id:'upstream-result-1', request_id:'request-fallback'},
            'canvas_img_local_1'
        );
        globalThis.visibleLegacyIds = smartLogTaskIds({
            task_id:'canvas_img_legacy',
            task_ids:['canvas_img_legacy', 'upstream-legacy']
        });
    `, sandbox);
    assert.equal(sandbox.meta.task_id, 'upstream-1');
    assert.deepEqual([...sandbox.meta.task_ids], ['upstream-1', 'upstream-2']);
    assert.equal(sandbox.upstream, 'upstream-result-1');
    assert.deepEqual([...sandbox.visibleLegacyIds], ['upstream-legacy']);
    assert.match(jsSource, /const upstreamTaskId = smartUpstreamTaskIdFromResult\(result, taskId\);[\s\S]*?rememberSmartRunTaskId\(runContext, upstreamTaskId\)/);
    assert.match(jsSource, /const taskIdSummary = taskIds\.length \? `ID \$\{taskIds\[0\]\}` : ''/);
    assert.doesNotMatch(jsSource, /remainingTaskIdCount|另有 \$\{/);
    assert.match(jsSource, /const taskIdTitle = taskIds\.map\(taskId => `ID \$\{taskId\}`\)\.join\('\\n'\)/);
    assert.doesNotMatch(jsSource, /const backend = legacyRunningHubMetadata/);
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
    assert.match(jsSource, /const copied = await copyTextToClipboard\(text\);[\s\S]*?toast\(copied \? tr\('canvas\.copied'\) : tr\('canvas\.copyFailed'\)\)/);
    assert.match(cssSource, /\.toast\s*\{[^}]*position:fixed;[^}]*z-index:2147483000;/);
    assert.doesNotMatch(jsSource, /el\.textContent = copied \?/);
    assert.doesNotMatch(jsSource, /log-copy-feedback/);
    assert.doesNotMatch(cssSource, /\.log-copy-feedback/);
});

test('timer and cancel corner controls do not overlap, and the composer run button becomes stop', () => {
    assert.match(cssSource, /\.image-node\.node-generating \.run-time-pill\s*\{[^}]*right:39px;[^}]*min-width:26px;[^}]*height:26px;[^}]*padding:0 5px;[^}]*border-radius:10px;/);
    assert.match(cssSource, /\.image-node\.node-generating \.run-time-pill::after\s*\{[^}]*left:100%;[^}]*width:6px;[^}]*background:transparent;[^}]*pointer-events:auto;[^}]*cursor:default;/);
    assert.match(cssSource, /\.smart-task-cancel\s*\{[^}]*width:26px;[^}]*height:26px;[^}]*border-radius:10px;/);
    assert.match(cssSource, /\.smart-task-cancel i,\.smart-task-cancel svg\s*\{[^}]*width:11px;[^}]*height:11px;/);
    assert.match(cssSource, /\.run-time-pill\s*\{[^}]*right:7px;[^}]*top:7px;[^}]*min-width:26px;[^}]*height:26px;[^}]*padding:0 5px;[^}]*border-radius:10px;/);
    assert.match(cssSource, /\.run-time-pill\s*\{[^}]*pointer-events:auto;[^}]*cursor:default;/);
    assert.match(cssSource, /body\.smart-node-drag \.image-node:hover \.floating-node-actions,\s*body\.smart-node-drag \.image-node:hover \.run-time-pill,\s*body\.smart-node-drag \.image-node:hover \.rh-progress-node-badge\.image-resolution-badge,[\s\S]*?\{\s*opacity:0 !important;\s*pointer-events:none !important;/);
    assert.doesNotMatch(cssSource, /body\.smart-node-drag \.image-node \.(?:run-time-pill|rh-progress-node-badge)/);
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

test('generated nodes expose a quick run button that reuses single-node generation', () => {
    assert.match(jsSource, /const floatingActions = `\$\{floatingCancelBtn\}\$\{floatingPinBtn\}\$\{floatingRunBtn\}\$\{floatingDeleteBtn\}`/);
    assert.match(jsSource, /data-smart-node-run=/);
    assert.match(jsSource, /runSmartNodeQuick\(btn\.dataset\.smartNodeRun \|\| id\)/);
    const quickRun = extractFunction('runSmartNodeQuick');
    assert.match(quickRun, /runGeneration\(null,\s*\{nodeId\}\)/);
    assert.match(cssSource, /\.mini-x\.smart-node-run-btn\s*\{/);
});

test('every completed node-group type exposes a far-right node delete action', () => {
    assert.match(jsSource, /const isDeletableNodeGroup = !isPending && \(isGroup \|\| isHistory \|\| isSmartGroup\);/);
    assert.match(jsSource, /isDeletableNodeGroup[\s\S]*?class="mini-x node-delete"/);
    assert.match(jsSource, /const floatingActions = `\$\{floatingCancelBtn\}\$\{floatingPinBtn\}\$\{floatingRunBtn\}\$\{floatingDeleteBtn\}`/);
    assert.match(jsSource, /const floatingRunBtn = floatingPinBtn && hadStandardFloatingDelete/);
});

test('ordinary media groups reuse the smart-group summary header and reserve its height', () => {
    assert.match(jsSource, /const MEDIA_GROUP_SUMMARY_SPACE = 28;/);
    assert.match(jsSource, /function mediaGroupSummaryHtml\(items, expectedCount=0, expectedKind=''\)[\s\S]*?class="smart-group-summary media-group-summary"/);
    assert.match(jsSource, /class="smart-group-card media-group-card has-thumbs"/);
    assert.match(jsSource, /height = visibleRows \* cell - 8 \+ PAD \+ MEDIA_GROUP_SUMMARY_SPACE/);
    assert.match(jsSource, /h:visibleRows \* cell - 8 \+ pad \+ MEDIA_GROUP_SUMMARY_SPACE/);
    assert.match(cssSource, /\.image-node\.group-node \.node-body\s*\{[^}]*padding:0/);
    assert.match(cssSource, /\.smart-group-card\.media-group-card \.thumb-grid\s*\{/);
});

test('multi-task generation uses the same media-group summary without resetting progress cells', () => {
    assert.match(jsSource, /function smartProgressTaskGroupBodyHtml\(node, layout=null, progressTaskGrid=''\)/);
    assert.match(jsSource, /class="smart-group-card media-group-card smart-progress-group-card has-thumbs"/);
    assert.match(jsSource, /if\(progressTaskGrid\) return smartProgressTaskGroupBodyHtml\(node, layout, progressTaskGrid\);/);
    assert.match(jsSource, /querySelector\(':scope > \.node-body \.smart-progress-task-grid'\)/);
    assert.match(jsSource, /if\(currentGrid\)\{[\s\S]*?patchSmartProgressTaskGrid\(currentGrid, freshGrid\)/);
    assert.match(jsSource, /class="smart-group-card media-group-card smart-pending-group-card has-thumbs"/);
    assert.match(jsSource, /Number\(node\.pending\) > 1/);
    assert.match(cssSource, /\.smart-progress-group-card \.smart-progress-task-grid\s*\{[^}]*flex:1 1 auto/);
    assert.match(cssSource, /\.smart-pending-group-card \.loading-skeleton\s*\{[^}]*width:100% !important/);
});

test('re-generation archives the current batch before dispatch and never restores it on failure', () => {
    const start = jsSource.indexOf('async function runGeneration(');
    const end = jsSource.indexOf('async function runPromptLLMNode(', start);
    const runGeneration = jsSource.slice(start, end);
    assert.match(
        runGeneration,
        /archiveCurrentOutputsToHistory\(pendingNode,[\s\S]*?registerSmartGenerationRun\(pendingNode/
    );
    assert.doesNotMatch(runGeneration, /markReplaceExistingOutputsOnNextResult/);
    assert.doesNotMatch(
        runGeneration,
        /catch\(e\)[\s\S]*?restoreFromExtraction\(node,\s*extracted\)/
    );
    assert.doesNotMatch(
        runGeneration,
        /if\(branchNode\)\s*\{\s*nodes = nodes\.filter/
    );
});

test('archived media share a stable batch id and stay ahead of older history', () => {
    const history = {images:[{url:'/older.png', kind:'image', historyBatchId:'older'}]};
    const sandbox = vm.createContext({
        history,
        nowMs:() => 2000,
        uid:() => 'history_batch_new',
        liveSmartNode:node => node,
        cleanHistoryImages:items => items.map(item => ({...item})),
        ensureHistoryGroupForNode:() => history,
        syncHistoryNodePromptFromImages:() => {},
        MEDIA_GROUP_DEFAULT_SCALE:0.82
    });
    vm.runInContext(`
        ${extractFunction('archiveCurrentOutputsToHistory')}
        const node = {
            images:[{url:'/one.png', kind:'image'}, {url:'/two.png', kind:'image'}],
            runStatus:'partial',
            runExpectedCount:3
        };
        globalThis.archived = archiveCurrentOutputsToHistory(node, 'image');
        globalThis.node = node;
        globalThis.history = history;
    `, sandbox);
    assert.equal(sandbox.archived, true);
    assert.deepEqual([...sandbox.node.images], []);
    assert.deepEqual(
        [...sandbox.history.images.map(item => item.url)],
        ['/one.png', '/two.png', '/older.png']
    );
    assert.equal(sandbox.history.images[0].historyBatchId, 'history_batch_new');
    assert.equal(sandbox.history.images[1].historyBatchId, 'history_batch_new');
    assert.equal(sandbox.history.images[0].historyBatchStatus, 'partial');
    assert.equal(sandbox.history.images[0].historyBatchExpectedCount, 3);
});

test('failed and cancelled empty slots expose an in-node retry using the saved request snapshot', () => {
    assert.match(jsSource, /data-smart-retry=/);
    assert.match(jsSource, /runSmartNodeRetry\(btn\.dataset\.smartRetry \|\| id\)/);
    assert.match(cssSource, /\.smart-run-terminal\s*\{/);
    assert.match(cssSource, /\.smart-run-retry\s*\{/);
    const sandbox = vm.createContext({
        nodes:[{id:'node-1', runRetrySnapshot:{prompt:'saved', settings:{engine:'api'}}}],
        smartNodeRunDisabled:() => false,
        cloneSmartRetrySnapshot:value => structuredClone(value),
        runGeneration:(_event, options) => options
    });
    vm.runInContext(`
        ${extractFunction('runSmartNodeRetry')}
        globalThis.options = runSmartNodeRetry('node-1');
    `, sandbox);
    assert.equal(sandbox.options.nodeId, 'node-1');
    assert.equal(sandbox.options.retrySnapshot.prompt, 'saved');
});

test('history keeps its original flat grid and only marks media from the previous run', () => {
    assert.match(jsSource, /historyBatchId/);
    assert.match(jsSource, /historyBatchExpectedCount/);
    assert.match(jsSource, /historyBatchStatus/);
    assert.match(jsSource, /class="history-previous-badge"/);
    assert.match(cssSource, /\.history-previous-badge\s*\{/);
    assert.match(i18nSource, /"smart\.historyPreviousRun":\s*\{\s*zh:\s*"NEW",\s*en:\s*"NEW"\s*\}/);
    assert.match(cssSource, /:has\(> \.image-resolution-badge\):is\(:hover,\.image-selected\) > \.history-previous-badge\s*,/);
    assert.doesNotMatch(jsSource, /class="history-batch-label"/);
    assert.doesNotMatch(cssSource, /\.history-batch-label/);
});

test('automatic media group widths reserve room only when a vertical scrollbar is needed', () => {
    const sandbox = vm.createContext({});
    vm.runInContext(`
        const MEDIA_GROUP_SCROLLBAR_SPACE = 6;
        ${extractFunction('mediaGroupScrollbarSpace')}
        globalThis.withoutScroll = mediaGroupScrollbarSpace(3, 3);
        globalThis.withScroll = mediaGroupScrollbarSpace(4, 3);
    `, sandbox);
    assert.equal(sandbox.withoutScroll, 0);
    assert.equal(sandbox.withScroll, 6);
    assert.match(extractFunction('imageLayout'), /cols \* cell \+ PAD \+ mediaGroupScrollbarSpace\(rows, visibleRows\)/);
    assert.match(extractFunction('smartGroupThumbLayout'), /gridW \+ outerPad \+ mediaGroupScrollbarSpace\(rows, visibleRows\)/);
    assert.match(jsSource, /function pendingBoxSize\([\s\S]*?cols \* cell \+ pad \+ mediaGroupScrollbarSpace\(rows, visibleRows\)/);
});

test('undo snapshots captured during generation render as history state instead of an upload node', () => {
    const sandbox = vm.createContext({
        nodeHasLiveRunState:node => Boolean(node?.running || node?.pending)
    });
    vm.runInContext(`
        ${extractFunction('isHistoricalRunningSnapshotNode')}
        globalThis.historical = isHistoricalRunningSnapshotNode({
            type:'smart-image',
            images:[],
            runStatus:'running',
            running:false,
            pending:0
        });
        globalThis.live = isHistoricalRunningSnapshotNode({
            type:'smart-image',
            images:[],
            runStatus:'running',
            pending:1
        });
        globalThis.blank = isHistoricalRunningSnapshotNode({
            type:'smart-image',
            images:[],
            runStatus:''
        });
    `, sandbox);
    assert.equal(sandbox.historical, true);
    assert.equal(sandbox.live, false);
    assert.equal(sandbox.blank, false);
    assert.match(extractFunction('nodeBodyHtml'), /isHistoricalRunningSnapshotNode\(node\).*historicalRunningSnapshotBodyHtml\(\)/s);
    const nodeBody = extractFunction('nodeBodyHtml');
    assert.ok(
        nodeBody.indexOf('isHistoricalRunningSnapshotNode(node)') < nodeBody.indexOf('smartProgressTaskGridHtml(node, layout)'),
        'historical snapshots must replace stale multi-task progress grids'
    );
    const groupSandbox = vm.createContext({
        isHistoricalRunningSnapshotNode:() => true,
        runningHubProgressTasks:node => node?.tasks || []
    });
    vm.runInContext(`
        ${extractFunction('isHistoricalRunningSnapshotGroupNode')}
        globalThis.single = isHistoricalRunningSnapshotGroupNode({runExpectedCount:1});
        globalThis.group = isHistoricalRunningSnapshotGroupNode({runExpectedCount:2});
        globalThis.progressGroup = isHistoricalRunningSnapshotGroupNode({tasks:[{}, {}]});
    `, groupSandbox);
    assert.equal(groupSandbox.single, false);
    assert.equal(groupSandbox.group, true);
    assert.equal(groupSandbox.progressGroup, true);
    assert.match(jsSource, /isHistoricalRunningSnapshot && !isHistoricalRunningSnapshotGroup \? '' :/);
    assert.match(i18nSource, /"smart\.historyRunSnapshotNodeTitle":\s*\{\s*zh:\s*"历史状态",\s*en:\s*"History State"\s*\}/);
    assert.match(cssSource, /\.historical-running-snapshot\s*\{/);
});

test('cancelled polling cannot turn the archived empty current slot into a success log', () => {
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

test('single-task progress keeps its outer border while multi-task progress moves into named task cells', () => {
    assert.match(jsSource, /\$\{runningHubProgressBorderHtml\(node,\s*layout\)\}/);
    assert.match(cssSource, /\.rh-progress-border-host\s*\{[^}]*position:absolute;[^}]*pointer-events:none;/);
    assert.match(cssSource, /\.rh-progress-node-badge\.image-resolution-badge\s*\{[^}]*opacity:1\s*!important;/);
    assert.doesNotMatch(cssSource, /\.image-node\.dragging \.rh-progress-node-badge\.image-resolution-badge\s*\{[^}]*opacity:1\s*!important;/);
    assert.match(cssSource, /@keyframes rh-progress-orbit/);
    assert.match(cssSource, /\.smart-progress-task-grid\s*\{/);
    assert.match(cssSource, /\.smart-progress-task-breathe\s*\{/);
    assert.match(cssSource, /\.smart-progress-task-value\s*\{/);
    assert.match(cssSource, /@keyframes smart-task-border-breathe/);
    assert.match(cssSource, /@keyframes smart-task-halo-breathe/);
    assert.match(cssSource, /width:52cqmin;\s*height:52cqmin;/);
    assert.match(cssSource, /\.smart-progress-task-cell:not\(\.is-queued\):not\(\.is-complete\):not\(\.is-terminal\) \.smart-progress-task-placeholder-dot::before\s*\{/);
    assert.match(cssSource, /animation:smart-task-border-breathe 1\.8s ease-in-out infinite/);
    assert.match(cssSource, /animation:smart-task-halo-breathe 1\.8s ease-in-out infinite/);
    assert.match(cssSource, /\.smart-progress-task-breathe\.is-layer-hidden\s*\{[^}]*stroke-opacity:0;/);
    assert.match(cssSource, /\.smart-progress-task-placeholder-dot::before\s*\{[\s\S]*?background:radial-gradient/);
    assert.match(cssSource, /transition:opacity \.36s cubic-bezier\(\.22,1,\.36,1\),filter \.36s ease/);
    assert.match(cssSource, /\.smart-progress-task-content\s*\{[^}]*inset:0;/);
    assert.match(cssSource, /animation-delay:var\(--smart-task-pulse-delay,\s*0ms\)/);
    assert.doesNotMatch(cssSource, /\.smart-progress-task-rail/);
    assert.match(cssSource, /animation-delay:var\(--rh-progress-delay,\s*0ms\)/);
    assert.match(cssSource, /stroke-dasharray \.38s cubic-bezier/);
    assert.match(cssSource, /\.rh-progress-stroke\.is-layer-hidden\s*\{[^}]*opacity:0\s*!important;/);
    assert.match(jsSource, /patchRunningHubProgressHost\(currentHost,\s*fresh\)/);
    assert.match(jsSource, /preservePhase\s*\?\s*\['style'\]\s*:\s*\[\]/);
    assert.match(jsSource, /function animateSmartProgressTaskValuePath\(path,\s*freshPath,\s*svg\)/);
    assert.match(jsSource, /const completionJump = to >= 99\.999 && from < 99\.999;/);
    assert.match(jsSource, /Math\.min\(900,\s*Math\.max\(560,\s*380 \+ Math\.abs\(to - from\) \* 5\)\)/);
    assert.match(jsSource, /alignSmartProgressTaskGridGeometry\(world\)/);
    assert.match(jsSource, /syncSmartProgressTaskSvgGeometry\(freshSvg,\s*cell\.clientWidth,\s*cell\.clientHeight\)/);
    assert.match(jsSource, /const preserveHaloPhase = smartProgressTaskCellHasActiveHalo\(cell\)\s*&& smartProgressTaskCellHasActiveHalo\(freshCell\);/);
    assert.match(jsSource, /syncRunningHubProgressElement\(cell,\s*freshCell,\s*preserveHaloPhase \? \['style'\] : \[\]\)/);
    assert.match(cssSource, /\.smart-progress-task-value\.is-complete\s*\{[^}]*stroke-linecap:butt;/);
    assert.match(jsSource, /const nodeId = String\(data\.node \?\? ''\)\.trim\(\);\s*if\(!nodeId\) return;/);

    const sandbox = vm.createContext({
        Date:{now:() => 5000},
        nodeRect:() => ({width:260, height:180}),
        escapeHtml:value => String(value),
        escapeAttr:value => String(value),
        mediaKindForItem:item => item?.kind || 'image',
        imageForDisplay:item => item,
        thumbMediaHtml:item => `<img src="${item?.url || ''}">`
    });
    vm.runInContext(`
        ${extractFunction('smartNodeProgressState')}
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('runningHubTaskFraction')}
        ${extractFunction('runningHubProgressLabel')}
        ${extractFunction('smartProgressTaskResultItems')}
        ${extractFunction('smartProgressTaskStatusParts')}
        ${extractFunction('smartProgressTaskStatusText')}
        ${extractFunction('smartProgressTaskValuePath')}
        ${extractFunction('smartProgressTaskGridHtml')}
        ${extractFunction('runningHubProgressBorderHtml')}
        globalThis.valuePath25 = smartProgressTaskValuePath(25);
        globalThis.valuePath50 = smartProgressTaskValuePath(50);
        globalThis.gridValuePath25 = smartProgressTaskValuePath(25, 118, 78, 1, 11);
        globalThis.singleRowValuePath25 = smartProgressTaskValuePath(25, 118, 164, 1, 11);
        globalThis.single = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[{index:0,status:'running',nodeName:'KSampler',value:15,max:30}]}
        });
        globalThis.multi = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[
                {index:0,status:'succeeded',value:1,max:1,resultItems:[{url:'/one.png',kind:'image'}]},
                {index:1,status:'running',nodeName:'VAEDecode',value:null,max:null,startedAt:1000},
                {index:2,status:'queued',value:null,max:null}
            ]}
        });
        globalThis.multiGrid = smartProgressTaskGridHtml({
            runningHubProgress:{tasks:[
                {index:0,status:'succeeded',value:1,max:1,resultItems:[{url:'/one.png',kind:'image'}]},
                {index:1,status:'running',nodeName:'VAEDecode',value:null,max:null,startedAt:1000},
                {index:2,status:'queued',value:null,max:null}
            ]}
        });
        globalThis.determinateGrid = smartProgressTaskGridHtml({
            veniceProgress:{tasks:[
                {index:0,status:'running',nodeName:'准备',value:0,max:4,startedAt:1000},
                {index:1,status:'running',nodeName:'K采样器',value:1,max:4,startedAt:1000}
            ]}
        });
        globalThis.unnamed = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[{index:0,status:'running',nodeId:'10',nodeName:'',value:null,max:null,startedAt:1000}]}
        });
    `, sandbox);
    assert.match(sandbox.single, /is-determinate/);
    assert.match(sandbox.single, /stroke-dasharray="50 50"/);
    assert.match(sandbox.single, /x="1" y="1"[\s\S]*rx="11"/);
    assert.match(sandbox.single, /rh-progress-orbit-layer is-indeterminate[\s\S]*is-layer-hidden/);
    assert.match(sandbox.single, /rh-progress-value-layer is-determinate/);
    assert.match(sandbox.single, /image-resolution-badge rh-progress-node-badge/);
    assert.match(sandbox.single, /KSampler · 50%/);
    assert.equal((sandbox.single.match(/class="rh-progress-stroke/g) || []).length, 2);
    assert.equal((sandbox.unnamed.match(/class="rh-progress-stroke/g) || []).length, 2);
    assert.match(sandbox.unnamed, /rh-progress-value-layer is-determinate is-layer-hidden[\s\S]*stroke-dasharray="0 100"/);
    assert.equal(sandbox.multi, '');
    assert.equal((sandbox.multiGrid.match(/smart-progress-task-cell /g) || []).length, 3);
    assert.equal((sandbox.multiGrid.match(/smart-progress-task-border/g) || []).length, 3);
    assert.equal((sandbox.multiGrid.match(/smart-progress-task-value/g) || []).length, 3);
    assert.match(sandbox.multiGrid, /viewBox="0 0 118 78"/);
    assert.match(sandbox.multiGrid, /M 1 66 L 1 12 A 11 11 0 0 1 12 1/);
    assert.match(sandbox.multiGrid, /L 12 77 A 11 11 0 0 1 1 66"/);
    assert.doesNotMatch(sandbox.multiGrid, /A 11 11 0 0 1 1 66 Z/);
    assert.doesNotMatch(sandbox.multiGrid, /stroke-dasharray/);
    assert.equal(sandbox.valuePath25, 'M 1 89 L 1 11 A 10 10 0 0 1 11 1');
    assert.equal(sandbox.valuePath50, 'M 1 89 L 1 11 A 10 10 0 0 1 11 1 L 89 1 A 10 10 0 0 1 99 11');
    assert.equal(sandbox.gridValuePath25, 'M 1 66 L 1 12 A 11 11 0 0 1 12 1 L 32 1');
    assert.equal(sandbox.singleRowValuePath25, 'M 1 152 L 1 17.721');
    assert.doesNotMatch(sandbox.multiGrid, /smart-progress-task-rail/);
    assert.match(sandbox.multiGrid, /smart-progress-task-cell[\s\S]*?is-complete[\s\S]*?data-progress-task-index="0"/);
    assert.match(sandbox.multiGrid, /data-progress-result-signature="image:\/one\.png"/);
    assert.match(sandbox.multiGrid, /is-running[\s\S]*?data-progress-task-index="1" style="--smart-task-pulse-delay:-590ms"/);
    assert.match(sandbox.multiGrid, /smart-progress-task-breathe "/);
    assert.match(sandbox.multiGrid, /smart-progress-task-value \s+is-layer-hidden/);
    assert.match(sandbox.multiGrid, /title="VAEDecode"><span class="smart-progress-task-status-name">VAEDecode<\/span><\/span>/);
    assert.doesNotMatch(sandbox.multiGrid, /title="VAEDecode · 运行中"/);
    assert.match(sandbox.multiGrid, /data-progress-task-index="2"/);
    assert.match(sandbox.multiGrid, /smart-progress-task-status-detail">等待<\/span>/);
    assert.match(sandbox.determinateGrid, /data-progress-task-index="0"[\s\S]*?smart-progress-task-value \s+is-layer-hidden[\s\S]*?d="M 1 152"/);
    assert.match(sandbox.determinateGrid, /data-progress-task-index="1"[\s\S]*?smart-progress-task-value [\s\S]*?d="M 1 152 L 1 17\.721"/);
    assert.match(sandbox.determinateGrid, /smart-progress-task-status-name">K采样器<\/span><span class="smart-progress-task-status-separator">·<\/span><span class="smart-progress-task-status-detail">25%<\/span>/);
    assert.doesNotMatch(sandbox.unnamed, />10<\/span>/);
});

test('RunningHub in-place progress patches preserve a live orbit phase', () => {
    const sandbox = vm.createContext({});
    vm.runInContext(`
        ${extractFunction('syncRunningHubProgressElement')}
        ${extractFunction('runningHubProgressAnimationMode')}
        const element = values => ({
            values:{...values},
            get attributes(){ return Object.entries(this.values).map(([name, value]) => ({name, value})); },
            getAttribute(name){ return this.values[name] ?? null; },
            setAttribute(name, value){ this.values[name] = value; },
            removeAttribute(name){ delete this.values[name]; }
        });
        const current = element({class:'rh-progress-stroke is-indeterminate', style:'--rh-progress-delay:-420ms'});
        const fresh = element({class:'rh-progress-stroke is-indeterminate', style:'--rh-progress-delay:-910ms'});
        syncRunningHubProgressElement(current, fresh, ['style']);
        globalThis.preservedStyle = current.values.style;
        const classElement = names => ({classList:{contains:name => names.includes(name)}});
        globalThis.runningMode = runningHubProgressAnimationMode(classElement(['is-indeterminate']));
        globalThis.queuedMode = runningHubProgressAnimationMode(classElement(['is-indeterminate','is-queued']));
    `, sandbox);
    assert.equal(sandbox.preservedStyle, '--rh-progress-delay:-420ms');
    assert.equal(sandbox.runningMode, 'indeterminate');
    assert.equal(sandbox.queuedMode, 'indeterminate');
});

test('multi-task center halos derive a stable phase across regenerated markup', () => {
    let fakeNow = 5000;
    const sandbox = vm.createContext({
        Date:{now:() => fakeNow},
        nodeRect:() => ({width:260, height:180}),
        escapeHtml:value => String(value),
        escapeAttr:value => String(value),
        mediaKindForItem:item => item?.kind || 'image',
        imageForDisplay:item => item,
        thumbMediaHtml:item => `<img src="${item?.url || ''}">`
    });
    vm.runInContext(`
        ${extractFunction('smartNodeProgressState')}
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('runningHubTaskFraction')}
        ${extractFunction('smartProgressTaskResultItems')}
        ${extractFunction('smartProgressTaskStatusParts')}
        ${extractFunction('smartProgressTaskStatusText')}
        ${extractFunction('smartProgressTaskValuePath')}
        ${extractFunction('smartProgressTaskGridHtml')}
        ${extractFunction('smartProgressTaskCellHasActiveHalo')}
        const node = {runningHubProgress:{tasks:[
            {index:0,status:'running',nodeName:'K采样器',value:null,max:null,startedAt:1000},
            {index:1,status:'queued',value:null,max:null,startedAt:1000}
        ]}};
        globalThis.firstGrid = smartProgressTaskGridHtml(node);
        const cell = (classes, hasDot=true) => ({
            classList:{contains:name => classes.includes(name)},
            querySelector:() => hasDot ? {} : null
        });
        globalThis.runningHalo = smartProgressTaskCellHasActiveHalo(cell(['is-running']));
        globalThis.determinateHalo = smartProgressTaskCellHasActiveHalo(cell(['is-determinate']));
        globalThis.queuedHalo = smartProgressTaskCellHasActiveHalo(cell(['is-queued']));
        globalThis.completeHalo = smartProgressTaskCellHasActiveHalo(cell(['is-complete']));
        globalThis.missingHalo = smartProgressTaskCellHasActiveHalo(cell(['is-running'], false));
    `, sandbox);
    fakeNow = 5300;
    vm.runInContext('globalThis.secondGrid = smartProgressTaskGridHtml(node);', sandbox);
    assert.match(sandbox.firstGrid, /data-progress-task-index="0" style="--smart-task-pulse-delay:-400ms"/);
    assert.match(sandbox.secondGrid, /data-progress-task-index="0" style="--smart-task-pulse-delay:-700ms"/);
    assert.equal(sandbox.runningHalo, true);
    assert.equal(sandbox.determinateHalo, true);
    assert.equal(sandbox.queuedHalo, false);
    assert.equal(sandbox.completeHalo, false);
    assert.equal(sandbox.missingHalo, false);
});

test('multi-task determinate borders interpolate a single partial path using the single-task timing', () => {
    const queuedFrames = [];
    const sandbox = vm.createContext({
        performance:{now:() => 0},
        window:{matchMedia:() => ({matches:false})},
        requestAnimationFrame:callback => {
            queuedFrames.push(callback);
            return queuedFrames.length;
        },
        cancelAnimationFrame:() => {}
    });
    vm.runInContext(`
        ${extractFunction('smartProgressTaskValuePath')}
        ${extractFunction('smartProgressTaskEase')}
        ${extractFunction('animateSmartProgressTaskValuePath')}
        const path = {
            dataset:{progressPercent:'0'},
            attributes:{d:'M 1 89'},
            isConnected:true,
            setAttribute(name, value){ this.attributes[name] = value; },
            getAttribute(name){ return this.attributes[name] || ''; }
        };
        const freshPath = {
            dataset:{progressPercent:'25'},
            getAttribute(name){ return name === 'd' ? smartProgressTaskValuePath(25) : ''; }
        };
        const svg = {dataset:{
            progressPathWidth:'100',
            progressPathHeight:'100',
            progressPathInset:'1',
            progressPathRadius:'10'
        }};
        animateSmartProgressTaskValuePath(path, freshPath, svg);
        globalThis.path = path;
    `, sandbox);
    assert.equal(queuedFrames.length, 1);
    queuedFrames.shift()(190);
    assert.notEqual(sandbox.path.attributes.d, 'M 1 89');
    assert.notEqual(sandbox.path.attributes.d, sandbox.smartProgressTaskValuePath?.(25));
    queuedFrames.shift()(380);
    assert.equal(sandbox.path.attributes.d, 'M 1 89 L 1 11 A 10 10 0 0 1 11 1');
    assert.equal(sandbox.path.dataset.progressPercent, '25');

    vm.runInContext(`
        const completePath = {
            dataset:{progressPercent:'75'},
            attributes:{d:smartProgressTaskValuePath(75)},
            isConnected:true,
            setAttribute(name, value){ this.attributes[name] = value; },
            getAttribute(name){ return this.attributes[name] || ''; }
        };
        const completeFreshPath = {
            dataset:{progressPercent:'100'},
            getAttribute(name){ return name === 'd' ? smartProgressTaskValuePath(100) : ''; }
        };
        animateSmartProgressTaskValuePath(completePath, completeFreshPath, svg);
        globalThis.completePath = completePath;
    `, sandbox);
    queuedFrames.shift()(380);
    assert.notEqual(sandbox.completePath.attributes.d, sandbox.smartProgressTaskValuePath(100));
    queuedFrames.shift()(560);
    assert.equal(sandbox.completePath.attributes.d, sandbox.smartProgressTaskValuePath(100));
    assert.equal(sandbox.completePath.dataset.progressPercent, '100');
});

test('multi-task progress keeps result media ordered by task slot instead of completion time', () => {
    const sandbox = vm.createContext({
        nowMs:() => 1000,
        resultMediaUrls:value => value,
        mediaKindForUrls:() => 'image',
        scheduleRunningHubProgressRefresh:() => {}
    });
    vm.runInContext(`
        ${extractFunction('smartNodeProgressState')}
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('smartProgressTaskResultItems')}
        ${extractFunction('smartProgressTaskSlot')}
        ${extractFunction('setSmartProgressTaskResults')}
        const node = {
            images:[],
            runningHubProgress:{tasks:[
                {index:0,resultItems:[]},
                {index:1,resultItems:[]}
            ]}
        };
        node.images = [{url:'/second.png',kind:'image',_genPrompt:{promptText:'second'}}];
        setSmartProgressTaskResults(node, 1, node.images);
        node.images.push({url:'/first.png',kind:'image',_genPrompt:{promptText:'first'}});
        setSmartProgressTaskResults(node, 0, [node.images[1]]);
        globalThis.orderedUrls = node.images.map(item => item.url);
        globalThis.orderedPrompts = node.images.map(item => item._genPrompt?.promptText);
    `, sandbox);
    assert.deepEqual([...sandbox.orderedUrls], ['/first.png', '/second.png']);
    assert.deepEqual([...sandbox.orderedPrompts], ['first', 'second']);
});

test('finalizing then assigning a task result preserves its embedded prompt snapshot', () => {
    const sandbox = vm.createContext({
        nowMs:() => 1000,
        resultMediaUrls:value => value,
        cleanHistoryImages:value => value,
        stripImageGenerationMeta:value => value,
        copyMediaSizeFields:(item, base) => ({...base, ...item}),
        embedGenPromptIntoImages:items => items.map(item => ({...item, _genPrompt:{promptText:'snapshot'}})),
        smartPendingTasks:node => Array.isArray(node.pendingTasks) ? node.pendingTasks : [],
        archiveCurrentOutputsToHistory:() => {},
        clearSmartNodePreRunBox:() => {},
        notifySmartTaskSuccess:() => {},
        isVeniceProviderId:() => false,
        scheduleVeniceCreditsRefresh:() => {},
        scheduleRunningHubProgressRefresh:() => {},
        mediaKindForUrls:() => 'image'
    });
    vm.runInContext(`
        ${extractFunction('smartNodeProgressState')}
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('smartProgressTaskResultItems')}
        ${extractFunction('smartProgressTaskSlot')}
        ${extractFunction('setSmartProgressTaskResults')}
        ${extractFunction('finalizeSmartPendingTask')}
        const node = {
            images:[],
            pending:2,
            pendingTasks:[
                {taskId:'task-0', progressIndex:0, kind:'image'},
                {taskId:'task-1', progressIndex:1, kind:'image'}
            ],
            runningHubProgress:{tasks:[
                {index:0,resultItems:[]},
                {index:1,resultItems:[]}
            ]}
        };
        const additions = finalizeSmartPendingTask(node, 'task-0', [{url:'/one.png',kind:'image'}], 'image');
        setSmartProgressTaskResults(node, 0, additions);
        globalThis.prompt = node.images[0]._genPrompt?.promptText;
        globalThis.slotPrompt = node.runningHubProgress.tasks[0].resultItems[0]._genPrompt?.promptText;
    `, sandbox);
    assert.equal(sandbox.prompt, 'snapshot');
    assert.equal(sandbox.slotPrompt, 'snapshot');
});

test('Venice image and video tasks reuse the border with stable asymptotic estimates', () => {
    const sandbox = vm.createContext({Math});
    vm.runInContext(`
        ${extractFunction('veniceProgressFraction')}
        globalThis.atHalf = veniceProgressFraction(7500, 15000);
        globalThis.atEstimate = veniceProgressFraction(15000, 15000);
        globalThis.overtime = veniceProgressFraction(30000, 15000);
        globalThis.beforeSlowZone = veniceProgressFraction(11985, 15000);
        globalThis.atSlowZone = veniceProgressFraction(12000, 15000);
        globalThis.afterSlowZone = veniceProgressFraction(12015, 15000);
        globalThis.beforeEstimate = veniceProgressFraction(14985, 15000);
        globalThis.afterEstimate = veniceProgressFraction(15015, 15000);
    `, sandbox);
    assert.equal(sandbox.atHalf, 0.5);
    assert.ok(sandbox.atEstimate > 0.95 && sandbox.atEstimate < 1);
    assert.ok(sandbox.overtime > sandbox.atEstimate && sandbox.overtime < 1);
    assert.ok(Math.abs(
        (sandbox.atSlowZone - sandbox.beforeSlowZone)
        - (sandbox.afterSlowZone - sandbox.atSlowZone)
    ) < 0.00005);
    assert.ok(Math.abs(
        (sandbox.atEstimate - sandbox.beforeEstimate)
        - (sandbox.afterEstimate - sandbox.atEstimate)
    ) < 0.00005);
    assert.match(jsSource, /const VENICE_IMAGE_ESTIMATE_MS = 10000;/);
    assert.match(jsSource, /const VENICE_PROGRESS_TICK_MS = 100;/);
    assert.match(jsSource, /node\?\.runningHubProgress \|\| node\?\.veniceProgress/);
    assert.match(cssSource, /\.rh-progress-border-host\.is-venice-progress \.rh-progress-stroke\s*\{[^}]*stroke-dasharray \.1s linear,/);
    assert.match(jsSource, /average_execution_time/);
    assert.match(jsSource, /execution_duration/);
    assert.match(jsSource, /const cappedDelta = Math\.max\(-current \* \.025/);
    assert.match(backendSource, /@app\.get\("\/api\/venice\/video\/progress\/\{progress_id\}"\)/);
    assert.match(backendSource, /average_execution_time=\(raw or \{\}\)\.get\("average_execution_time"\)/);
    assert.match(backendSource, /execution_duration=\(raw or \{\}\)\.get\("execution_duration"\)/);
});
