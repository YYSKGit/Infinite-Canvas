import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../static/smart-canvas.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../static/css/smart-canvas.css', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('./smart-prompt-editor.js', import.meta.url), 'utf8');
const builtInCatalog = JSON.parse(readFileSync(new URL('../static/system-prompts/prompt-catalog.json', import.meta.url), 'utf8'));

test('Smart Canvas exposes the compact generation-mode picker instead of the old composer template entry', () => {
  assert.match(html, /id="generationModeBtn"/);
  assert.match(html, /id="generationModePanel"/);
  assert.doesNotMatch(html, /id="generationModeBadge"/);
  assert.doesNotMatch(html, /id="composerTemplateBtn"/);
  assert.match(html, /composer-head-actions[\s\S]*id="generationModeControl"[\s\S]*id="promptAssistantBtn"/);
  assert.doesNotMatch(html, /generation-mode-btn-label/);
  assert.match(css, /\.generation-mode-btn\s*\{[^}]*width:30px[^}]*height:30px/);
  assert.match(css, /\.generation-mode-control\s*\{[^}]*z-index:90/);
  assert.match(css, /\.generation-mode-panel\s*\{[^}]*width:min\(500px[^}]*max-height:min\(620px/);
  assert.match(css, /\.generation-mode-panel\s*\{[^}]*right:-8px/);
  assert.match(css, /\.generation-mode-panel\s*\{[^}]*background:var\(--composer-popover-surface\)[^}]*border:1px solid var\(--composer-popover-border\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.mention-picker\s*\{[^}]*background:var\(--composer-popover-surface\)[^}]*border:1px solid var\(--composer-popover-border\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.composer \.smart-popover\s*\{[^}]*background:var\(--composer-popover-surface\)[^}]*border-color:var\(--composer-popover-border\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.theme-dark\s*\{[^}]*--composer-popover-surface:#1b2331[^}]*--composer-popover-shadow:0 28px 76px rgba\(0,0,0,\.52\)/);
  assert.match(css, /\.generation-mode-groups\s*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /\.generation-mode-column\s*\{[^}]*display:flex[^}]*flex-direction:column[^}]*gap:15px/);
  assert.match(css, /\.generation-mode-option\s*\{[^}]*height:48px/);
  assert.match(css, /\.generation-mode-option-copy small\s*\{[^}]*white-space:nowrap[^}]*opacity:0[^}]*translateY\(7px\)/);
  assert.match(css, /\.generation-mode-option:hover \.generation-mode-option-copy strong[^}]*translateY\(-6\.4px\)/);
  assert.match(css, /\.generation-mode-option:hover \.generation-mode-option-copy small[^}]*opacity:1[^}]*translateY\(3\.6px\)/);
  assert.match(css, /\.generation-mode-option\.active \.generation-mode-option-copy small[^}]*opacity:1/);
  assert.match(css, /\.generation-mode-option\s*\{[^}]*padding:6px 7px/);
  assert.doesNotMatch(css, /generation-mode-check/);
  assert.doesNotMatch(js, /generation-mode-check/);
});

test('built-in generation-mode descriptions stay short enough for the single-line reveal', () => {
  for(const mode of builtInCatalog.generation_prompts){
    assert.doesNotMatch(mode.description, /[\r\n]/);
    assert.doesNotMatch(mode.description, /。$/);
    assert.ok([...mode.description].length <= 24, `${mode.id} description is too long`);
  }
});

test('selected mode is a non-document ProseMirror inline decoration compatible with media atoms', () => {
  assert.doesNotMatch(css, /text-indent:var\(--generation-mode-inline-offset/);
  assert.doesNotMatch(js, /syncGenerationModeInlineLayout/);
  assert.match(js, /promptEditor\?\.setInlinePrefix\?\./);
  assert.match(editorSource, /Decoration\.widget\(1,[\s\S]*?side:-1/);
  assert.match(editorSource, /setMeta\(this\.inlinePrefixPluginKey, next\)/);
  assert.match(editorSource, /smart-prompt-prefix-activate/);
  assert.match(editorSource, /smart-prompt-inline-prefix-icon-slot/);
  assert.match(editorSource, /smart-prompt-inline-prefix-remove-icon/);
  assert.match(editorSource, /label\.className = 'smart-prompt-inline-prefix-label'/);
  assert.match(editorSource, /data-prefix-remove[\s\S]*?smart-prompt-prefix-remove/);
  assert.match(js, /smart-prompt-prefix-remove[\s\S]*?clearGenerationMode\(\)/);
  assert.match(editorSource, /window\.lucide\?\.createElement/);
  assert.doesNotMatch(editorSource, /smart-prompt-inline-prefix-description/);
  assert.match(css, /smart-prompt-inline-prefix-chip[^}]*height:18px/);
  assert.match(css, /smart-prompt-inline-prefix-icon,\.smart-prompt-inline-prefix-remove-icon[^}]*transition:opacity \.1s ease,transform \.12s/);
  assert.match(css, /smart-prompt-inline-prefix-chip:hover \.smart-prompt-inline-prefix-icon[^}]*opacity:0/);
  assert.match(css, /smart-prompt-inline-prefix-chip:hover \.smart-prompt-inline-prefix-remove-icon[^}]*opacity:1/);
  assert.match(css, /smart-prompt-inline-prefix-label[^}]*translateY\(1px\)/);
  assert.match(css, /smart-prompt-inline-prefix-remove-icon[^}]*stroke-width:3 !important/);
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

test('header popovers measure viewport space and flip only when they fully fit above', () => {
  const generationPosition = js.match(/function positionGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(generationPosition, /style\.visibility = 'hidden'/);
  assert.match(generationPosition, /getBoundingClientRect\(\)/);
  assert.match(generationPosition, /window\.innerHeight/);
  assert.match(generationPosition, /panelRect\.height > spaceBelow && panelRect\.height <= spaceAbove/);
  assert.match(generationPosition, /classList\.toggle\('open-upward', openUpward\)/);
  assert.doesNotMatch(generationPosition, /maxHeight|max-height/);
  assert.match(js, /function openGenerationModePanel\(anchorEl = generationModeControl\)[\s\S]*?positionGenerationModePanel\(anchorEl\)/);
  assert.match(css, /generation-mode-panel\.open-upward[^}]*top:auto[^}]*bottom:calc\(100% \+ 8px\)/);

  const mentionPosition = js.match(/function positionMentionPickerAtCaret\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(mentionPosition, /mentionAnchorEl[\s\S]*?pickerRect\.height > spaceBelow && pickerRect\.height <= spaceAbove/);
  assert.match(mentionPosition, /const gap = 8 \* safeScale/);
  assert.match(mentionPosition, /openUpward[\s\S]*?anchorRect\.top[\s\S]*?pickerHeight/);
  assert.match(mentionPosition, /pickerHeight - 8[\s\S]*?anchorRect\.bottom[\s\S]*?\+ 8/);
  assert.match(mentionPosition, /const top = openUpward \? rawTop : Math\.max\(2, rawTop\)/);
  assert.match(mentionPosition, /style\.top = `\$\{top\}px`/);
  assert.doesNotMatch(mentionPosition, /maxHeight|max-height/);
  assert.match(js, /mentionPicker\.style\.visibility = 'hidden';[\s\S]*?classList\.add\('open'\);[\s\S]*?positionMentionPickerAtCaret\(\);[\s\S]*?removeProperty\('visibility'\)/);
  const caretMentionPosition = mentionPosition.match(/const caretRect[\s\S]*$/)?.[0] || '';
  assert.match(caretMentionPosition, /const gap = 4 \* safeScale/);
  assert.match(caretMentionPosition, /pickerRect\.height > spaceBelow && pickerRect\.height <= spaceAbove/);
  assert.match(caretMentionPosition, /pickerHeight - 4[\s\S]*?anchorRect\.bottom[\s\S]*?\+ 4/);
  assert.match(caretMentionPosition, /const top = openUpward \? rawTop : Math\.max\(2, rawTop\)/);
});

test('inline mode capsule anchors the picker beside itself with the same complete-fit flip rule', () => {
  const generationPosition = js.match(/function positionGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(generationPosition, /anchorEl = generationModeControl/);
  assert.match(generationPosition, /const anchorRect = anchor\.getBoundingClientRect\(\)/);
  assert.match(generationPosition, /const inlineAnchor = anchor !== generationModeControl/);
  assert.match(generationPosition, /promptInput\?\.isConnected \? promptInput\.getBoundingClientRect\(\) : null/);
  assert.match(generationPosition, /style\.width = `\$\{promptRect\.width \/ safeScaleX\}px`/);
  assert.match(generationPosition, /const gap = \(inlineAnchor \? 4 : 8\) \* safeScaleY/);
  assert.match(generationPosition, /panelRect\.height > spaceBelow && panelRect\.height <= spaceAbove/);
  assert.match(generationPosition, /anchorRect\.top - gap - panelRect\.height[\s\S]*?anchorRect\.bottom \+ gap/);
  assert.match(generationPosition, /const viewportLeft = promptRect\?\.left \?\?/);
  assert.match(generationPosition, /anchorRect\.left - \(8 \* safeScaleX\)/);
  assert.match(generationPosition, /offsetParent[\s\S]*?safeScaleX[\s\S]*?safeScaleY/);
  assert.match(js, /\['left', 'right', 'top', 'bottom', 'width'\][\s\S]*?removeProperty/);
  assert.match(js, /smart-prompt-prefix-activate[\s\S]*?openGenerationModePanel\(promptInput\.querySelector\('\.smart-prompt-inline-prefix-chip'\)\)/);
});

test('generation-mode categories balance dynamically between independent columns', () => {
  const start = js.indexOf('function balanceGenerationModeGroups(');
  const end = js.indexOf('\nfunction generationModeGroupHtml(', start);
  assert.ok(start >= 0 && end > start);
  const source = js.slice(start, end);
  const balance = Function(`${source}; return balanceGenerationModeGroups;`)();
  const groups = [
    {name:'空间与机位', items:[1]},
    {name:'分镜叙事', items:[1, 2]},
    {name:'设定图', items:[1, 2, 3]},
    {name:'质感调节', items:[1, 2]},
  ];
  const columns = balance(groups);
  assert.deepEqual(columns.map(column => column.map(group => group.name)), [
    ['空间与机位', '设定图'],
    ['分镜叙事', '质感调节'],
  ]);
  assert.deepEqual(columns.map(column => column.reduce((sum, group) => sum + group.items.length, 0)), [4, 4]);
});

test('inline mode picker hides the boundary caret and restores the exact prompt selection after switching', () => {
  const open = js.match(/async function openGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  const close = js.match(/function closeGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  const select = js.match(/function selectGenerationMode\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(open, /inlineAnchor[\s\S]*?capturePromptSelection\(\)/);
  assert.match(open, /clearSelectionCaret\?\.\(\{keepNativeHidden:true\}\)/);
  assert.match(close, /scheduleSelectionCaretSync\?\.\(\)/);
  assert.match(select, /const promptSelection = generationModePromptSelection/);
  assert.match(select, /renderGenerationModeControl\(\);[\s\S]*?restorePromptSelection\(promptSelection\)/);
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
});

test('bottom parameter popovers stay locked until the pointer leaves the whole row', () => {
  assert.match(js, /ctrl\.onpointermove = event => \{[\s\S]*?dynamicParamHoverDisarmFrame \|\| dynamicParams\.classList\.contains\('hover-reentry-required'\)[\s\S]*?classList\.add\('hover-armed'\)/);
  assert.match(js, /dynamicParams\.addEventListener\('mouseleave',[\s\S]*?classList\.remove\('switching-smart-popovers', 'hover-reentry-required'\)/);
  assert.match(js, /function disarmDynamicParamHover\([\s\S]*?requestAnimationFrame[\s\S]*?dynamicParams\?\.classList\.toggle\('hover-reentry-required', dynamicParams\.matches\(':hover'\)\)/);
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
  assert.match(fn, /engine !== 'api' \|\| sourceSettings\.apiKind === 'video'/);
  assert.match(fn, /protocol[^\n]*venice/);
  assert.match(js, /clearUnsupportedGenerationMode\(activeComposerNode\(\) \|\| selectedNode\(\), settings\)/);
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
  assert.match(request, /generationModeSupported\(requestSettings\)/);
  assert.match(request, /compileGenerationModePrompt\(node, rawBody\)/);
  assert.match(request, /providerPrompts:\{api_image:body, venice_video:veniceBody \|\| body\}/);
  assert.doesNotMatch(html, /prompt_template/);
});
