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
  assert.match(managerCss, /-webkit-line-clamp:2/);
  assert.match(managerCss, /prompt-row-main[^}]*height:63px/);
  assert.match(managerCss, /prompt-generation-template[^}]*min-height:330px/);
  assert.match(managerCss, /prompt-description-input[^}]*min-height:60px/);
  assert.match(managerCss, /prompt-generation-template-body[^}]*height:408px/);
  assert.match(managerCss, /generation-params-list[^}]*grid-template-columns:repeat\(2/);
});
