import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const jsSource = readFileSync(fileURLToPath(new URL('../static/js/smart-canvas.js', import.meta.url)), 'utf8');
const cssSource = readFileSync(fileURLToPath(new URL('../static/css/smart-canvas.css', import.meta.url)), 'utf8');
const i18nSource = readFileSync(fileURLToPath(new URL('../static/js/i18n/smart-canvas.js', import.meta.url)), 'utf8');
const backendSource = readFileSync(fileURLToPath(new URL('../main.py', import.meta.url)), 'utf8');
const generationAnimationVideo = readFileSync(fileURLToPath(new URL('../static/media/load-bg-animation.mp4', import.meta.url)));
const generationAnimationPoster = readFileSync(fileURLToPath(new URL('../static/media/load-bg-animation-poster.webp', import.meta.url)));

test('image and video settings popovers make every resting unselected button easier to distinguish', () => {
    assert.match(cssSource, /\.smart-popover\.image-settings-popover,\.smart-popover\.video-settings-popover\s*\{[^}]*--settings-option-border:color-mix\(in srgb, var\(--text\) 18%, var\(--line\)\);/);
    assert.match(cssSource, /\.smart-popover\.image-settings-popover button:not\(\.active\):not\(:hover\):not\(:focus-visible\),\.smart-popover\.video-settings-popover button:not\(\.active\):not\(:hover\):not\(:focus-visible\)\s*\{[^}]*border-color:var\(--settings-option-border\);/);
    assert.match(cssSource, /\.image-ratio-option:disabled:hover\s*\{[^}]*border-color:var\(--settings-option-border, var\(--line\)\);/);
});

function extractFunction(name){
    const markers = [`function ${name}(`, `async function ${name}(`];
    const starts = markers.map(marker => jsSource.indexOf(marker)).filter(index => index >= 0);
    assert.ok(starts.length, `missing production function ${name}`);
    const start = Math.min(...starts);
    const bodyMarker = /\)\s*\{/.exec(jsSource.slice(start));
    assert.ok(bodyMarker, `missing production function body ${name}`);
    const bodyStart = start + bodyMarker.index + bodyMarker[0].lastIndexOf('{');
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

test('composer run controls do not replay intermediate states while selection changes', () => {
    const clearSelection = extractFunction('clearSelection');
    const syncSelection = extractFunction('syncSelectionUi');
    const updateComposer = extractFunction('updateComposer');
    assert.match(clearSelection, /settleSmartComposerControls\(\)/);
    assert.match(syncSelection, /settleSmartComposerControls\(\)[\s\S]*?syncRunButtonState\(\)/);
    assert.match(jsSource, /function settleSmartComposerControls\(\)[\s\S]*?smart-composer-controls-settling[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame/);
    assert.match(cssSource, /body\.smart-composer-controls-settling \.composer-action-buttons \.run-btn,\s*body\.smart-composer-controls-settling \.kind-toggle button\s*\{\s*transition:none !important;/);
    assert.doesNotMatch(updateComposer, /if\(cascadeRunBtn\) cascadeRunBtn\.style\.display = 'none'/);
    assert.match(updateComposer, /if\(switchedNode\)\{[\s\S]*?settings = smartSettingsForNode\(subject\);[\s\S]*?\}\s*syncRunButtonState\(node\);/);
});

test('every completed node-group type exposes a far-right node delete action', () => {
    assert.match(jsSource, /const isDeletableNodeGroup = !isPending && \(isGroup \|\| isHistory \|\| isSmartGroup\);/);
    assert.match(jsSource, /isDeletableNodeGroup[\s\S]*?class="mini-x node-delete"/);
    assert.match(jsSource, /const floatingActions = `\$\{floatingCancelBtn\}\$\{floatingPinBtn\}\$\{floatingRunBtn\}\$\{floatingDeleteBtn\}`/);
    assert.match(jsSource, /const floatingRunBtn = floatingPinBtn && hadStandardFloatingDelete/);
    const buttonDelete = extractFunction('deleteNodeFromButton');
    assert.match(buttonDelete, /deleteNode\(id\);/);
    assert.doesNotMatch(buttonDelete, /clearNodeMediaBeforeDelete/);
});

test('ordinary media groups reuse the smart-group summary header and reserve its height', () => {
    assert.match(jsSource, /const MEDIA_GROUP_SUMMARY_SPACE = 28;/);
    assert.match(jsSource, /function mediaGroupSummaryHtml\(items, expectedCount=0, expectedKind='', completedCount=null\)[\s\S]*?class="smart-group-summary media-group-summary"/);
    assert.match(jsSource, /class="smart-group-card media-group-card has-thumbs"/);
    assert.match(jsSource, /height = visibleRows \* cell - 8 \+ PAD \+ MEDIA_GROUP_SUMMARY_SPACE/);
    assert.match(jsSource, /h:visibleRows \* cell - 8 \+ pad \+ MEDIA_GROUP_SUMMARY_SPACE/);
    assert.match(cssSource, /\.image-node\.group-node \.node-body\s*\{[^}]*padding:0/);
    assert.match(cssSource, /\.smart-group-card\.media-group-card \.thumb-grid:not\(\.media-group-layout-grid\)\s*\{/);
});

test('multi-task generation uses the same media-group summary without resetting progress cells', () => {
    assert.match(jsSource, /function smartProgressTaskGroupBodyHtml\(node, layout=null, progressTaskGrid=''\)/);
    assert.match(jsSource, /class="smart-group-card media-group-card smart-progress-group-card has-thumbs"/);
    assert.match(
        jsSource,
        /progressTasks\.length > 1[\s\S]*?nodeHasLiveRunState\(node\)[\s\S]*?width:Math\.round\(explicitW\),[\s\S]*?height:Math\.round\(explicitH\)/
    );
    assert.match(jsSource, /function mediaGroupSummaryHtml\(items, expectedCount=0, expectedKind='', completedCount=null\)/);
    assert.match(jsSource, /const progress = hasProgress \? ` \(\$\{completed\}\/\$\{total\}\)` : ''/);
    assert.match(jsSource, /tasks\.filter\(task => smartProgressTaskResultItems\(task\)\.length > 0\)\.length/);
    assert.match(jsSource, /mediaGroupSummaryHtml\(\[\], tasks\.length, smartProgressTaskMediaKind\(node\), completedCount\)/);
    assert.match(jsSource, /mediaGroupSummaryHtml\(\[\], count, smartProgressTaskMediaKind\(node\), 0\)/);
    assert.match(jsSource, /currentTasks\.filter\(task => smartProgressTaskResultItems\(task\)\.length > 0\)\.length[\s\S]*?mediaGroupSummaryHtml\(\[\], currentTasks\.length, smartProgressTaskMediaKind\(current\), completedCount\)/);
    assert.match(jsSource, /if\(progressTaskGrid\) return smartProgressTaskGroupBodyHtml\(node, layout, progressTaskGrid\);/);
    assert.match(jsSource, /querySelector\(':scope > \.node-body \.smart-progress-task-grid'\)/);
    assert.match(jsSource, /if\(currentGrid\)\{[\s\S]*?patchSmartProgressTaskGrid\(currentGrid, freshGrid\)/);
    assert.match(jsSource, /class="smart-group-card media-group-card smart-pending-group-card has-thumbs"/);
    assert.match(jsSource, /Number\(node\.pending\) > 1/);
    assert.match(jsSource, /smart-progress-task-grid media-group-layout-grid/);
    assert.match(jsSource, /thumb-grid media-group-layout-grid/);
    assert.match(jsSource, /loading-skeleton media-group-layout-grid/);
    assert.match(cssSource, /\.media-group-card > \.media-group-layout-grid\s*\{[^}]*grid-template-columns:repeat\(var\(--thumb-cols, 2\), minmax\(0, 1fr\)\) !important/);
    assert.match(cssSource, /\.media-group-card > \.media-group-layout-grid > :is\(\.thumb-item,\.smart-progress-task-cell,\.loading-cell\)/);
    assert.match(jsSource, /updateNodeElementDuringResize[\s\S]*?classList\.contains\('media-group-layout-grid'\)[\s\S]*?--media-group-row-height/);
    assert.match(jsSource, /function alignMediaGroupGridGeometry\(root\)[\s\S]*?grid\.clientHeight - paddingTop - paddingBottom - rowGap \* \(visibleRows - 1\)/);
    assert.doesNotMatch(jsSource, /scrollEdgeGuard/);
    assert.match(cssSource, /\.media-group-card > \.media-group-layout-grid:not\(\.is-scrollable\)\s*\{[^}]*overflow-y/);
    assert.match(cssSource, /\.media-group-card > \.media-group-layout-grid\.is-scrollable\s*\{[^}]*row-gap:10px;[^}]*overflow-y:auto/);
    assert.match(cssSource, /\.media-group-card > \.media-group-layout-grid\s*\{[^}]*overflow-anchor:none/);
    assert.match(cssSource, /\.smart-group-summary\s*\{[^}]*font-size:11px;[^}]*line-height:14px;[^}]*transform:translateY\(-1px\)/);
    assert.match(cssSource, /\.smart-group-summary i,\.smart-group-summary svg\s*\{[^}]*width:14px;[^}]*height:14px;[^}]*flex:0 0 14px/);
    const renderStart = jsSource.indexOf('function render(){');
    const renderEnd = jsSource.indexOf('function measureSmartNodeImages()', renderStart);
    const renderSource = jsSource.slice(renderStart, renderEnd);
    assert.ok(
        renderSource.indexOf('alignMediaGroupGridGeometry(world)') < renderSource.indexOf('restoreThumbScrollStates(thumbScrollStates)'),
        'media-group row geometry must settle before restoring scrollTop'
    );
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

test('media node layout normalization resets stale single and group geometry', () => {
    const sandbox = vm.createContext({
        MEDIA_NODE_DEFAULT_SCALE:2,
        MEDIA_GROUP_DEFAULT_SCALE:0.8
    });
    vm.runInContext(`
        ${extractFunction('normalizeSmartMediaNodeLayout')}
        globalThis.formerGroup = normalizeSmartMediaNodeLayout({
            images:[{url:'/single.png'}], scale:0.8, w:208, h:139
        });
        globalThis.formerSingle = normalizeSmartMediaNodeLayout({
            images:[{url:'/one.png'}, {url:'/two.png'}], scale:2, w:520, h:340
        });
        globalThis.empty = normalizeSmartMediaNodeLayout({images:[], scale:0.8, w:208, h:139});
    `, sandbox);
    assert.equal(sandbox.formerGroup.scale, 2);
    assert.equal(sandbox.formerSingle.scale, 0.8);
    assert.equal(sandbox.empty.scale, 2);
    for(const node of [sandbox.formerGroup, sandbox.formerSingle, sandbox.empty]){
        assert.equal('w' in node, false);
        assert.equal('h' in node, false);
    }
});

test('loop-style appended outputs normalize as their final count changes', () => {
    const sandbox = vm.createContext({
        MEDIA_NODE_DEFAULT_SCALE:2,
        MEDIA_GROUP_DEFAULT_SCALE:0.8,
        smartLoopContext:null,
        selectedImage:{nodeId:'', index:-1},
        liveSmartNode:node => node,
        nodeRect:node => ({width:Number(node.w) || 208}),
        cleanHistoryImages:items => items.map(item => ({...item})),
        embedGenPromptIntoImages:items => items,
        markSmartNodeComplete:() => {},
        pushRightSideNodes:() => {}
    });
    vm.runInContext(`
        ${extractFunction('normalizeSmartMediaNodeLayout')}
        ${extractFunction('appendOutputsToNode')}
        const node = {id:'output', x:0, images:[], scale:0.8, w:208, h:139};
        appendOutputsToNode(node, [{url:'/one.png'}]);
        globalThis.afterOne = {...node};
        appendOutputsToNode(node, [{url:'/two.png'}]);
        globalThis.afterTwo = {...node};
    `, sandbox);
    assert.equal(sandbox.afterOne.scale, 2);
    assert.equal(sandbox.afterOne.images.length, 1);
    assert.equal(sandbox.afterTwo.scale, 0.8);
    assert.equal(sandbox.afterTwo.images.length, 2);
    assert.equal(sandbox.afterTwo.title, 'Group');
});

test('every media-count mutation path uses the shared layout normalizer', () => {
    [
        'appendImagesToSmartNode',
        'finishLoopTargetPreviewState',
        'showDirectLoopRoundPreview',
        'replaceOutputsToNodeWithHistory',
        'appendOutputsToNode',
        'finalizeSmartPendingTask',
        'mergeImageNodesIntoGroup'
    ].forEach(name => {
        assert.match(extractFunction(name), /normalizeSmartMediaNodeLayout\(/, `${name} must normalize layout`);
    });
    assert.match(extractFunction('deleteImage'), /if\(isSmartImageNode\(node\)\) normalizeSmartMediaNodeLayout\(node\)/);
    assert.match(extractFunction('recoverStuckLoopOutputsFromLogs'), /normalizeSmartMediaNodeLayout\(slot\)/);
    const runGeneration = extractFunction('runGeneration');
    assert.match(runGeneration, /normalizeSmartMediaNodeLayout\(pendingNode\)/);
});

test('failed and cancelled empty slots expose an in-node retry using the saved request snapshot', () => {
    assert.match(jsSource, /data-smart-retry=/);
    assert.match(jsSource, /runSmartNodeRetry\(btn\.dataset\.smartRetry \|\| id\)/);
    assert.match(cssSource, /\.smart-run-terminal\s*\{/);
    assert.match(cssSource, /\.smart-run-retry\s*\{/);
    assert.match(cssSource, /\.empty-node:is\(\.node-run-failed,\.node-run-cancelled\) \.node-body\s*\{[^}]*padding:0;[^}]*border-radius:0 0 15px 15px;/);
    assert.match(cssSource, /\.smart-run-terminal\s*\{[^}]*border:0;[^}]*border-radius:0;/);
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

test('single-task and multi-task progress share the same border while empty surfaces use the local MP4', () => {
    assert.equal(generationAnimationVideo.length, 5047293);
    assert.equal(createHash('sha256').update(generationAnimationVideo).digest('hex'), '1b1d121016d781c3098992db5d50c33a1f5b7b5f51cbaddf5cad02350c0fa8a9');
    assert.ok(generationAnimationPoster.length > 0);
    assert.match(jsSource, /\$\{runningHubProgressBorderHtml\(node,\s*layout\)\}/);
    assert.match(cssSource, /\.rh-progress-border-host\s*\{[^}]*position:absolute;[^}]*pointer-events:none;/);
    assert.match(cssSource, /\.rh-progress-node-badge\.image-resolution-badge\s*\{[^}]*opacity:1\s*!important;/);
    assert.doesNotMatch(cssSource, /\.image-node\.dragging \.rh-progress-node-badge\.image-resolution-badge\s*\{[^}]*opacity:1\s*!important;/);
    assert.doesNotMatch(cssSource, /@keyframes rh-progress-orbit/);
    assert.match(cssSource, /\.smart-progress-task-grid\s*\{/);
    assert.match(cssSource, /\.smart-progress-task-breathe\s*\{/);
    assert.match(cssSource, /\.smart-progress-task-value\s*\{/);
    assert.match(cssSource, /@keyframes smart-task-border-breathe/);
    assert.doesNotMatch(cssSource, /@keyframes smart-generation-field-/);
    assert.doesNotMatch(jsSource, /smart-generation-field/);
    assert.doesNotMatch(cssSource, /smart-progress-task-placeholder-dot|smart-task-halo-breathe/);
    assert.match(cssSource, /animation:smart-task-border-breathe 1\.8s ease-in-out infinite/);
    assert.match(cssSource, /\.smart-progress-task-breathe\.is-layer-hidden\s*\{[^}]*stroke-opacity:0;/);
    assert.match(cssSource, /\.smart-generation-surface\.is-ambient\s*\{[^}]*load-bg-animation-poster\.webp/);
    assert.match(cssSource, /\.smart-generation-animation-video\s*\{[\s\S]*?object-fit:cover;[\s\S]*?opacity:0;/);
    assert.match(cssSource, /\.smart-progress-task-content video\.smart-generation-animation-video \{ object-fit:cover; \}/);
    assert.match(cssSource, /\.smart-progress-task-content video \{ width:100%; height:100%; object-fit:contain; \}/);
    assert.match(cssSource, /\.smart-generation-surface\.is-video-ready \.smart-generation-animation-video \{ opacity:1; \}/);
    assert.match(cssSource, /\.smart-generation-backdrop\s*\{[\s\S]*?object-fit:cover;[\s\S]*?filter:blur\(18px\)/);
    assert.match(cssSource, /\.smart-generation-surface\.is-backdrop-ready \.smart-generation-backdrop/);
    assert.match(cssSource, /\.smart-generation-contrast-veil\s*\{[\s\S]*?rgba\(15,23,42,\.24\)[\s\S]*?rgba\(15,23,42,\.12\)/);
    assert.match(cssSource, /\.smart-generation-surface\.is-ambient \.smart-generation-contrast-veil \{ opacity:1; \}/);
    assert.match(jsSource, /smart-generation-contrast-veil/);
    assert.match(jsSource, /SMART_GENERATION_ANIMATION_VIDEO_URL = '\/static\/media\/load-bg-animation\.mp4'/);
    assert.match(jsSource, /<video class="smart-generation-animation-video"[^`]*autoplay[^`]*loop muted playsinline/);
    assert.match(jsSource, /function bindSmartGenerationAnimationVideos\(root=document\)/);
    assert.match(jsSource, /function syncSmartGenerationAnimationVideo\(video\)/);
    assert.match(jsSource, /document\.visibilityState === 'visible'/);
    assert.match(jsSource, /smartGenerationReducedMotionQuery\?\.matches/);
    assert.doesNotMatch(jsSource, /smart-generation-document-hidden/);
    assert.match(jsSource, /function smartGenerationBackdropPreviewUrl\(item, size=512\)/);
    assert.match(jsSource, /previewSize:768/);
    assert.match(cssSource, /\.smart-progress-task-content\s*\{[^}]*inset:1px;/);
    assert.match(cssSource, /animation-delay:var\(--smart-task-pulse-delay,\s*0ms\)/);
    assert.doesNotMatch(cssSource, /\.smart-progress-task-rail/);
    assert.doesNotMatch(cssSource, /animation-delay:var\(--rh-progress-delay,\s*0ms\)/);
    assert.match(cssSource, /\.loading-cell\.smart-generation-loading-cell[\s\S]*?animation:none;/);
    assert.match(jsSource, /loading-cell single smart-generation-loading-cell[^`]*smartGenerationSurfaceHtml/);
    assert.match(jsSource, /function smartGenerationBackdropItems\(node\)/);
    assert.match(jsSource, /item = items\.length \? items\[index % items\.length\] : null/);
    assert.doesNotMatch(extractFunction('smartGenerationSurfaceHtml'), /phaseElapsed|loopElapsed|--smart-generation-delay-/);
    assert.match(jsSource, /pendingNode\.runBackdropBatchId = backdropBatchId/);
    assert.match(jsSource, /function bindSmartGenerationBackdropReadiness\(root=document\)/);
    assert.match(jsSource, /bindSmartGenerationBackdropReadiness\(world\)/);
    assert.match(jsSource, /bindSmartGenerationAnimationVideos\(world\)/);
    assert.match(jsSource, /\{root:null, rootMargin:'160px', threshold:\.01\}/);
    assert.match(cssSource, /stroke-dasharray \.38s cubic-bezier/);
    assert.match(cssSource, /\.rh-progress-stroke\.is-layer-hidden\s*\{[^}]*opacity:0\s*!important;/);
    assert.match(jsSource, /patchRunningHubProgressHost\(currentHost,\s*fresh\)/);
    assert.match(jsSource, /preservePhase\s*\?\s*\['style'\]\s*:\s*\[\]/);
    assert.match(jsSource, /function animateSmartProgressTaskValuePath\(path,\s*freshPath,\s*svg\)/);
    assert.match(jsSource, /const completionJump = to >= 99\.999 && from < 99\.999;/);
    assert.match(jsSource, /Math\.min\(900,\s*Math\.max\(560,\s*380 \+ Math\.abs\(to - from\) \* 5\)\)/);
    assert.match(jsSource, /alignSmartProgressTaskGridGeometry\(world\)/);
    assert.match(jsSource, /syncSmartProgressTaskSvgGeometry\(freshSvg,\s*cell\.clientWidth,\s*cell\.clientHeight\)/);
    assert.match(jsSource, /const preserveSurfacePhase = smartProgressTaskCellHasActiveSurface\(cell\)\s*&& smartProgressTaskCellHasActiveSurface\(freshCell\);/);
    assert.match(jsSource, /syncRunningHubProgressElement\(cell,\s*freshCell,\s*preserveSurfacePhase \? \['style'\] : \[\]\)/);
    assert.match(jsSource, /syncRunningHubProgressElement\(currentSurface, freshSurface, \['style','data-backdrop-ready-bound'\]\)/);
    assert.match(jsSource, /data-generation-batch=/);
    assert.match(jsSource, /hasReusableGenerationSurface/);
    assert.match(jsSource, /freshGenerationSurfaces = new Map/);
    assert.match(jsSource, /querySelectorAll\?\.\('\.smart-generation-surface\[data-generation-batch\]'\)/);
    assert.match(cssSource, /\.smart-progress-task-value\.is-complete\s*\{[^}]*stroke-linecap:butt;/);
    assert.match(jsSource, /const nodeId = String\(data\.node \?\? ''\)\.trim\(\);\s*if\(!nodeId\) return;/);

    const sandbox = vm.createContext({
        Date:{now:() => 5000},
        nodeRect:() => ({width:260, height:180}),
        isHistoricalRunningSnapshotNode:node => Boolean(node?.historicalSnapshot),
        escapeHtml:value => String(value),
        escapeAttr:value => String(value),
        mediaKindForItem:item => item?.kind || 'image',
        imageForDisplay:item => item,
        thumbMediaHtml:item => `<img src="${item?.url || ''}">`,
        historyGroupForNode:() => null,
        smartMediaPreviewUrl:() => '',
        SMART_GENERATION_ANIMATION_VIDEO_URL:'/static/media/load-bg-animation.mp4',
        SMART_GENERATION_ANIMATION_POSTER_URL:'/static/media/load-bg-animation-poster.webp'
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
        ${extractFunction('smartGenerationBackdropItems')}
        ${extractFunction('smartGenerationBackdropPreviewUrl')}
        ${extractFunction('smartGenerationSurfaceHtml')}
        ${extractFunction('smartProgressTaskGridHtml')}
        ${extractFunction('runningHubProgressBorderHtml')}
        globalThis.valuePath25 = smartProgressTaskValuePath(25);
        globalThis.valuePath50 = smartProgressTaskValuePath(50);
        globalThis.gridValuePath25 = smartProgressTaskValuePath(25, 118, 78, 1, 11);
        globalThis.singleRowValuePath25 = smartProgressTaskValuePath(25, 118, 164, 1, 11);
        globalThis.single = runningHubProgressBorderHtml({
            runningHubProgress:{tasks:[{index:0,status:'running',nodeName:'KSampler',value:15,max:30}]}
        });
        globalThis.historical = runningHubProgressBorderHtml({
            historicalSnapshot:true,
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
    assert.doesNotMatch(sandbox.single, /stroke-dasharray/);
    assert.match(sandbox.single, /smart-progress-task-breathe is-indeterminate is-layer-hidden/);
    assert.match(sandbox.single, /smart-progress-task-value\s+is-determinate\s+" data-progress-percent="50"/);
    assert.match(sandbox.single, /data-progress-path-width="260" data-progress-path-height="180" data-progress-path-inset="1" data-progress-path-radius="11"/);
    assert.match(sandbox.historical, /data-progress-path-width="260" data-progress-path-height="180" data-progress-path-inset="0\.5" data-progress-path-radius="15\.5"/);
    assert.match(sandbox.historical, /image-resolution-badge rh-progress-node-badge/);
    assert.equal((sandbox.historical.match(/class="rh-progress-stroke/g) || []).length, 2);
    assert.match(sandbox.single, /d="M 1 168 L 1 12 A 11 11 0 0 1 12 1 L 248 1 A 11 11 0 0 1 259 12"/);
    assert.match(sandbox.single, /image-resolution-badge rh-progress-node-badge/);
    assert.match(sandbox.single, /KSampler · 50%/);
    assert.equal((sandbox.single.match(/class="rh-progress-stroke/g) || []).length, 2);
    assert.equal((sandbox.unnamed.match(/class="rh-progress-stroke/g) || []).length, 2);
    assert.match(sandbox.unnamed, /smart-progress-task-breathe is-indeterminate [^>]*--smart-task-pulse-delay:-400ms/);
    assert.match(sandbox.unnamed, /smart-progress-task-value\s+is-layer-hidden[\s\S]*data-progress-percent="0"/);
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

test('RunningHub in-place progress patches preserve a live breathing phase', () => {
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
        const current = element({class:'rh-progress-stroke is-indeterminate', style:'--smart-task-pulse-delay:-420ms'});
        const fresh = element({class:'rh-progress-stroke is-indeterminate', style:'--smart-task-pulse-delay:-910ms'});
        syncRunningHubProgressElement(current, fresh, ['style']);
        globalThis.preservedStyle = current.values.style;
        const classElement = names => ({classList:{contains:name => names.includes(name)}});
        globalThis.runningMode = runningHubProgressAnimationMode(classElement(['is-indeterminate']));
        globalThis.queuedMode = runningHubProgressAnimationMode(classElement(['is-indeterminate','is-queued']));
    `, sandbox);
    assert.equal(sandbox.preservedStyle, '--smart-task-pulse-delay:-420ms');
    assert.equal(sandbox.runningMode, 'indeterminate');
    assert.equal(sandbox.queuedMode, 'indeterminate');
});

test('generation surfaces prioritize all archived visual media, then input images, then input video first frames', () => {
    const history = {images:[
        {url:'https://remote.example/a.png',localUrl:'/a.png',kind:'image',historyBatchId:'batch-new'},
        {url:'/b.png',kind:'image',historyBatchId:'batch-new'},
        {url:'/mixed.mp4',kind:'video',historyBatchId:'batch-new'},
        {url:'/previous.mp4',kind:'video',historyBatchId:'batch-video'},
        {url:'/older.png',kind:'image',historyBatchId:'batch-old'},
        {url:'/sound.mp3',kind:'audio',historyBatchId:'batch-new'}
    ]};
    const sandbox = vm.createContext({
        Date:{now:() => 5000},
        escapeAttr:value => String(value),
        mediaKindForItem:item => item?.kind || 'image',
        imageForDisplay:item => item?.localUrl ? {...item,url:item.localUrl} : item,
        historyGroupForNode:() => history,
        smartMediaPreviewUrl:item => item?.kind === 'video'
            ? `/api/media-preview?w=512&url=${String(item?.url || '')}`
            : `/preview/${String(item?.url || '').split('/').pop()}`,
        smartOriginalMediaUrl:item => item?.url || '',
        SMART_GENERATION_ANIMATION_VIDEO_URL:'/static/media/load-bg-animation.mp4',
        SMART_GENERATION_ANIMATION_POSTER_URL:'/static/media/load-bg-animation-poster.webp'
    });
    vm.runInContext(`
        ${extractFunction('smartGenerationBackdropItems')}
        ${extractFunction('smartGenerationBackdropPreviewUrl')}
        ${extractFunction('smartGenerationSurfaceHtml')}
        const node = {runBackdropBatchId:'batch-new',runBackdropInputRefs:[{url:'/input.png',kind:'image'}],runStartedAt:1000};
        globalThis.items = smartGenerationBackdropItems(node);
        globalThis.slot0 = smartGenerationSurfaceHtml(node, 0, {items});
        globalThis.slot1 = smartGenerationSurfaceHtml(node, 1, {items});
        globalThis.slot2 = smartGenerationSurfaceHtml(node, 2, {items});
        const historyVideoNode = {runBackdropBatchId:'batch-video',runBackdropInputRefs:[{url:'/input.png',kind:'image'}],runStartedAt:1000};
        globalThis.historyVideoItems = smartGenerationBackdropItems(historyVideoNode);
        globalThis.historyVideoSurface = smartGenerationSurfaceHtml(historyVideoNode, 0, {items:historyVideoItems});
        const inputNode = {runBackdropInputRefs:[
            {url:'/clip.mp4',kind:'video'},
            {url:'/input-a.png',kind:'image'},
            {url:'/input-b.png',kind:'image'},
            {url:'/sound.mp3',kind:'audio'}
        ],runStartedAt:1000};
        globalThis.inputItems = smartGenerationBackdropItems(inputNode);
        globalThis.inputSlot2 = smartGenerationSurfaceHtml(inputNode, 2, {items:inputItems});
        const videoNode = {runBackdropInputRefs:[{url:'/clip.mp4',kind:'video'}],runStartedAt:1000};
        globalThis.videoItems = smartGenerationBackdropItems(videoNode);
        globalThis.videoSurface = smartGenerationSurfaceHtml(videoNode, 0, {items:videoItems});
        const audioNode = {runBackdropInputRefs:[{url:'/sound.mp3',kind:'audio'}],runStartedAt:1000};
        globalThis.audioSurface = smartGenerationSurfaceHtml(audioNode, 0, {items:smartGenerationBackdropItems(audioNode)});
        globalThis.empty = smartGenerationSurfaceHtml({runStartedAt:1000}, 0);
    `, sandbox);
    assert.deepEqual(Array.from(sandbox.items, item => item.url), ['https://remote.example/a.png','/b.png','/mixed.mp4']);
    assert.match(sandbox.slot0, /has-history[\s\S]*src="\/preview\/a\.png"/);
    assert.match(sandbox.slot1, /has-history[\s\S]*src="\/preview\/b\.png"/);
    assert.match(sandbox.slot2, /has-history[\s\S]*src="\/api\/media-preview\?w=512&url=\/mixed\.mp4&frame=first"/);
    assert.doesNotMatch(sandbox.slot0, /smart-generation-animation-video/);
    assert.deepEqual(Array.from(sandbox.historyVideoItems, item => item.url), ['/previous.mp4']);
    assert.match(sandbox.historyVideoSurface, /data-generation-batch="batch-video"[\s\S]*src="\/api\/media-preview\?w=512&url=\/previous\.mp4&frame=first"/);
    assert.doesNotMatch(sandbox.historyVideoSurface, /input\.png|smart-generation-animation-video|is-ambient/);
    assert.deepEqual(Array.from(sandbox.inputItems, item => item.url), ['/input-a.png','/input-b.png']);
    assert.match(sandbox.inputSlot2, /data-generation-batch="input:\/input-a\.png"[\s\S]*src="\/preview\/input-a\.png"/);
    assert.deepEqual(Array.from(sandbox.videoItems, item => item.url), ['/clip.mp4']);
    assert.match(sandbox.videoSurface, /src="\/api\/media-preview\?w=512&url=\/clip\.mp4&frame=first"/);
    assert.doesNotMatch(sandbox.videoSurface, /is-ambient/);
    assert.doesNotMatch(sandbox.videoSurface, /smart-generation-animation-video/);
    assert.match(backendSource, /exact_first_frame = is_video[\s\S]*?frame[\s\S]*?== "first"/);
    assert.match(backendSource, /cache_variant = "video-first-frame-v2" if exact_first_frame else "default"/);
    assert.match(backendSource, /generate_video_preview_image\(path, width, 0\.0 if exact_first_frame else 0\.5\)/);
    assert.match(sandbox.audioSurface, /smart-generation-surface is-ambient/);
    assert.doesNotMatch(sandbox.audioSurface, /smart-generation-backdrop/);
    assert.match(sandbox.audioSurface, /data-generation-batch="ambient-video"[\s\S]*smart-generation-animation-video[\s\S]*load-bg-animation\.mp4/);
    assert.match(sandbox.empty, /smart-generation-surface is-ambient/);
    assert.doesNotMatch(sandbox.empty, /smart-generation-backdrop/);
    assert.match(sandbox.empty, /autoplay loop muted playsinline preload="auto"/);
    assert.match(jsSource, /const backdropBatchId = uid\('history_batch'\);[\s\S]*?batchId:backdropBatchId[\s\S]*?pendingNode\.runBackdropBatchId = backdropBatchId/);
    assert.match(jsSource, /const backdropInputRefs = \(refs \|\| \[\]\)[\s\S]*?pendingNode\.runBackdropInputRefs = backdropInputRefs/);
    assert.match(jsSource, /function clearSmartNodeBusyState\(node\)[\s\S]*?delete node\.runBackdropBatchId;[\s\S]*?delete node\.runBackdropInputRefs;/);
    assert.match(jsSource, /function markSmartNodeRunFailed\(node, options=\{\}\)[\s\S]*?delete node\.runBackdropBatchId;[\s\S]*?delete node\.runBackdropInputRefs;/);
    assert.match(jsSource, /delete node\.runRetrySnapshot;[\s\S]*?delete node\.runBackdropBatchId;[\s\S]*?delete node\.runBackdropInputRefs;[\s\S]*?node\.runStatus = 'completed'/);
});

test('ambient MP4 playback pauses only for queueing, invisibility, page hiding, or reduced motion', () => {
    const reducedMotion = {matches:false};
    const documentState = {visibilityState:'visible'};
    const sandbox = vm.createContext({
        document:documentState,
        smartGenerationReducedMotionQuery:reducedMotion
    });
    vm.runInContext(`
        ${extractFunction('smartGenerationAnimationVideoShouldPlay')}
        ${extractFunction('syncSmartGenerationAnimationVideo')}
        const classes = new Set();
        const surface = {classList:{contains:name => classes.has(name)}};
        const video = {
            isConnected:true,
            muted:false,
            loop:false,
            playsInline:false,
            paused:true,
            ended:false,
            playCount:0,
            pauseCount:0,
            closest:() => surface,
            play(){ this.playCount += 1; this.paused = false; return Promise.resolve(); },
            pause(){ this.pauseCount += 1; this.paused = true; }
        };
        syncSmartGenerationAnimationVideo(video);
        globalThis.activePlays = video.playCount;
        classes.add('is-queued');
        syncSmartGenerationAnimationVideo(video);
        classes.delete('is-queued');
        video.paused = false;
        classes.add('is-render-paused');
        syncSmartGenerationAnimationVideo(video);
        classes.delete('is-render-paused');
        video.paused = false;
        smartGenerationReducedMotionQuery.matches = true;
        syncSmartGenerationAnimationVideo(video);
        smartGenerationReducedMotionQuery.matches = false;
        video.paused = false;
        document.visibilityState = 'hidden';
        syncSmartGenerationAnimationVideo(video);
        globalThis.pauseCount = video.pauseCount;
        globalThis.mediaFlags = [video.muted, video.loop, video.playsInline];
    `, sandbox);
    assert.equal(sandbox.activePlays, 1);
    assert.equal(sandbox.pauseCount, 4);
    assert.deepEqual([...sandbox.mediaFlags], [true, true, true]);
});

test('decoded regeneration backgrounds and ambient videos survive full node renders by batch and slot', () => {
    const sandbox = vm.createContext({syncSmartGenerationAnimationVideo:() => {}});
    vm.runInContext(`
        ${extractFunction('transplantSmartMediaElements')}
        const classList = names => {
            const values = new Set(names);
            return {
                contains:name => values.has(name),
                toggle(name, force){
                    if(force) values.add(name); else values.delete(name);
                }
            };
        };
        const surface = (batch, slot, names=[]) => ({
            dataset:{generationBatch:batch,generationSlot:String(slot)},
            className:'smart-generation-surface has-history',
            classList:classList(['has-history', ...names]),
            style:{cssText:'--old-phase:1'},
            replacedWith:null,
            querySelector:() => null,
            replaceWith(value){ this.replacedWith = value; }
        });
        const oldSurface = surface('batch-a', 0, ['is-backdrop-ready']);
        const freshSurface = surface('batch-a', 0);
        freshSurface.style.cssText = '--fresh-phase:1';
        const oldNode = {querySelectorAll(selector){
            return selector.includes('.thumb-item') ? [] : [oldSurface];
        }};
        const freshNode = {querySelectorAll(selector){
            return selector.includes('.thumb-item') ? [] : [freshSurface];
        }};
        transplantSmartMediaElements(oldNode, freshNode);
        globalThis.reused = freshSurface.replacedWith === oldSurface;
        globalThis.ready = oldSurface.classList.contains('is-backdrop-ready');
        globalThis.style = oldSurface.style.cssText;
    `, sandbox);
    assert.equal(sandbox.reused, true);
    assert.equal(sandbox.ready, true);
    assert.equal(sandbox.style, '--fresh-phase:1');
});

test('multi-task generation surfaces keep stable MP4 identities across regenerated markup', () => {
    let fakeNow = 5000;
    const sandbox = vm.createContext({
        Date:{now:() => fakeNow},
        nodeRect:() => ({width:260, height:180}),
        escapeHtml:value => String(value),
        escapeAttr:value => String(value),
        mediaKindForItem:item => item?.kind || 'image',
        imageForDisplay:item => item,
        thumbMediaHtml:item => `<img src="${item?.url || ''}">`,
        historyGroupForNode:() => null,
        smartMediaPreviewUrl:() => '',
        SMART_GENERATION_ANIMATION_VIDEO_URL:'/static/media/load-bg-animation.mp4',
        SMART_GENERATION_ANIMATION_POSTER_URL:'/static/media/load-bg-animation-poster.webp'
    });
    vm.runInContext(`
        ${extractFunction('smartNodeProgressState')}
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('runningHubTaskFraction')}
        ${extractFunction('smartProgressTaskResultItems')}
        ${extractFunction('smartProgressTaskStatusParts')}
        ${extractFunction('smartProgressTaskStatusText')}
        ${extractFunction('smartProgressTaskValuePath')}
        ${extractFunction('smartGenerationBackdropItems')}
        ${extractFunction('smartGenerationBackdropPreviewUrl')}
        ${extractFunction('smartGenerationSurfaceHtml')}
        ${extractFunction('smartProgressTaskGridHtml')}
        ${extractFunction('smartProgressTaskCellHasActiveSurface')}
        const node = {runningHubProgress:{tasks:[
            {index:0,status:'running',nodeName:'K采样器',value:null,max:null,startedAt:1000},
            {index:1,status:'queued',value:null,max:null,startedAt:1000}
        ]}};
        globalThis.firstGrid = smartProgressTaskGridHtml(node);
        const cell = (classes, hasSurface=true) => ({
            classList:{contains:name => classes.includes(name)},
            querySelector:() => hasSurface ? {} : null
        });
        globalThis.runningSurface = smartProgressTaskCellHasActiveSurface(cell(['is-running']));
        globalThis.determinateSurface = smartProgressTaskCellHasActiveSurface(cell(['is-determinate']));
        globalThis.queuedSurface = smartProgressTaskCellHasActiveSurface(cell(['is-queued']));
        globalThis.completeSurface = smartProgressTaskCellHasActiveSurface(cell(['is-complete']));
        globalThis.missingSurface = smartProgressTaskCellHasActiveSurface(cell(['is-running'], false));
    `, sandbox);
    fakeNow = 5300;
    vm.runInContext('globalThis.secondGrid = smartProgressTaskGridHtml(node);', sandbox);
    assert.match(sandbox.firstGrid, /data-progress-task-index="0" style="--smart-task-pulse-delay:-400ms"/);
    assert.match(sandbox.secondGrid, /data-progress-task-index="0" style="--smart-task-pulse-delay:-700ms"/);
    assert.match(sandbox.firstGrid, /data-generation-batch="ambient-video"[\s\S]*smart-generation-animation-video/);
    assert.match(sandbox.secondGrid, /data-generation-batch="ambient-video"[\s\S]*smart-generation-animation-video/);
    assert.equal(sandbox.runningSurface, true);
    assert.equal(sandbox.determinateSurface, true);
    assert.equal(sandbox.queuedSurface, false);
    assert.equal(sandbox.completeSurface, false);
    assert.equal(sandbox.missingSurface, false);
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

test('multi-task progress slots do not mutate committed node media', () => {
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
        globalThis.committedUrls = node.images.map(item => item.url);
        globalThis.slotUrls = runningHubProgressTasks(node)
            .flatMap(task => smartProgressTaskResultItems(task))
            .map(item => item.url);
    `, sandbox);
    assert.deepEqual([...sandbox.committedUrls], ['/second.png', '/first.png']);
    assert.deepEqual([...sandbox.slotUrls], ['/first.png', '/second.png']);
});

test('Venice results stay in input order when the second task finishes first', () => {
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
        mediaKindForUrls:() => 'image',
        MEDIA_NODE_DEFAULT_SCALE:2,
        MEDIA_GROUP_DEFAULT_SCALE:0.8
    });
    vm.runInContext(`
        ${extractFunction('normalizeSmartMediaNodeLayout')}
        ${extractFunction('smartNodeProgressState')}
        ${extractFunction('runningHubProgressTasks')}
        ${extractFunction('smartProgressTaskResultItems')}
        ${extractFunction('smartProgressTaskSlot')}
        ${extractFunction('smartTaskResultOrderKey')}
        ${extractFunction('orderSmartTaskResults')}
        ${extractFunction('clearSmartTaskResultOrder')}
        ${extractFunction('setSmartProgressTaskResults')}
        ${extractFunction('finalizeSmartPendingTask')}
        const node = {
            images:[],
            pending:2,
            pendingTasks:[
                {taskId:'task-0', progressIndex:0, kind:'image'},
                {taskId:'task-1', progressIndex:1, kind:'image'}
            ],
            veniceProgress:{tasks:[
                {index:0,resultItems:[]},
                {index:1,resultItems:[]}
            ]}
        };
        const secondRaw = [{url:'/second.png',kind:'image'}];
        setSmartProgressTaskResults(node, 1, secondRaw);
        const secondAdditions = finalizeSmartPendingTask(node, 'task-1', secondRaw, 'image');
        setSmartProgressTaskResults(node, 1, secondAdditions);
        const firstRaw = [{url:'/first.png',kind:'image'}];
        setSmartProgressTaskResults(node, 0, firstRaw);
        const firstAdditions = finalizeSmartPendingTask(node, 'task-0', firstRaw, 'image');
        setSmartProgressTaskResults(node, 0, firstAdditions);
        globalThis.urls = node.images.map(item => item.url);
        globalThis.prompts = node.images.map(item => item._genPrompt?.promptText);
        globalThis.slotPrompts = node.veniceProgress.tasks.map(task => task.resultItems[0]?._genPrompt?.promptText);
        globalThis.hasTransientOrder = '_smartTaskResultOrder' in node;
    `, sandbox);
    assert.deepEqual([...sandbox.urls], ['/first.png', '/second.png']);
    assert.deepEqual([...sandbox.prompts], ['snapshot', 'snapshot']);
    assert.deepEqual([...sandbox.slotPrompts], ['snapshot', 'snapshot']);
    assert.equal(sandbox.hasTransientOrder, false);
});

test('generic API and RunningHub task commits use stable task order without progress state', () => {
    const sandbox = vm.createContext({
        nowMs:() => 1000,
        resultMediaUrls:value => value,
        cleanHistoryImages:value => value,
        stripImageGenerationMeta:value => value,
        copyMediaSizeFields:(item, base) => ({...base, ...item}),
        embedGenPromptIntoImages:items => items,
        smartPendingTasks:node => Array.isArray(node.pendingTasks) ? node.pendingTasks : [],
        clearSmartNodePreRunBox:() => {},
        notifySmartTaskSuccess:() => {},
        isVeniceProviderId:() => false,
        scheduleVeniceCreditsRefresh:() => {},
        MEDIA_NODE_DEFAULT_SCALE:2,
        MEDIA_GROUP_DEFAULT_SCALE:0.8
    });
    vm.runInContext(`
        ${extractFunction('normalizeSmartMediaNodeLayout')}
        ${extractFunction('smartTaskResultOrderKey')}
        ${extractFunction('orderSmartTaskResults')}
        ${extractFunction('clearSmartTaskResultOrder')}
        ${extractFunction('finalizeSmartPendingTask')}
        const generic = {
            images:[], pending:2,
            pendingTasks:[
                {taskId:'generic-0', progressIndex:0, kind:'image'},
                {taskId:'generic-1', progressIndex:1, kind:'image'}
            ]
        };
        finalizeSmartPendingTask(generic, 'generic-1', [{url:'/generic-second.png'}]);
        finalizeSmartPendingTask(generic, 'generic-0', [{url:'/generic-first.png'}]);
        globalThis.genericUrls = generic.images.map(item => item.url);

        const runningHub = {images:[], pending:2, pendingTasks:[]};
        finalizeSmartPendingTask(runningHub, 'runninghub_2', [{url:'/rh-third.png'}], 'image', {progressIndex:2});
        finalizeSmartPendingTask(runningHub, 'runninghub_0', [{url:'/rh-first.png'}], 'image', {progressIndex:0});
        globalThis.runningHubUrls = runningHub.images.map(item => item.url);
    `, sandbox);
    assert.deepEqual([...sandbox.genericUrls], ['/generic-first.png', '/generic-second.png']);
    assert.deepEqual([...sandbox.runningHubUrls], ['/rh-first.png', '/rh-third.png']);
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
    assert.match(jsSource, /const VENICE_FALLBACK_IMAGE_ESTIMATE_MS = 10000;/);
    assert.match(jsSource, /const VENICE_PROGRESS_TICK_MS = 100;/);
    assert.match(jsSource, /node\?\.runningHubProgress \|\| node\?\.veniceProgress/);
    assert.match(cssSource, /\.rh-progress-border-host\.is-venice-progress \.rh-progress-stroke\s*\{[^}]*stroke-dasharray \.1s linear,/);
    assert.doesNotMatch(jsSource, /average_execution_time/);
    assert.match(jsSource, /execution_duration/);
    assert.match(jsSource, /veniceCatalogAverageExecutionTime/);
    assert.match(jsSource, /const next = veniceProgressFraction\(localElapsed, task\.estimateMs\)/);
    assert.match(backendSource, /@app\.get\("\/api\/venice\/video\/progress\/\{progress_id\}"\)/);
    assert.doesNotMatch(backendSource, /average_execution_time=\(raw or \{\}\)\.get\("average_execution_time"\)/);
    assert.match(backendSource, /execution_duration=\(raw or \{\}\)\.get\("execution_duration"\)/);
});
