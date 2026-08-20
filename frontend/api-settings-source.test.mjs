import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../static/js/api-settings.js', import.meta.url), 'utf8');
const appSelectSource = await readFile(new URL('../static/js/app-select.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../static/css/api-settings.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../static/api-settings.html', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

test('model sections are ordered as chat, image, then video', () => {
  const chatIndex = html.indexOf('id="chatModelList"');
  const imageIndex = html.indexOf('id="imageModelList"');
  const videoIndex = html.indexOf('id="videoModelList"');
  assert.ok(chatIndex >= 0 && chatIndex < imageIndex && imageIndex < videoIndex);
});

test('custom select positioning separates viewport and transformed-body coordinates', () => {
  assert.match(
    appSelectSource,
    /const viewportWidth = matrix \? \(innerWidth - bodyRect\.left\) \/ scaleX : innerWidth;/
  );
  assert.match(
    appSelectSource,
    /const viewportHeight = matrix \? \(innerHeight - bodyRect\.top\) \/ scaleY : innerHeight;/
  );
  assert.match(appSelectSource, /left:\(rect\.left - bodyRect\.left\) \/ scaleX/);
  assert.match(appSelectSource, /left:rect\.left,[\s\S]*top:rect\.top,[\s\S]*bottom:rect\.bottom/);
});

test('secret previews stay separate from writable secret fields', () => {
  assert.match(source, /item\.venice_client_preview/);
  assert.doesNotMatch(source, /item\.__client\s*\|\|/);
  assert.match(source, /__client:item\.venice_client \|\| undefined/);
  assert.match(source, /api_key:item\.api_key \|\| undefined/);
  assert.match(source, /wallet_api_key:item\.wallet_api_key \|\| undefined/);
  assert.doesNotMatch(source, /api_key:item\.key_preview/);
  assert.doesNotMatch(source, /wallet_api_key:item\.wallet_key_preview/);
});

test('Venice model rows expose compact configurable I2I and T2V routes', () => {
  const veniceFields = extractFunction('veniceModelFieldsHtml');
  assert.match(source, /function veniceModelRouteHtml/);
  assert.match(source, /image_edit/);
  assert.match(source, /text_to_video/);
  assert.match(source, /model_routes:\(item\.model_routes/);
  assert.match(source, /FIXED_PROTOCOL_PROVIDER_IDS[^\n]*'venice'/);
  assert.match(css, /\.model-row\.has-venice-route/);
  assert.match(css, /\.venice-model-route/);
  assert.doesNotMatch(source, /function veniceModelColumnsHtml/);
  assert.match(source, /function veniceModelFieldsHtml/);
  assert.match(source, /api\.currentModelId/);
  assert.match(source, /api\.veniceImageRouteLabel/);
  assert.match(source, /api\.veniceVideoRouteLabel/);
  assert.match(source, /modelDragHandleHtml\('ID'/);
  assert.match(source, /modelDragHandleHtml\('NM'/);
  assert.match(source, /veniceModelRouteHtml[\s\S]*venice-model-name-field/);
  assert.match(veniceFields, /veniceModelRouteHtml\(kind, index, draft, item\)/);
  assert.doesNotMatch(css, /\.venice-model-columns/);

  const routeHtml = new Function(
    'veniceModelRouteName',
    'tr',
    'escapeAttr',
    'modelDragHandleHtml',
    `return (${extractFunction('veniceModelRouteHtml')});`
  )(kind => kind === 'image' ? 'image_edit' : 'text_to_video', key => key, String, () => '');
  const renderFields = new Function(
    'tr',
    'escapeAttr',
    'modelDragHandleHtml',
    'veniceModelRouteHtml',
    `return (${veniceFields});`
  )(key => key, String, () => '', routeHtml);
  const rendered = renderFields(
    'image',
    0,
    {id:'chroma', alias:'Chroma', route:'firered-image-edit'},
    {protocol:'venice'}
  );
  assert.match(rendered, /value="firered-image-edit"/);
});

test('model metadata follows stable row drafts instead of migrating on each ID keystroke', () => {
  assert.match(source, /function createModelDraft/);
  assert.match(source, /rowId:`model-draft-/);
  assert.match(source, /function materializeModelDrafts/);
  assert.match(source, /aliasDirty:false/);
  assert.match(source, /routeDirty:false/);
  assert.match(source, /if\(!originalIds\.has\(key\)\) routes\[key\] = value/);
  assert.doesNotMatch(extractFunction('updateModel'), /item\.model_routes|item\.model_aliases|item\.model_protocols/);
});

test('materializing new rows cannot clear untouched metadata on existing rows', () => {
  const drafts = {
    image:[
      {originalId:'grok-imagine-image-2-0', id:'grok-imagine-image-2-0', alias:'', aliasDirty:false, protocol:'', protocolDirty:false, route:'', routeDirty:false},
      {originalId:'', id:'grok-imagine-image-2-1', alias:'2', aliasDirty:true, protocol:'', protocolDirty:false, route:'1', routeDirty:true},
      {originalId:'', id:'grok-imagine-image-2-2', alias:'2', aliasDirty:true, protocol:'', protocolDirty:false, route:'1', routeDirty:true}
    ],
    chat:[],
    video:[]
  };
  const materialize = new Function(
    'syncModelDraftArrays',
    'modelDrafts',
    'veniceModelRouteName',
    `return (${extractFunction('materializeModelDrafts')});`
  )(() => {}, (_item, kind) => drafts[kind], kind => kind === 'image' ? 'image_edit' : kind === 'video' ? 'text_to_video' : '');
  const item = {
    _modelDrafts:drafts,
    _modelDraftOriginalIds:new Set(['grok-imagine-image-2-0']),
    model_aliases:{'grok-imagine-image-2-0':'Grok Imagine 2.0'},
    model_protocols:{},
    model_routes:{}
  };
  materialize(item);
  assert.equal(item.model_aliases['grok-imagine-image-2-0'], 'Grok Imagine 2.0');
  assert.equal(item.model_aliases['grok-imagine-image-2-1'], '2');
  assert.equal(item.model_routes['grok-imagine-image-2-2'].image_edit, '1');

  drafts.image[0].aliasDirty = true;
  materialize(item);
  assert.equal(item.model_aliases['grok-imagine-image-2-0'], undefined);
});

test('Venice image rows no longer expose manual capability controls', () => {
  assert.doesNotMatch(source, /function veniceImageCapabilityHtml/);
  assert.doesNotMatch(source, /function updateVeniceImageCapability/);
  assert.doesNotMatch(source, /has-venice-capabilities/);
  assert.doesNotMatch(css, /\.venice-model-capabilities/);
  assert.doesNotMatch(css, /\.venice-size-mode/);
  assert.doesNotMatch(css, /\.venice-quality-toggle/);
  assert.match(source, /onclick="removeModel\('\$\{kind\}', \$\{index\}\)"/);
});

test('chat model ID and name fields use the same compact prefixes', () => {
  assert.match(source, /function standardModelFieldsHtml/);
  assert.match(source, /kind === 'chat'/);
  assert.match(source, /model-inputs model-prefixed-inputs/);
  assert.match(css, /\.model-prefixed-inputs/);
  assert.match(css, /\.model-prefixed-inputs \.model-id-field[^}]*flex:1\.18/);
  assert.match(css, /\.model-prefixed-inputs \.model-name-field[^}]*flex:\.82/);
});

test('RunningHub image and video model rows reuse the ID and NM prefixes', () => {
  assert.match(source, /item\?\.id === 'runninghub'/);
  assert.match(source, /item\?\.protocol[\s\S]*=== 'runninghub'/);
  assert.match(source, /standardModelFieldsHtml\(kind, index, draft, item\)/);
});

test('prefixed model labels are drag handles that reorder only the selected model list', () => {
  assert.match(source, /function modelDragHandleHtml/);
  assert.match(source, /class="model-drag-handle" draggable="true"/);
  assert.match(source, /startModelRowDrag\(event, '\$\{kind\}', \$\{index\}\)/);
  assert.match(source, /ondragover="dragModelRowOver/);
  assert.match(source, /ondrop="dropModelRow/);
  assert.match(css, /\.model-drag-handle\s*\{[^}]*cursor:grab/);
  assert.match(css, /\.model-row\.is-drop-before/);
  assert.match(css, /\.model-row\.is-drop-after/);

  const imageDrafts = [{id:'a'}, {id:'b'}, {id:'c'}];
  const videoDrafts = [{id:'v1'}, {id:'v2'}];
  const item = {image_models:['a', 'b', 'c'], video_models:['v1', 'v2']};
  const reorder = new Function(
    'provider',
    'modelDrafts',
    'syncModelDraftArrays',
    'renderModels',
    'renderMsLoras',
    `return (${extractFunction('reorderModel')});`
  )(() => item, (_item, kind) => kind === 'image' ? imageDrafts : videoDrafts, current => {
    current.image_models = imageDrafts.map(draft => draft.id);
    current.video_models = videoDrafts.map(draft => draft.id);
  }, () => {}, () => {});
  assert.equal(reorder('image', 0, 3), true);
  assert.deepEqual(item.image_models, ['b', 'c', 'a']);
  assert.deepEqual(item.video_models, ['v1', 'v2']);
  assert.equal(reorder('image', 1, 1), false);
});

test('model input focus is drawn by the rounded field without a clipped native outline', () => {
  assert.match(css, /\.model-row input\s*\{[^}]*outline:none/);
  assert.match(css, /\.venice-model-route:focus-within,\.model-prefixed-field:focus-within\s*\{[^}]*border-color:var\(--text\) !important[^}]*border-style:solid[^}]*box-shadow:none/);
});

test('new Venice rows mark every empty text field and clear markers while typing', () => {
  const veniceFields = extractFunction('veniceModelFieldsHtml');
  const routeUpdate = extractFunction('updateVeniceModelRoute');
  assert.match(veniceFields, /venice-model-id-field\$\{idMissing\}/);
  assert.match(veniceFields, /venice-model-name-field\$\{nameMissing\}/);
  assert.match(veniceFields, /syncModelFieldMissing\(this\)/);
  assert.match(veniceFields, /syncPendingVeniceModelFields/);
  assert.match(css, /\.venice-model-route\.is-missing,\.venice-model-field\.is-missing\s*\{[^}]*border-style:solid[^}]*border-color:rgba\(180,83,9,\.28\)/);
  assert.match(css, /body\.studio-theme-dark \.venice-model-route\.is-missing,body\.studio-theme-dark \.venice-model-field\.is-missing\s*\{[^}]*border-color:rgba\(251,191,36,\.32\)/);
  assert.ok(routeUpdate.indexOf("classList.toggle('is-missing', !target)") < routeUpdate.indexOf("if(!item || String(item.protocol"));

  const draft = {id:'', route:''};
  const item = {protocol:'venice', image_models:[''], model_routes:{}};
  let routeMissing = true;
  const control = {classList:{toggle:(name, active) => { if(name === 'is-missing') routeMissing = active; }}, title:''};
  const input = {value:'edit-model', closest:() => control};
  const updateRoute = new Function(
    'provider',
    'veniceModelRouteName',
    'modelDrafts',
    'tr',
    `return (${routeUpdate});`
  )(() => item, kind => kind === 'image' ? 'image_edit' : '', () => [draft], key => key);
  updateRoute('image', 0, input);
  assert.equal(routeMissing, false);
  assert.equal(draft.route, 'edit-model');
  input.value = '';
  updateRoute('image', 0, input);
  assert.equal(routeMissing, true);
  assert.equal(draft.route, '');
});

test('model saves reject incomplete or duplicate drafts and protect manual persistence', () => {
  const validation = extractFunction('validateModelDraftsForSave');
  assert.match(validation, /缺少模型 ID/);
  assert.match(validation, /模型 ID 重复/);
  assert.match(validation, /系统不会静默删除任何行/);
  assert.match(source, /'X-Provider-Revision':providersRevision/);
  assert.match(source, /changedDuringSave/);
  assert.match(source, /providersDraftSnapshot\(\) !== requestSnapshot/);
  assert.match(source, /此前修改已保存；保存期间的新修改仍在草稿中/);
  assert.doesNotMatch(extractFunction('handleProviderDrop'), /saveProviders/);
  assert.doesNotMatch(extractFunction('deleteProvider'), /saveProviders/);
  assert.doesNotMatch(extractFunction('addCliProvider'), /saveProviders/);
  assert.doesNotMatch(extractFunction('clearKeyOnly'), /saveProviders/);
});

test('save snapshots ignore object key order but preserve model row order', () => {
  const stableValue = new Function(`return (${extractFunction('stableProviderSnapshotValue')});`)();
  const snapshot = value => JSON.stringify(stableValue(value));
  assert.equal(
    snapshot([{model_routes:{chroma:{image_edit:'edit-a'}, dsfs:{image_edit:'edit-b'}}}]),
    snapshot([{model_routes:{dsfs:{image_edit:'edit-b'}, chroma:{image_edit:'edit-a'}}}])
  );
  assert.notEqual(
    snapshot([{image_models:['chroma', 'dsfs']}]),
    snapshot([{image_models:['dsfs', 'chroma']}])
  );
  assert.notEqual(
    snapshot([{model_routes:{dsfs:{image_edit:'edit-a'}}}]),
    snapshot([{model_routes:{dsfs:{image_edit:'edit-b'}}}])
  );
});

test('RunningHub editor locks the page behind its modal', () => {
  assert.match(css, /html\.rh-workflow-editor-open,[\s\S]*body\.rh-workflow-editor-open\s*\{[^}]*overflow:hidden !important/);
  assert.match(css, /\.rh-workflow-editor-overlay\s*\{[^}]*position:absolute;[^}]*overscroll-behavior:none/);
  assert.match(css, /\.rh-workflow-editor-modal\s*\{[^}]*height:min\(980px, 96vh\)[^}]*overscroll-behavior:contain/);
  assert.match(source, /function rhWorkflowEditorUiScale\(\)[\s\S]*--studio-ui-scale/);
  assert.match(source, /RH_WORKFLOW_EDITOR_BLUR_OVERSCAN = 24/);
  assert.match(source, /rhWorkflowEditorOverlayMetrics\([\s\S]*RH_WORKFLOW_EDITOR_BLUR_OVERSCAN[\s\S]*\);/);
  assert.match(source, /function unlockRhWorkflowEditorViewport\(\)[\s\S]*scrollingElement\.scrollTop = lock\.top/);
  assert.match(source, /postMessage\(\{type:'studio-child-modal-state', open:open === true, page:'api-settings'\}/);
  assert.match(source, /function rhEditorCanConsumeWheel\(target, deltaY\)/);
  assert.match(source, /document\.addEventListener\('wheel',[\s\S]*event\.preventDefault\(\);[\s\S]*\{passive:false\}\)/);
  assert.match(indexHtml, /body\.studio-child-modal-open \.sidebar\s*\{[^}]*pointer-events: none/);
  assert.doesNotMatch(indexHtml, /--studio-modal-sidebar-width/);
  assert.doesNotMatch(indexHtml, /body\.studio-child-modal-open \.app-shell::after/);
  assert.doesNotMatch(indexHtml, /setStudioChildModalState[\s\S]*getBoundingClientRect/);
  assert.match(indexHtml, /function setStudioChildModalState\(open, source = null\)/);
  assert.match(indexHtml, /event\.data\?\.type === 'studio-child-modal-state'/);
});

test('RunningHub modal viewport metrics compensate transformed UI scale', () => {
  const metrics = new Function(`return (${extractFunction('rhWorkflowEditorOverlayMetrics')});`)();
  const viewport = metrics({top:480, left:24}, 1920, 1080, 0.8, 24);
  assert.deepEqual(viewport, {top:570, left:0, width:2460, height:1410});
  assert.equal(viewport.top * 0.8 - 480, -24);
  assert.equal(viewport.left * 0.8 - 24, -24);
  assert.equal(viewport.width * 0.8, 1968);
  assert.equal(viewport.height * 0.8, 1128);
});

test('RunningHub field popovers stay clickable and inside the scaled editor viewport', () => {
  assert.match(css, /\.rh-node-popover\s*\{[^}]*position:absolute/);
  assert.match(source, /function mountRhEditorPopover\(pop, anchorEl, placement='right'\)[\s\S]*rhWorkflowEditorOverlay[\s\S]*host\.appendChild\(pop\)/);
  assert.match(source, /class="rh-app-field-settings"[\s\S]*openRhAppFieldPopover/);
  const position = new Function(`return (${extractFunction('rhEditorPopoverViewportPosition')});`)();
  assert.deepEqual(
    position({left:620, right:940, top:600, bottom:696}, 390, 420, 1280, 720, 'below'),
    {left:620, top:170}
  );
  assert.deepEqual(
    position({left:1100, right:1200, top:500, bottom:570}, 390, 300, 1280, 720, 'right'),
    {left:698, top:404}
  );
});

test('RunningHub refetch preserves custom settings for unchanged fields', () => {
  const fieldKey = field => `${field?.nodeId || ''}::${field?.fieldName || ''}`;
  const customProps = [
    'label', 'enabled', 'sourceFromUpstream', 'fieldType', 'options',
    'random_enabled', 'min', 'max', 'step', 'imageOrder', 'required'
  ];
  const mergeRhFetchedFields = new Function(
    'rhWorkflowFieldKey',
    'RH_EDITOR_CUSTOM_FIELD_PROPS',
    `return (${extractFunction('mergeRhFetchedFields')});`
  )(fieldKey, customProps);
  const current = [{
    nodeId:'app', fieldName:'prompt', fieldValue:'old default', label:'自定义提示词',
    enabled:false, sourceFromUpstream:true, fieldType:'SELECT', options:['A', 'B'],
    random_enabled:true, min:'2', max:'8', step:'2', imageOrder:3, required:false
  }];
  const fetched = [
    {nodeId:'app', fieldName:'prompt', fieldValue:'new default', label:'提示词', enabled:true, fieldType:'TEXT', options:[]},
    {nodeId:'app', fieldName:'amount', fieldValue:'1', label:'生成批次', enabled:true, fieldType:'SLIDER', options:[]}
  ];
  const merged = mergeRhFetchedFields(fetched, current);
  assert.equal(merged[0].fieldValue, 'new default');
  assert.equal(merged[0].label, '自定义提示词');
  assert.equal(merged[0].enabled, false);
  assert.equal(merged[0].fieldType, 'SELECT');
  assert.deepEqual(merged[0].options, ['A', 'B']);
  assert.equal(merged[1].label, '生成批次');
  assert.equal(merged[1].enabled, true);
});
