import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const smartSource = await readFile(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const canvasSource = await readFile(new URL('../static/js/canvas.js', import.meta.url), 'utf8');
const canvasHtml = await readFile(new URL('../static/canvas.html', import.meta.url), 'utf8');
const backendSource = await readFile(new URL('../main.py', import.meta.url), 'utf8');

test('Smart Canvas generation modes and assistant instructions share the new catalog', () => {
  assert.match(smartSource, /catalog\?\.generation_prompts/);
  assert.match(smartSource, /catalog\?\.system_instructions/);
  assert.match(smartSource, /api\/prompt-catalog\/system-instructions/);
  assert.doesNotMatch(smartSource, /api\/prompt-libraries/);
  assert.doesNotMatch(smartSource, /smart_canvas_prompt_(?:presets|template_groups|template_overrides)/);
  assert.doesNotMatch(smartSource, /recommended_(?:provider|model)/);
});

test('ordinary canvas stores a hidden generation-mode snapshot and compiles it per supported generator', () => {
  assert.match(canvasHtml, /generation-prompt-model\.js/);
  assert.match(canvasHtml, />生成模式</);
  assert.doesNotMatch(canvasHtml, /promptTemplateLibrarySelect/);
  assert.match(canvasSource, /node\.generationPromptSnapshot = snapshot/);
  assert.match(canvasSource, /compileGenerationPromptSnapshot\?\.\(mode, raw\)/);
  assert.match(canvasSource, /generator\?\.type === 'rh'/);
  assert.match(canvasSource, /protocol[^\n]*venice/);
  assert.match(canvasSource, /applyGenerationPromptRecommendations\?\.\(generator, snapshot\)/);
  assert.match(canvasSource, /async function runRhNode[\s\S]*?const effectiveNode = canvasGeneratorWithRecommendations\(node, media\.sources\)[\s\S]*?rhBuildNodeInfoList\(effectiveNode, media\)/);
  assert.match(canvasSource, /promptRecords:\(options\.promptRecords \|\| \[\]\)/);
  assert.match(canvasSource, /generationPromptSnapshot:canvasGenerationPromptSnapshot/);
  assert.doesNotMatch(canvasSource, /api\/prompt-libraries/);
  assert.doesNotMatch(canvasSource, /Negative prompt:/);
});

test('legacy prompt-library backend and markdown parser are removed', () => {
  assert.doesNotMatch(backendSource, /PROMPT_LIBRARY_PATH/);
  assert.doesNotMatch(backendSource, /api\/prompt-libraries/);
  assert.doesNotMatch(backendSource, /api\/smart-canvas\/prompt-templates/);
  assert.doesNotMatch(backendSource, /parse_prompt_template_markdown/);
  assert.doesNotMatch(backendSource, /PromptLibrary(?:Request|ItemRequest|CategoryRequest|BatchDeleteRequest)/);
});

test('prompt catalog derives built-ins server-side and protects both resource types', () => {
  assert.match(backendSource, /mark_prompt_catalog_builtins/);
  assert.match(backendSource, /generation-prompts\/\{item_id\}\/reset/);
  assert.match(backendSource, /system-instructions\/\{item_id\}\/reset/);
  assert.match(backendSource, /prompt_catalog_builtin_item\("generation_prompts", item_id\)/);
  assert.match(backendSource, /prompt_catalog_builtin_item\("system_instructions", item_id\)/);
  assert.doesNotMatch(backendSource, /def find_prompt_library\(/);
});
