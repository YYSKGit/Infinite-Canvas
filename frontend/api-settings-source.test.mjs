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
  assert.doesNotMatch(css, /\.venice-model-columns/);
});

test('Venice routes follow source model rename and deletion', () => {
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(item\.model_routes, oldName\)/);
  assert.match(source, /delete item\.model_routes\[removed\]/);
});

test('Venice image rows expose compact editable capability controls', () => {
  assert.match(source, /function veniceImageCapabilityHtml/);
  assert.match(source, /updateVeniceImageCapability\(\$\{index\}, 'size_mode'/);
  assert.match(source, /updateVeniceImageCapability\(\$\{index\}, 'supports_quality'/);
  assert.match(source, /item\.image_capabilities\[model\] = current/);
  assert.match(source, /has-venice-capabilities/);
  assert.match(css, /\.venice-model-capabilities[^}]*grid-template-columns:104px 38px/);
  assert.match(css, /\.venice-size-mode select[^}]*--app-select-menu-min-width:78px/);
  assert.match(css, /\.model-row\.has-venice-route\.has-venice-capabilities/);
  assert.match(css, /\.venice-quality-toggle:has\(input:checked\)/);
  const capability = new Function(`return (${extractFunction('veniceImageCapability')});`)();
  const item = {
    protocol:'venice',
    image_models:['model-a'],
    image_capabilities:{'model-a':{size_mode:'aspect', supports_quality:false}}
  };
  const update = new Function(
    'provider',
    'veniceImageCapability',
    `return (${extractFunction('updateVeniceImageCapability')});`
  )(() => item, capability);
  update(0, 'supports_quality', true);
  assert.deepEqual(item.image_capabilities['model-a'], {size_mode:'aspect', supports_quality:true});
  update(0, 'size_mode', 'pixel');
  assert.deepEqual(item.image_capabilities['model-a'], {size_mode:'pixel', supports_quality:true});
  update(0, 'size_mode', 'unsupported');
  assert.equal(item.image_capabilities['model-a'].size_mode, 'pixel');
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
  assert.match(source, /standardModelFieldsHtml\(kind, index, model, alias, item\)/);
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

  const item = {image_models:['a', 'b', 'c'], video_models:['v1', 'v2']};
  const reorder = new Function(
    'provider',
    'renderModels',
    'renderMsLoras',
    `return (${extractFunction('reorderModel')});`
  )(() => item, () => {}, () => {});
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

  const item = {protocol:'venice', image_models:[''], model_routes:{}};
  let routeMissing = true;
  const control = {classList:{toggle:(name, active) => { if(name === 'is-missing') routeMissing = active; }}, title:''};
  const input = {value:'edit-model', closest:() => control};
  const updateRoute = new Function(
    'provider',
    'veniceModelRouteName',
    'tr',
    `return (${routeUpdate});`
  )(() => item, kind => kind === 'image' ? 'image_edit' : '', key => key);
  updateRoute('image', 0, input);
  assert.equal(routeMissing, false);
  assert.deepEqual(item.model_routes, {});
  item.image_models[0] = 'source-model';
  updateRoute('image', 0, input);
  assert.equal(item.model_routes['source-model'].image_edit, 'edit-model');
  input.value = '';
  updateRoute('image', 0, input);
  assert.equal(routeMissing, true);
  assert.deepEqual(item.model_routes, {});
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
