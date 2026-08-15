import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const managerSource = await readFile(new URL('../static/js/asset-manager.js', import.meta.url), 'utf8');
const managerHtml = await readFile(new URL('../static/asset-manager.html', import.meta.url), 'utf8');
const builtInCatalog = JSON.parse(await readFile(new URL('../static/system-prompts/prompt-catalog.json', import.meta.url), 'utf8'));

test('standalone prompt manager uses the new two-resource catalog', () => {
  assert.match(managerSource, /api\/prompt-catalog/);
  assert.match(managerSource, /name:'生成提示词'/);
  assert.match(managerSource, /name:'系统指令'/);
  assert.doesNotMatch(managerSource, /api\/prompt-libraries/);
  assert.match(managerHtml, />提示词管理</);
});

test('standalone prompt manager omits retired generation fields', () => {
  for(const retiredField of [
    'promptEditNegative',
    'promptEditPositive',
    'promptEditRecommendedProvider',
    'promptEditRecommendedModel'
  ]){
    assert.doesNotMatch(managerSource, new RegExp(retiredField));
  }
  assert.match(managerSource, /promptEditPromptTemplate/);
  assert.match(managerSource, /promptEditRatio/);
  assert.match(managerSource, /promptEditResolution/);
});

test('standalone prompt manager uses the compact navigation and expanded template layout', async () => {
  const managerCss = await readFile(new URL('../static/css/asset-manager.css', import.meta.url), 'utf8');
  assert.doesNotMatch(managerSource, /全部生成提示词/);
  assert.match(managerCss, /prompt-row-scene[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(managerCss, /prompt-row-main[^}]*height:52px/);
  assert.match(managerCss, /prompt-generation-template[^}]*min-height:330px/);
  assert.match(managerCss, /prompt-description-input[^}]*min-height:60px/);
  assert.match(managerCss, /prompt-generation-template-body[^}]*height:408px/);
  assert.match(managerCss, /generation-params-list[^}]*grid-template-columns:repeat\(2/);
});

test('built-in badges occupy the prompt cover top-left opposite the category', async () => {
  const managerCss = await readFile(new URL('../static/css/asset-manager.css', import.meta.url), 'utf8');
  assert.match(managerSource, /prompt-card-cover[\s\S]*?prompt-tag prompt-tag-builtin[\s\S]*?prompt-tag-label[\s\S]*?<span class="prompt-tag">[\s\S]*?prompt-tag-label[\s\S]*?<div class="prompt-row-main">/);
  assert.doesNotMatch(managerSource, /prompt-row-title[^\n]*prompt-tag-builtin/);
  assert.match(managerCss, /prompt-card-cover \.prompt-tag-builtin[^}]*left:8px[^}]*right:auto/);
  assert.match(managerCss, /prompt-tag-label[^}]*translateY\(-1px\)/);
  assert.match(managerCss, /prompt-row-check[^}]*top:10px[^}]*width:16px[^}]*height:16px/);
});

test('content-card selection uses a quiet static border without an outer glow ring', async () => {
  const managerCss = await readFile(new URL('../static/css/asset-manager.css', import.meta.url), 'utf8');
  const selectedCardStyles = [
    managerCss.match(/\.asset-card\.active,\.prompt-row\.active\s*\{[^}]*\}/)?.[0] || '',
    managerCss.match(/body\.theme-dark \.asset-card\.active,body\.theme-dark \.prompt-row\.active\s*\{[^}]*\}/)?.[0] || ''
  ];
  selectedCardStyles.forEach(style => {
    assert.match(style, /box-shadow:0 6px 14px var\(--shadow\)/);
    assert.doesNotMatch(style, /0 0 0 1px/);
    assert.doesNotMatch(style, /animation:/);
  });
});

test('content-card hover only changes the border without lifting or adding a shadow', async () => {
  const managerCss = await readFile(new URL('../static/css/asset-manager.css', import.meta.url), 'utf8');
  for(const selector of ['asset-card', 'prompt-row']){
    const baseStyle = (managerCss.match(new RegExp(`\\.${selector} \\{[^}]*\\}`, 'g')) || [])
      .find(style => style.includes('transition:border-color')) || '';
    const hoverStyle = managerCss.match(new RegExp(`\\.${selector}:hover \\{[^}]*\\}`))?.[0] || '';
    assert.match(baseStyle, /transition:border-color \.14s ease/);
    assert.doesNotMatch(baseStyle, /transition:[^;}]*(?:box-shadow|transform)/);
    assert.match(hoverStyle, /border-color:color-mix\(in srgb, var\(--strong\) 32%, var\(--line\)\)/);
    assert.doesNotMatch(hoverStyle, /box-shadow|transform/);
  }
});

test('built-in system-instruction descriptions stay concise and period-free', () => {
  for(const instruction of builtInCatalog.system_instructions){
    assert.ok([...instruction.description].length <= 18, `${instruction.id} description is too long`);
    assert.doesNotMatch(instruction.description, /[\u3002\uFF01.!]/);
  }
});

test('asset reorder drag previews disable badge backdrop compositing artifacts', async () => {
  const managerCss = await readFile(new URL('../static/css/asset-manager.css', import.meta.url), 'utf8');
  assert.match(managerCss, /asset-card\.reorder-dragging \.asset-kind-badge[^}]*-webkit-backdrop-filter:none[^}]*backdrop-filter:none/);
  assert.match(managerCss, /asset-thumb img,\.asset-thumb video[^}]*-webkit-user-drag:none[^}]*user-select:none/);
  const assetThumbSource = managerSource.match(/function assetThumb\(item\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(assetThumbSource, /<video[^>]*draggable="false"/);
  assert.match(assetThumbSource, /<img[^>]*draggable="false"/);
});

test('generation prompts support safe manual ordering inside one visible category', async () => {
  const managerCss = await readFile(new URL('../static/css/asset-manager.css', import.meta.url), 'utf8');
  assert.match(managerSource, /function promptManualReorderEnabled\(\)[\s\S]*?activePromptResourceId === 'generation'[\s\S]*?activePromptCategory !== 'all'[\s\S]*?!promptQuery\.trim\(\)/);
  assert.match(managerSource, /data-prompt-row[\s\S]*?draggable="true" title="拖拽调整当前分类中的显示顺序"/);
  assert.match(managerSource, /api\/prompt-catalog\/generation-prompts\/reorder/);
  assert.match(managerSource, /JSON\.stringify\(\{category, item_ids:orderedIds\}\)/);
  assert.match(managerCss, /prompt-row\.reorder-before::before,\.prompt-row\.reorder-after::after/);
  const start = managerSource.indexOf('function reorderPromptCategoryItems(');
  const end = managerSource.indexOf('\nasync function persistPromptReorder(', start);
  const reorder = Function(`${managerSource.slice(start, end)}; return reorderPromptCategoryItems;`)();
  const reordered = reorder([
    {id:'story', category:'分镜'},
    {id:'face', category:'设定图'},
    {id:'light', category:'质感'},
    {id:'product', category:'设定图'},
    {id:'character', category:'设定图'},
  ], '设定图', ['character', 'face', 'product']);
  assert.deepEqual(reordered.map(item => item.id), ['story', 'character', 'light', 'face', 'product']);
});

test('system built-ins cannot be selected for deletion and can be restored', () => {
  assert.match(managerSource, /readonly \|\| item\.builtin \? 'disabled'/);
  assert.match(managerSource, /currentPromptItems\(\)\.filter\(item => !item\.builtin\)/);
  assert.match(managerSource, /if\(item\.builtin\)\{ setStatus\('系统内置内容不能删除/);
  assert.match(managerSource, /data-prompt-reset/);
  assert.match(managerSource, /\/api\/prompt-catalog\/\$\{promptCatalogResource\(\)\}\/\$\{encodeURIComponent\(id\)\}\/reset/);
});
