import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const managerSource = await readFile(new URL('../static/js/asset-manager.js', import.meta.url), 'utf8');
const managerHtml = await readFile(new URL('../static/asset-manager.html', import.meta.url), 'utf8');

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

test('system built-ins cannot be selected for deletion and can be restored', () => {
  assert.match(managerSource, /readonly \|\| item\.builtin \? 'disabled'/);
  assert.match(managerSource, /currentPromptItems\(\)\.filter\(item => !item\.builtin\)/);
  assert.match(managerSource, /if\(item\.builtin\)\{ setStatus\('系统内置内容不能删除/);
  assert.match(managerSource, /data-prompt-reset/);
  assert.match(managerSource, /\/api\/prompt-catalog\/\$\{promptCatalogResource\(\)\}\/\$\{encodeURIComponent\(id\)\}\/reset/);
});
