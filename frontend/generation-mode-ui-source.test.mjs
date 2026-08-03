import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js = readFileSync(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../static/smart-canvas.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../static/css/smart-canvas.css', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('./smart-prompt-editor.js', import.meta.url), 'utf8');

test('Smart Canvas exposes the compact generation-mode picker instead of the old composer template entry', () => {
  assert.match(html, /id="generationModeBtn"/);
  assert.match(html, /id="generationModePanel"/);
  assert.doesNotMatch(html, /id="generationModeBadge"/);
  assert.doesNotMatch(html, /id="composerTemplateBtn"/);
  assert.match(html, /composer-head-actions[\s\S]*id="generationModeControl"[\s\S]*id="promptAssistantBtn"/);
  assert.doesNotMatch(html, /generation-mode-btn-label/);
  assert.match(css, /\.generation-mode-btn\s*\{[^}]*width:30px[^}]*height:30px/);
  assert.match(css, /\.generation-mode-control\s*\{[^}]*z-index:90/);
  assert.match(css, /\.generation-mode-panel\s*\{[^}]*max-height:min\(620px/);
  assert.match(css, /\.generation-mode-groups\s*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /\.generation-mode-option-copy small\s*\{[^}]*-webkit-line-clamp:2/);
});

test('selected mode is a non-document ProseMirror inline decoration compatible with media atoms', () => {
  assert.doesNotMatch(css, /text-indent:var\(--generation-mode-inline-offset/);
  assert.doesNotMatch(js, /syncGenerationModeInlineLayout/);
  assert.match(js, /promptEditor\?\.setInlinePrefix\?\./);
  assert.match(editorSource, /Decoration\.widget\(1,[\s\S]*?side:-1/);
  assert.match(editorSource, /setMeta\(this\.inlinePrefixPluginKey, next\)/);
  assert.match(editorSource, /smart-prompt-prefix-activate/);
  assert.match(editorSource, /window\.lucide\?\.createElement/);
  assert.doesNotMatch(editorSource, /smart-prompt-inline-prefix-description/);
  assert.match(css, /smart-prompt-inline-prefix-chip[^}]*height:18px/);
  assert.doesNotMatch(css, /smart-prompt-inline-prefix-description/);
});

test('mode picker closes on outside composer interactions and Escape', () => {
  assert.match(js, /document\.addEventListener\('click', event => \{[\s\S]*?#generationModeControl, \.smart-prompt-inline-prefix-chip[\s\S]*?closeGenerationModePanel\(\);[\s\S]*?\}, true\);/);
  assert.match(js, /event\.key === 'Escape'[^\n]*closeGenerationModePanel\(\)/);
});

test('mode picker opens after a complete click without keyboard-selection state', () => {
  const pointerHandler = editorSource.match(/root\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointerHandler, /preventDefault\(\)/);
  assert.doesNotMatch(pointerHandler, /smart-prompt-prefix-activate/);
  assert.match(editorSource, /root\.addEventListener\('click',[\s\S]*?smart-prompt-prefix-activate/);
  assert.doesNotMatch(js, /generationModeFocusIndex|handleGenerationModeKeydown|setGenerationModeFocusIndex/);
  assert.doesNotMatch(css, /generation-mode-option\.focused/);
});

test('mode prefix reuses the media-token caret overlay at document position one and keeps a stable pointer cursor', () => {
  assert.match(editorSource, /besidePrefix[^\n]*selection\.from === 1[\s\S]*?inlinePrefixCaretGeometry\(prefix\)/);
  assert.doesNotMatch(editorSource, /besideEmptyPrefix/);
  assert.match(editorSource, /addEventListener\('pointerdown', this\.initialPointerPlacementCapture, true\)/);
  assert.match(editorSource, /prepareInitialPointerPlacement\(event\)[\s\S]*?posAtCoords[\s\S]*?Selection\.near[\s\S]*?setSelection\(selection\)\.setMeta\('pointer', true\)/);
  const initialPlacement = editorSource.match(/\n  prepareInitialPointerPlacement\(event\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(initialPlacement, /\.smart-prompt-inline-prefix, \.prompt-reference-token/);
  assert.doesNotMatch(initialPlacement, /preventDefault\(\)/);
  assert.doesNotMatch(editorSource, /pointerSelectionPending|pointerSelectionFrame|selectionActivated/);
  assert.doesNotMatch(editorSource, /prepareInlinePrefixCaretForPointer/);
  assert.match(editorSource, /inlinePrefixCaretGeometry\(prefix\)[\s\S]*?fontSize \+ 1/);
  assert.match(editorSource, /position === 1[^\n]*smart-prompt-inline-prefix[\s\S]*?inlinePrefixCaretGeometry\(prefix\)[\s\S]*?: this\.caretOverlayGeometry\(position, line, clientX\)/);
  assert.match(css, /smart-prompt-inline-prefix,\.smart-prompt-inline-prefix \*[^}]*cursor:pointer !important/);
});

test('fresh node content prepositions the first pointer selection and maximized composer restores focus', () => {
  assert.match(editorSource, /setValue\(docJson,[\s\S]*?initialPointerPlacementPending = true/);
  assert.match(editorSource, /getSelectionRange\(\)[\s\S]*?anchor[\s\S]*?head/);
  assert.match(editorSource, /restoreSelection\(range,[\s\S]*?TextSelection\.create[\s\S]*?this\.view\.focus\(\)/);
  assert.match(editorSource, /focusForExpansion\(range\)[\s\S]*?initialPointerPlacementPending[\s\S]*?focusEnd\(\)[\s\S]*?restoreSelection\(range/);
  const expand = js.match(/function setComposerExpanded\(expanded\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(expand, /composerExpanded && !restorePromptSelection\(promptSelection, \{endIfUntouched:true\}\)[^\n]*promptEditor\?\.focusEnd/);
});

test('composer fade-out keeps the saved prompt mounted instead of flashing an empty editor', () => {
  assert.doesNotMatch(js, /if\(!node\) setPromptText\(''\)/);
  assert.match(js, /Keep the saved draft mounted while the composer fades out/);
});

test('generation-mode accents reuse the canvas blue theme token', () => {
  assert.doesNotMatch(css, /#a855f7/i);
  assert.match(css, /smart-prompt-inline-prefix-chip[^}]*var\(--connection-flow\)/);
  assert.match(css, /generation-mode-btn\.active[^}]*var\(--connection-flow\)/);
  assert.match(css, /generation-mode-option\.active[^}]*var\(--connection-flow\)/);
  assert.match(css, /generation-mode-check[^}]*color:var\(--connection-flow\)/);
});

test('bottom parameter popovers require real pointer movement before hover can open them', () => {
  assert.match(js, /ctrl\.onpointermove = event => \{[\s\S]*?classList\.add\('hover-armed'\)/);
  assert.match(js, /ctrl\.onmouseleave = \(\) => \{[\s\S]*?classList\.remove\('interacting', 'hover-armed'\)/);
  assert.match(js, /function disarmDynamicParamHover\(/);
  assert.match(js, /function closeGenerationModePanel\(\)[\s\S]*?disarmDynamicParamHover\(\)/);
  assert.match(css, /dynamic-params \.smart-control:not\(\.hover-armed\)[^}]*hover \.smart-popover[^}]*visibility:hidden/);
});

test('generation catalog reads the API response wrapper used by the backend', () => {
  const loader = js.match(/async function loadGenerationPromptCatalog\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(loader, /data\?\.catalog\?\.generation_prompts/);
});

test('generation modes are limited to RunningHub and Venice image generation', () => {
  const fn = js.match(/function generationModeSupported\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /engine === 'runninghub'/);
  assert.match(fn, /engine !== 'api'/);
  assert.match(fn, /protocol[^\n]*venice/);
  assert.match(fn, /apiKind === 'video'/);
});

test('mode selection snapshots the hidden template and overwrites only existing size settings', () => {
  const selection = js.match(/function selectGenerationMode\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(selection, /generationPromptSnapshot = snapshot/);
  assert.match(selection, /applyGenerationModeRecommendations\(settings, snapshot\)/);
  assert.match(selection, /subject\.runSettings = settingsForStorage\(settings\)/);
  assert.doesNotMatch(selection, /model\s*=/);
  assert.doesNotMatch(selection, /quality\s*=/);
  assert.doesNotMatch(selection, /count\s*=/);
});

test('hidden templates compile only while building the provider request', () => {
  const request = js.match(/function buildPromptRequest\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(request, /const displayPrompt = originalPrompt \|\| body/);
  assert.match(request, /compileGenerationModePrompt\(node, rawBody\)/);
  assert.match(request, /providerPrompts:\{api_image:body, venice_video:veniceBody \|\| body\}/);
  assert.doesNotMatch(html, /prompt_template/);
});
