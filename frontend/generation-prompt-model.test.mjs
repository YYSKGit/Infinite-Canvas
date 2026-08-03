import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGenerationPromptRecommendations,
  compileGenerationPrompt,
  compileGenerationPromptSnapshot,
  generationPromptSnapshot,
  normalizeRecommendedRatio,
  normalizeRecommendedResolution,
  smartRatioSetting,
  smartResolutionSetting,
  validateGenerationPromptTemplate
} from './generation-prompt-model.mjs';

test('generation template requires exactly one user prompt token', () => {
  assert.equal(validateGenerationPromptTemplate('生成角色：{{user_prompt}}').valid, true);
  assert.equal(validateGenerationPromptTemplate('生成角色').valid, false);
  assert.equal(validateGenerationPromptTemplate('{{user_prompt}} 和 {{user_prompt}}').valid, false);
});

test('compiles the user prompt at the template-defined position', () => {
  assert.equal(
    compileGenerationPrompt('固定要求。\n用户补充：{{user_prompt}}\n保持角色一致。', '服装改为常服'),
    '固定要求。\n用户补充：服装改为常服\n保持角色一致。'
  );
});

test('uses a natural fallback when user prompt is empty', () => {
  assert.equal(
    compileGenerationPrompt('用户补充：{{user_prompt}}', '  '),
    '用户补充：没有额外修改要求。'
  );
});

test('normalizes ratio and resolution without provider-specific settings', () => {
  assert.equal(normalizeRecommendedRatio(' 16 : 9 '), '16:9');
  assert.equal(normalizeRecommendedResolution('2048 x 2048'), '2048×2048');
  assert.equal(normalizeRecommendedResolution('4k'), '4K');
  assert.throws(() => normalizeRecommendedRatio('landscape'));
  assert.throws(() => normalizeRecommendedResolution('high'));
});

test('stores an immutable generation-mode snapshot and compiles only the final request', () => {
  const snapshot = generationPromptSnapshot({
    id:'character-sheet',
    name:'角色设定图',
    category:'设定图',
    description:'角色主视觉与设定拆解',
    prompt_template:'固定生成要求：\n{{user_prompt}}\n保持角色一致。',
    recommended_ratio:'16:9',
    recommended_resolution:'2K',
    model:'must-not-leak'
  });
  assert.deepEqual(Object.keys(snapshot), [
    'id', 'name', 'category', 'description', 'icon', 'prompt_template',
    'recommended_ratio', 'recommended_resolution'
  ]);
  assert.equal(
    compileGenerationPromptSnapshot(snapshot, '将服装调整为常服'),
    '固定生成要求：\n将服装调整为常服\n保持角色一致。'
  );
});

test('maps recommendations to existing canvas size settings without touching model settings', () => {
  assert.deepEqual(smartRatioSetting('16:9'), {ratio:'wide', customRatio:''});
  assert.deepEqual(smartRatioSetting('2:1'), {ratio:'custom', customRatio:'2:1'});
  assert.deepEqual(smartResolutionSetting('2K'), {resolution:'2k', customSize:''});
  assert.deepEqual(smartResolutionSetting('2048×1024'), {resolution:'custom', customSize:'2048x1024'});
  assert.deepEqual(
    applyGenerationPromptRecommendations({model:'gpt-image-2', quality:'high', count:3}, {
      recommended_ratio:'3:2', recommended_resolution:'4K'
    }),
    {model:'gpt-image-2', quality:'high', count:3, ratio:'landscape', customRatio:'', resolution:'4k', customSize:''}
  );
});
