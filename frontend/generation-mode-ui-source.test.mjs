import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../static/smart-canvas.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../static/css/smart-canvas.css', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('./smart-prompt-editor.js', import.meta.url), 'utf8');
const builtInCatalog = JSON.parse(readFileSync(new URL('../static/system-prompts/prompt-catalog.json', import.meta.url), 'utf8'));

test('Smart Canvas exposes generation mode as a bottom parameter control', () => {
  assert.match(html, /id="generationModeBtn"/);
  assert.match(html, /id="generationModePanel"/);
  assert.doesNotMatch(html, /id="generationModeBadge"/);
  assert.doesNotMatch(html, /id="composerTemplateBtn"/);
  assert.doesNotMatch(html, /composer-head-actions[\s\S]*id="generationModeControl"[\s\S]*id="promptAssistantBtn"/);
  assert.match(html, /id="dynamicParams"[\s\S]*id="generationModeControl"[\s\S]*data-lucide="blocks"[\s\S]*<span>模式<\/span>/);
  assert.match(html, /class="smart-control generation-mode-control"/);
  assert.match(html, /class="smart-pill generation-mode-btn"/);
  assert.doesNotMatch(html, /id="generationModeBtn"[^>]*title="生成模式"/);
  assert.match(html, /class="smart-popover generation-mode-panel"/);
  assert.match(css, /\.smart-pill\.generation-mode-btn\s*\{[^}]*width:auto[^}]*height:var\(--ctrl-height\)[^}]*color:var\(--muted\)[^}]*font-weight:500/);
  assert.match(css, /\.generation-mode-control:where\(:not\(\.popover-closing\)\) \.generation-mode-btn:hover,\.generation-mode-btn:focus-visible\s*\{[^}]*color:var\(--text\)[^}]*background:var\(--card\)[^}]*border-color:var\(--line\)/);
  assert.match(css, /\.smart-control\.generation-mode-control:where\(:not\(\.popover-closing\)\):hover \.generation-mode-btn:not\(\.active\),\.smart-control\.generation-mode-control:focus-within \.generation-mode-btn:not\(\.active\)\s*\{[^}]*color:var\(--text\)/);
  assert.match(css, /\.parameter-settings-pill > i,\.parameter-settings-pill > svg,\.generation-mode-btn:not\(\.active\) > i,\.generation-mode-btn:not\(\.active\) > svg\s*\{[^}]*color:var\(--text\)/);
  assert.match(css, /\.composer \.dynamic-params :is\(\.provider-control,\.model-control\):where\(:not\(\.popover-closing\)\):is\(:hover,:focus-within\) > \.smart-pill \.sub,[\s\S]*?\.parameter-settings-control:where\(:not\(\.popover-closing\)\):is\(:hover,:focus-within\) > \.smart-pill\s*\{ color:var\(--text\); \}/);
  assert.match(css, /\.composer \.dynamic-params :is\(\.provider-control,\.model-control\)\.pinned > \.smart-pill \.sub,[\s\S]*?\.generation-mode-control\.pinned > \.generation-mode-btn:not\(\.active\)\s*\{ color:var\(--text\); \}/);
  assert.doesNotMatch(css, /\.dynamic-params[^}]*\.pinned[^}]*font-weight:700/);
  assert.match(css, /\.generation-mode-control\s*\{[^}]*z-index:90/);
  assert.match(css, /\.smart-popover\.generation-mode-panel\s*\{[^}]*width:min\(500px[^}]*max-height:min\(620px/);
  assert.match(css, /\.smart-popover\.generation-mode-panel\s*\{[^}]*max-width:calc\(100vw - 40px\)/);
  assert.doesNotMatch(css, /\.smart-popover\.generation-mode-panel\s*\{[^}]*(?:right:|top:)/);
  assert.match(css, /\.smart-popover\.generation-mode-panel\s*\{[^}]*background:var\(--composer-popover-surface\)[^}]*border:1px solid var\(--composer-popover-border\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.mention-picker\s*\{[^}]*background:var\(--composer-popover-surface\)[^}]*border:1px solid var\(--composer-popover-border\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.mention-preview\s*\{[^}]*border:1px solid var\(--composer-popover-border\)[^}]*background:var\(--composer-popover-surface\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.mention-preview img,\.mention-preview video\s*\{[^}]*background:var\(--composer-popover-surface\)/);
  assert.match(css, /\.composer \.smart-popover\s*\{[^}]*background:var\(--composer-popover-surface\)[^}]*border-color:var\(--composer-popover-border\)[^}]*box-shadow:var\(--composer-popover-shadow\)/);
  assert.match(css, /\.theme-dark\s*\{[^}]*--composer-popover-surface:#1b2331[^}]*--composer-popover-shadow:0 28px 76px rgba\(0,0,0,\.52\)/);
  assert.match(css, /\.generation-mode-groups\s*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /\.generation-mode-column\s*\{[^}]*display:flex[^}]*flex-direction:column[^}]*gap:15px/);
  assert.match(css, /\.generation-mode-option\s*\{[^}]*height:48px/);
  assert.match(css, /\.generation-mode-option\s*\{[^}]*border:1px solid color-mix\(in srgb, var\(--text\) 18%, var\(--line\)\)/);
  assert.match(css, /\.generation-mode-option:hover,\.generation-mode-option:focus-visible\s*\{[^}]*border-color:var\(--strong\)[^}]*box-shadow:0 0 0 1px color-mix\(in srgb, var\(--strong\) 12%, transparent\)/);
  assert.doesNotMatch(css, /\.generation-mode-option:hover,\.generation-mode-option:focus-visible\s*\{[^}]*background:/);
  assert.match(css, /\.generation-mode-option\.active,\.generation-mode-option\.active:hover,\.generation-mode-option\.active:focus-visible,\.generation-mode-option\.active:active\s*\{[^}]*border-color:color-mix\(in srgb, var\(--connection-flow\) 76%, var\(--strong\)\)[^}]*box-shadow:0 0 0 1px color-mix\(in srgb, var\(--connection-flow\) 42%, transparent\)/);
  assert.match(css, /\.generation-mode-option-copy-track\s*\{[^}]*display:flex[^}]*flex-direction:column[^}]*gap:3px[^}]*translate3d\(0,-7px,0\)[^}]*transition:transform \.22s cubic-bezier\(\.22,1,\.36,1\)[^}]*will-change:transform/);
  assert.match(css, /\.generation-mode-option-title\s*\{[^}]*line-height:14px[^}]*font-weight:400/);
  assert.doesNotMatch(css, /\.generation-mode-option-title\s*\{[^}]*transition:/);
  assert.match(css, /\.generation-mode-option-copy small\s*\{[^}]*line-height:12px[^}]*opacity:0[^}]*transition:opacity \.22s cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(css, /\.generation-mode-option:hover \.generation-mode-option-copy-track[^}]*translate3d\(0,-13px,0\)/);
  assert.match(css, /\.generation-mode-option:hover \.generation-mode-option-title[^}]*font-weight:700/);
  assert.match(css, /\.generation-mode-option:hover \.generation-mode-option-copy small[^}]*opacity:1/);
  assert.match(css, /\.generation-mode-option\.active \.generation-mode-option-copy small[^}]*opacity:1/);
  assert.match(css, /\.generation-mode-option\s*\{[^}]*padding:6px 7px/);
  assert.match(css, /\.smart-popover \.generation-mode-option-icon i,\.smart-popover \.generation-mode-option-icon svg\s*\{[^}]*width:17px !important[^}]*height:17px !important/);
  assert.doesNotMatch(css, /generation-mode-check/);
  assert.doesNotMatch(js, /generation-mode-check/);
  assert.match(js, /generation-mode-option-copy-track/);
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

test('mention picker stays dismissed after Escape until the caret context changes', () => {
  const maybeOpen = js.match(/function maybeOpenMentionPicker\(\)[\s\S]*?\n\}/)?.[0] || '';
  const keydown = js.match(/function handleMentionPickerKeydown\(event\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(js, /let mentionDismissedCaretText = null/);
  assert.match(keydown, /event\.key === 'Escape'[\s\S]*?mentionDismissedCaretText = textBeforeCaret\(\)[\s\S]*?closeMentionPicker\(\)/);
  assert.match(maybeOpen, /mentionDismissedCaretText !== null && before === mentionDismissedCaretText\) return/);
  assert.match(maybeOpen, /mentionDismissedCaretText = null[\s\S]*?\/@\$\/\.test\(before\)/);
  assert.match(js, /document\.addEventListener\('pointerdown', event => \{[\s\S]*?mentionPicker\?\.classList\?\.contains\('open'\)[\s\S]*?event\.target\.closest\?\.\('\.mention-picker'\)[\s\S]*?event\.target\.closest\?\.\('\.app-select-menu'\)[\s\S]*?mentionPicker\.querySelector\('\.app-select-shell\.is-open'\)[\s\S]*?mentionInsertMode === 'manual-ref'[\s\S]*?closeMentionPicker\(\);[\s\S]*?\}, true\);/);
  assert.doesNotMatch(js, /!event\.target\.closest\('\.mention-picker'\) && !event\.target\.closest\('#promptInput'\)/);
});

test('mention media focus matches the asset manager single-border selection style', () => {
  assert.match(css, /\.mention-option:hover:not\(\.focused\)\s*\{[^}]*border-color:color-mix\(in srgb, var\(--text\) 24%, var\(--line\)\)/);
  assert.match(css, /\.mention-option\.focused\s*\{[^}]*border-color:rgba\(15,23,42,\.76\)[^}]*box-shadow:0 6px 14px var\(--shadow\)/);
  assert.match(css, /\.theme-dark \.mention-option\.focused\s*\{[^}]*border-color:rgba\(248,250,252,\.86\)[^}]*box-shadow:0 6px 14px var\(--shadow\)/);
  assert.doesNotMatch(css, /\.mention-option\.focused\s*\{[^}]*box-shadow:0 0 0 2px/);
});

test('mention capsule preview waits for displayable media before showing and then applies complete-fit flipping', () => {
  const positionPreview = js.match(/function positionMentionPreview\(token\)[\s\S]*?\n\}/)?.[0] || '';
  const showPreview = js.match(/function showMentionPreviewForToken\(token\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(positionPreview, /getBoundingClientRect\(\)/);
  assert.match(positionPreview, /window\.innerHeight/);
  assert.match(positionPreview, /token\.offsetHeight[\s\S]*?const gap = 4 \* safeScale/);
  assert.match(positionPreview, /previewHeight > spaceBelow && previewHeight <= spaceAbove/);
  assert.match(positionPreview, /anchorRect\.top - gap - previewHeight[\s\S]*?anchorRect\.bottom \+ gap/);
  assert.match(positionPreview, /window\.innerWidth - edgeMargin - previewWidth/);
  assert.match(positionPreview, /classList\.toggle\('open-upward', openUpward\)/);
  assert.match(showPreview, /mentionPreview\.style\.display = 'none'[\s\S]*?mentionPreviewToken = token/);
  assert.match(showPreview, /if\(mentionPreviewToken !== token\) return[\s\S]*?mentionPreview\.style\.display = 'block'[\s\S]*?positionMentionPreview\(token\)/);
  assert.match(showPreview, /media\.onloadeddata = reveal/);
  assert.match(showPreview, /media\.onload = reveal/);
  assert.match(showPreview, /media\.onerror = fail/);
  assert.match(showPreview, /media\.readyState >= 2/);
  assert.match(showPreview, /media\.complete && media\.naturalWidth > 0/);
});

test('open generation-mode picker suppresses pending and new media capsule previews', () => {
  const openMode = js.match(/async function openGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  const showPreview = js.match(/function showMentionPreviewForToken\(token\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(openMode, /hideMentionPreview\(\)[\s\S]*?inlineAnchor/);
  assert.match(showPreview, /generationModePanel\?\.classList\.contains\('open'\)[\s\S]*?hideMentionPreview\(\)/);
});

test('mode picker opens after a complete click without keyboard-selection state', () => {
  const pointerHandler = editorSource.match(/root\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointerHandler, /preventDefault\(\)/);
  assert.doesNotMatch(pointerHandler, /smart-prompt-prefix-activate/);
  assert.match(editorSource, /root\.addEventListener\('click',[\s\S]*?smart-prompt-prefix-activate/);
  assert.doesNotMatch(js, /generationModeFocusIndex|handleGenerationModeKeydown|setGenerationModeFocusIndex/);
  assert.doesNotMatch(css, /generation-mode-option\.focused/);
});

test('inline generation and mention popovers flip only when they fully fit above', () => {
  const generationPosition = js.match(/function positionGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(generationPosition, /classList\.remove\('open'\)/);
  assert.doesNotMatch(generationPosition, /style\.visibility = 'hidden'/);
  assert.match(generationPosition, /getBoundingClientRect\(\)/);
  assert.match(generationPosition, /window\.innerHeight/);
  assert.match(generationPosition, /panelRect\.height > spaceBelow && panelRect\.height <= spaceAbove/);
  assert.doesNotMatch(generationPosition, /maxHeight|max-height/);
  assert.match(js, /function openGenerationModePanel\(anchorEl = generationModeControl\)[\s\S]*?positionGenerationModePanel\(anchorEl\)/);

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
  const generationClose = js.match(/function closeGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  const generationReset = js.match(/function resetGenerationModePanelAnchor\([\s\S]*?\n\}/)?.[0] || '';
  const panelPointerHandler = js.match(/generationModePanel\?\.addEventListener\('pointerdown',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(panelPointerHandler, /generationModePromptSelection[^\n]*event\.button === 0[^\n]*event\.preventDefault\(\)/);
  assert.match(panelPointerHandler, /event\.stopPropagation\(\)/);
  assert.match(generationPosition, /anchorEl = generationModeControl/);
  assert.match(generationPosition, /const anchorRect = anchor\.getBoundingClientRect\(\)/);
  assert.match(generationPosition, /const inlineAnchor = anchor !== generationModeControl/);
  assert.match(generationPosition, /classList\.remove\('open'\)[\s\S]*?classList\.add\('positioning-inline-anchor'\)[\s\S]*?classList\.toggle\('inline-anchor', inlineAnchor\)[\s\S]*?void generationModePanel\.offsetWidth;[\s\S]*?classList\.remove\('positioning-inline-anchor'\)[\s\S]*?void generationModePanel\.offsetWidth;[\s\S]*?classList\.add\('open'\)/);
  assert.doesNotMatch(generationPosition, /style\.transform = 'none'/);
  assert.match(generationPosition, /promptInput\?\.isConnected \? promptInput\.getBoundingClientRect\(\) : null/);
  assert.match(generationPosition, /style\.width = `\$\{promptRect\.width \/ safeScaleX\}px`/);
  assert.match(generationPosition, /const gap = \(inlineAnchor \? 4 : 8\) \* safeScaleY/);
  assert.match(generationPosition, /panelRect\.height > spaceBelow && panelRect\.height <= spaceAbove/);
  assert.match(generationPosition, /anchorRect\.top - gap - panelRect\.height[\s\S]*?anchorRect\.bottom \+ gap/);
  assert.match(generationPosition, /const viewportLeft = promptRect\?\.left \?\?/);
  assert.match(generationPosition, /anchorRect\.left - \(8 \* safeScaleX\)/);
  assert.match(generationPosition, /offsetParent[\s\S]*?safeScaleX[\s\S]*?safeScaleY/);
  assert.match(js, /\['left', 'right', 'top', 'bottom', 'width', 'transform'\][\s\S]*?removeProperty/);
  assert.match(js, /smart-prompt-prefix-activate[\s\S]*?openGenerationModePanel\(promptInput\.querySelector\('\.smart-prompt-inline-prefix-chip'\)\)/);
  assert.match(generationClose, /classList\.remove\('open'\)/);
  assert.doesNotMatch(generationClose, /removeProperty|resetGenerationModePanelAnchor|scheduleGenerationModeAnchorCleanup/);
  assert.match(generationReset, /classList\.add\('positioning-inline-anchor'\)[\s\S]*?classList\.remove\('inline-anchor', 'open-upward', 'viewport-position-locked'\)[\s\S]*?removeProperty[\s\S]*?void generationModePanel\.offsetWidth;[\s\S]*?classList\.remove\('positioning-inline-anchor'\)[\s\S]*?void generationModePanel\.offsetWidth/);
  assert.doesNotMatch(js, /generationModeAnchorCleanupTimer|scheduleGenerationModeAnchorCleanup/);
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
  assert.match(js, /balanceGenerationModeGroups\(categories\)\.reverse\(\)\.map/);
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

test('all prompt caret overlays stay below composer popovers', () => {
  assert.match(editorSource, /prompt-selection-caret prompt-caret-overlay/);
  assert.match(editorSource, /prompt-reference-drop-caret prompt-caret-overlay/);
  assert.match(css, /\.prompt-caret-overlay\s*\{[^}]*z-index:3/);
  assert.doesNotMatch(css, /\.prompt-(?:selection|reference-drop)-caret\s*\{[^}]*z-index:\s*(?:9998|10000)/);
  assert.match(css, /\.smart-prompt-editor-content\s*\{[^}]*z-index:2/);
  assert.match(css, /\.smart-popover\s*\{[^}]*z-index:50/);
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
  assert.match(css, /generation-mode-btn\.active\s*\{[^}]*color:color-mix\(in srgb, var\(--connection-flow\) 76%, var\(--text\)\)[^}]*border-color:color-mix\(in srgb, var\(--connection-flow\) 36%, var\(--line\)\)[^}]*box-shadow:0 0 0 1px color-mix\(in srgb, var\(--connection-flow\) 24%, transparent\)/);
  assert.match(css, /smart-control\.generation-mode-control:where\(:not\(\.popover-closing\)\):hover \.generation-mode-btn\.active,\.smart-control\.generation-mode-control:focus-within \.generation-mode-btn\.active\s*\{[^}]*border-color:color-mix\(in srgb, var\(--connection-flow\) 36%, var\(--line\)\)[^}]*box-shadow:0 0 0 1px color-mix\(in srgb, var\(--connection-flow\) 24%, transparent\)/);
  assert.match(css, /smart-control\.generation-mode-control\.pinned \.generation-mode-btn\.active\s*\{[^}]*border-color:color-mix\(in srgb, var\(--connection-flow\) 62%, var\(--line\)\)[^}]*box-shadow:0 0 0 2px color-mix\(in srgb, var\(--connection-flow\) 34%, transparent\)/);
  assert.match(css, /generation-mode-option\.active[^}]*var\(--connection-flow\)/);
});

test('generation-mode clear label is optically raised without moving its button', () => {
  assert.match(js, /data-generation-mode-clear><span class="generation-mode-clear-label">清除<\/span><\/button>/);
  assert.match(css, /\.generation-mode-panel-head > span\s*\{/);
  assert.match(css, /\.generation-mode-clear-label\s*\{[^}]*display:inline-block[^}]*translateY\(-1px\)/);
  assert.doesNotMatch(css, /\.generation-mode-panel-head button\s*\{[^}]*transform:/);
});

test('bottom parameter popovers stay locked until the pointer leaves the whole row', () => {
  assert.match(js, /ctrl\.onpointermove = event => \{[\s\S]*?dynamicParamHoverDisarmFrame \|\| dynamicParams\.classList\.contains\('hover-reentry-required'\)[\s\S]*?classList\.add\('hover-armed'\)/);
  assert.match(js, /function promptAnchoredPopoverOwnsComposer\(\)[\s\S]*?generationModeUsesInlineAnchor\(\)[\s\S]*?mentionInsertMode !== 'manual-ref'/);
  assert.match(js, /function dynamicParamHoverBlocked\(ctrl\)[\s\S]*?promptAnchoredPopoverOwnsComposer\(\)[\s\S]*?pinned && pinned !== ctrl/);
  assert.match(js, /ctrl\.onpointermove = event => \{[\s\S]*?dynamicParamHoverBlocked\(ctrl\)\) return[\s\S]*?classList\.add\('hover-armed'\)/);
  assert.match(js, /function generationModeUsesInlineAnchor\(\)[\s\S]*?classList\.contains\('inline-anchor'\)[\s\S]*?classList\.contains\('open'\)/);
  assert.match(js, /dynamicParams\.addEventListener\('mouseleave',[\s\S]*?classList\.remove\('switching-smart-popovers', 'hover-reentry-required'\)/);
  assert.match(js, /function disarmDynamicParamHover\([\s\S]*?requestAnimationFrame[\s\S]*?dynamicParams\?\.classList\.toggle\('hover-reentry-required', dynamicParams\.matches\(':hover'\)\)/);
  assert.match(js, /function closeGenerationModePanel\([^)]*\)[\s\S]*?if\(disarm\) disarmDynamicParamHover\(\)/);
  assert.match(css, /dynamic-params \.smart-control:not\(\.hover-armed\)[^}]*hover \.smart-popover[^}]*visibility:hidden/);
  assert.match(js, /dynamicParams\.appendChild\(generationModeControl\)/);
  assert.match(js, /ctrl\.classList\.contains\('generation-mode-control'\)[^\n]*syncGenerationModeOpenState\(ctrl\)/);
  const bottomModeSync = js.match(/function syncGenerationModeOpenState\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(bottomModeSync, /if\(generationModeUsesInlineAnchor\(\)\) return/);
  assert.match(bottomModeSync, /generationModeShouldBeOpen[\s\S]*?if\(!generationModePanel\?\.classList\.contains\('open'\) \|\| inlineAnchor\)[\s\S]*?renderGenerationModePanel\(\)[\s\S]*?classList\.add\('open'\)/);
  assert.match(bottomModeSync, /const lockedBottomAnchor[\s\S]*?getComputedStyle\(generationModePanel\)\.opacity[\s\S]*?!\(opacity > 0\) && \(inlineAnchor \|\| lockedBottomAnchor\)[\s\S]*?resetGenerationModePanelAnchor\(\)/);
  assert.doesNotMatch(bottomModeSync, /if\(inlineAnchor\) closeGenerationModePanel/);
  assert.doesNotMatch(bottomModeSync, /positionGenerationModePanel/);
  assert.match(css, /\.smart-popover\s*\{[^}]*left:50%[^}]*bottom:calc\(100% \+ 8px\)[^}]*translate\(-50%, 4px\)/);
  assert.match(css, /generation-mode-panel\.inline-anchor\s*\{[^}]*opacity:0[^}]*visibility:hidden[^}]*pointer-events:none[^}]*transform:translateY\(4px\)[^}]*transition:opacity \.14s ease, transform \.14s ease, visibility \.14s ease/);
  assert.match(css, /generation-mode-panel\.inline-anchor\.open\s*\{[^}]*opacity:1[^}]*visibility:visible[^}]*pointer-events:auto[^}]*transform:translateY\(0\)/);
  assert.match(css, /generation-mode-panel\.positioning-inline-anchor\s*\{[^}]*transition:none !important/);
  assert.match(css, /smart-popover:not\(\.inline-anchor\)[^}]*visibility:hidden/);
  assert.match(css, /\.composer \.dynamic-params \.smart-control > \.smart-pill\s*\{[^}]*position:relative[^}]*z-index:51/);
  assert.match(css, /\.composer \.dynamic-params \.generation-mode-control > \.generation-mode-btn\s*\{[^}]*z-index:101/);
  assert.match(css, /\.composer \.dynamic-params \.provider-control:not\(\.pinned\)::before\s*\{[^}]*left:-8px[^}]*right:-6px[^}]*bottom:-4px[^}]*height:calc\(100% \+ 16px\)/);
  assert.match(css, /\.composer \.dynamic-params \.generation-mode-control:not\(\.pinned\)::before\s*\{[^}]*left:-6px[^}]*right:-22px[^}]*bottom:-4px[^}]*height:calc\(100% \+ 16px\)/);
  assert.match(js, /ctrl\.onmouseleave = \(\) => \{[\s\S]*?ctrl === generationModeControl && generationModeUsesInlineAnchor\(\)[\s\S]*?beginSmartPopoverClose\(ctrl\)/);
});

test('a pointer re-entering during popover fade-out cannot cancel the close', () => {
  const beginClose = js.match(/function beginSmartPopoverClose\(ctrl\)[\s\S]*?\n\}/)?.[0] || '';
  const releaseClose = js.match(/function releaseSmartPopoverClose\(ctrl\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(beginClose, /getComputedStyle\(popover\)\.opacity[\s\S]*?classList\.add\('popover-closing'\)[\s\S]*?classList\.remove\('hover-armed'\)/);
  assert.match(beginClose, /setTimeout[\s\S]*?ctrl\.matches\(':hover'\)[\s\S]*?_smartPopoverCloseAwaitingLeave = true[\s\S]*?releaseSmartPopoverClose\(ctrl\)/);
  assert.match(releaseClose, /clearTimeout[\s\S]*?classList\.remove\('popover-closing'\)/);
  assert.match(js, /function dynamicParamHoverBlocked\(ctrl\)\{[\s\S]*?classList\?\.contains\('popover-closing'\)/);
  assert.match(js, /ctrl\.onmouseleave = \(\) => \{[\s\S]*?_smartPopoverCloseAwaitingLeave[\s\S]*?!ctrl\.classList\.contains\('pinned'\)[\s\S]*?generationModeUsesInlineAnchor\(\)[\s\S]*?beginSmartPopoverClose\(ctrl\)/);
  assert.match(js, /pill\.onclick = event => \{[\s\S]*?closeAllSmartPopovers\(\)[\s\S]*?if\(!wasPinned\)\{[\s\S]*?releaseSmartPopoverClose\(ctrl\)[\s\S]*?classList\.add\('pinned'\)/);
  assert.match(js, /closeAllSmartPopovers\(\);[\s\S]*?if\(!wasPinned\)\{[\s\S]*?releaseSmartPopoverClose\(engineSelect\)[\s\S]*?engineSelect\.classList\.add\('pinned'\)/);
  assert.match(js, /engineSelect\.addEventListener\('mouseleave',[\s\S]*?beginSmartPopoverClose\(engineSelect\)/);
  assert.match(css, /\.smart-control\.popover-closing \.smart-popover\s*\{[^}]*opacity:0 !important[^}]*visibility:hidden !important[^}]*pointer-events:none !important/);
  assert.match(css, /\.smart-control:where\(:not\(\.popover-closing\)\):hover \.smart-pill\s*\{[^}]*background:var\(--card\)[^}]*border-color:var\(--line\)/);
  assert.doesNotMatch(css, /\.smart-control:not\(\.popover-closing\):hover \.smart-pill/);
});

test('image and video settings measure the same resting position on fresh hover and in-row return', () => {
  const capture = js.match(/function captureParameterSettingsPopoverPosition\(ctrl\)[\s\S]*?\n\}/)?.[0] || '';
  const restore = js.match(/function restoreOpenParameterSettingsControl\(ctrl, position=null\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(capture, /querySelector\?\.\('\.parameter-settings-popover'\)/);
  assert.match(capture, /const inlineTransition = popover\.style\.transition[\s\S]*?popover\.style\.transition = 'none'[\s\S]*?popover\.style\.translate = 'none'[\s\S]*?getBoundingClientRect\(\)/);
  assert.match(capture, /removeProperty\('translate'\)[\s\S]*?void popover\.offsetWidth[\s\S]*?inlineTransition[\s\S]*?removeProperty\('transition'\)/);
  assert.match(restore, /popover\.style\.transition = 'none'[\s\S]*?openParameterSettingsControl\(ctrl, position\)[\s\S]*?void popover\.offsetWidth[\s\S]*?removeProperty\('transition'\)/);
  assert.match(js, /if\(state\.isOpen && match\.classList\.contains\('parameter-settings-control'\)\)\{[\s\S]*?restoreOpenParameterSettingsControl\(match, state\.popoverPosition\)/);
  assert.match(css, /\.smart-popover\.image-settings-popover\s*\{[^}]*bottom:calc\(100% \+ 8px\)[^}]*translate:0 4px[^}]*transition:opacity \.14s ease, translate \.14s ease/);
  assert.match(css, /\.smart-popover\.video-settings-popover\s*\{[^}]*bottom:calc\(100% \+ 8px\)[^}]*translate:0 4px[^}]*transition:opacity \.14s ease, translate \.14s ease/);
  assert.doesNotMatch(css, /\.composer \.dynamic-params \.provider-control > \.smart-pill\s*\{[^}]*z-index:1/);
});

test('prompt-anchored pickers lock bottom hover and inline mode takes ownership from a pinned button', () => {
  const showMention = js.match(/function showMentionPicker\(\)[\s\S]*?\n\}/)?.[0] || '';
  const prefixActivate = js.match(/smart-prompt-prefix-activate[\s\S]*?\n\}\);/)?.[0] || '';
  const openMode = js.match(/async function openGenerationModePanel\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(showMention, /closeAllSmartPopovers\(\)[\s\S]*?mentionInsertMode = 'token'/);
  assert.match(prefixActivate, /generationModeUsesInlineAnchor\(\)[\s\S]*?closeGenerationModePanel\(\)[\s\S]*?return/);
  assert.match(prefixActivate, /const previousPinned = pinnedDynamicParamControl\(\)[\s\S]*?instant-popover-switch[\s\S]*?closeAllSmartPopovers\(\{instantControl:previousPinned\}\)[\s\S]*?openGenerationModePanel\(promptInput\.querySelector\('\.smart-prompt-inline-prefix-chip'\)\)/);
  assert.match(openMode, /generationModeInlineAnchorPending = inlineAnchor[\s\S]*?await loadGenerationPromptCatalog\(\)[\s\S]*?requestId !== generationModeOpenRequestId[\s\S]*?generationModeInlineAnchorPending = false/);
  assert.match(js, /function closeGenerationModePanel\([\s\S]*?generationModeOpenRequestId \+= 1[\s\S]*?generationModeInlineAnchorPending = false/);
  assert.match(js, /function generationModeUsesInlineAnchor\(\)[\s\S]*?generationModeInlineAnchorPending/);
  assert.match(js, /function pinnedDynamicParamControl\(\)[\s\S]*?\.smart-control\.pinned/);
  assert.match(js, /const previousPinned = pinnedDynamicParamControl\(\)[\s\S]*?const wasPinned = previousPinned === ctrl[\s\S]*?const switchingControls = Boolean\(previousPinned && !wasPinned\)[\s\S]*?closeAllSmartPopovers\(\)[\s\S]*?if\(!wasPinned\)[\s\S]*?ctrl\.classList\.add\('pinned'\)/);
  assert.match(js, /document\.addEventListener\('click', event => \{[\s\S]*?!event\.target\.closest\('\.smart-control'\)\) closeAllSmartPopovers\(\)/);
  assert.match(css, /\.mention-picker\s*\{[^}]*z-index:130/);
  assert.match(css, /\.composer-card > \.mention-picker\s*\{[^}]*z-index:130/);
});

test('the open generation mode panel transfers between capsule and bottom anchors without reopening', () => {
  const transfer = js.match(/function transferOpenGenerationModePanel\(anchorEl\)[\s\S]*?\n\}/)?.[0] || '';
  const position = js.match(/function positionGenerationModePanel\(anchorEl[\s\S]*?\n\}/)?.[0] || '';
  const prefixActivate = js.match(/smart-prompt-prefix-activate[\s\S]*?\n\}\);/)?.[0] || '';
  const pillBinding = js.match(/dynamicParams\.querySelectorAll\('\.smart-control > \.smart-pill'\)[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(transfer, /generationModePanel\?\.classList\.contains\('open'\)/);
  assert.match(transfer, /generationModeInlineAnchorPending = true[\s\S]*?classList\.remove\('pinned', 'interacting'\)[\s\S]*?positionGenerationModePanel\(anchorEl, \{preserveOpen:true\}\)[\s\S]*?generationModeInlineAnchorPending = false/);
  assert.doesNotMatch(transfer, /closeGenerationModePanel|loadGenerationPromptCatalog|renderGenerationModePanel/);
  assert.match(position, /\{preserveOpen=false\}=\{\}[\s\S]*?if\(!preserveOpen\) generationModePanel\.classList\.remove\('open'\)[\s\S]*?if\(!preserveOpen\) generationModePanel\.classList\.add\('open'\)/);
  assert.match(position, /if\(promptRect && !composerExpanded\) generationModePanel\.style\.width = `\$\{promptRect\.width \/ safeScaleX\}px`/);
  assert.match(position, /const viewportLeft = promptRect\?\.left/);
  assert.match(pillBinding, /transfersInlineModePanel[\s\S]*?transferOpenGenerationModePanel\(generationModeControl\)[\s\S]*?return/);
  assert.match(prefixActivate, /classList\.contains\('open'\) && !generationModePanel\.classList\.contains\('inline-anchor'\)[\s\S]*?transferOpenGenerationModePanel\(promptInput\.querySelector\('\.smart-prompt-inline-prefix-chip'\)\)[\s\S]*?return/);
});

test('a clicked generation mode panel keeps its viewport position while recommendations relayout the parameter row', () => {
  const capture = js.match(/function captureGenerationModePanelViewportPosition\(\)[\s\S]*?\n\}/)?.[0] || '';
  const restore = js.match(/function restoreGenerationModePanelViewportPosition\(position\)[\s\S]*?\n\}/)?.[0] || '';
  const selection = js.match(/function selectGenerationMode\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(capture, /!generationModePanel\?\.classList\.contains\('open'\)[\s\S]*?generationModePanel\.classList\.contains\('inline-anchor'\)[\s\S]*?getBoundingClientRect\(\)[\s\S]*?left:rect\.left, top:rect\.top/);
  assert.match(restore, /offsetParent[\s\S]*?safeScaleX[\s\S]*?safeScaleY[\s\S]*?instant-popover-switch[\s\S]*?style\.left[\s\S]*?style\.top[\s\S]*?style\.transform = 'none'/);
  assert.match(restore, /const restoredRect = generationModePanel\.getBoundingClientRect\(\)[\s\S]*?position\.left - restoredRect\.left[\s\S]*?position\.top - restoredRect\.top/);
  assert.match(restore, /style\.transform = 'none'[\s\S]*?classList\.add\('viewport-position-locked'\)/);
  assert.match(selection, /const keepPinnedPanelOpen = Boolean\([\s\S]*?classList\.contains\('pinned'\)[\s\S]*?classList\.contains\('open'\)[\s\S]*?!generationModePanel\.classList\.contains\('inline-anchor'\)/);
  assert.match(selection, /captureGenerationModePanelViewportPosition\(\)[\s\S]*?if\(!keepPinnedPanelOpen\) closeGenerationModePanel\(\)[\s\S]*?renderDynamicParams\(\)[\s\S]*?restoreGenerationModePanelViewportPosition\(panelViewportPosition\)/);

  const parentState = {left:410, top:700, scale:1.25};
  const offsetParent = {
    offsetWidth:80,
    offsetHeight:24,
    getBoundingClientRect:() => ({left:parentState.left, top:parentState.top, width:100, height:30}),
  };
  const classNames = new Set();
  const panel = {
    offsetParent,
    offsetWidth:500,
    style:{},
    classList:{
      contains:name => classNames.has(name),
      add:name => classNames.add(name),
      remove:name => classNames.delete(name),
    },
    getBoundingClientRect(){
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      // Simulate a one-CSS-pixel offset-parent origin bias. Reusing an
      // uncorrected result as the next snapshot would drift right each time.
      return {
        left:parentState.left + ((left + 1) * parentState.scale),
        top:parentState.top + ((top + 1) * parentState.scale),
      };
    },
  };
  const restorePosition = Function('generationModePanel', 'generationModeControl', `${restore}; return restoreGenerationModePanelViewportPosition;`)(panel, offsetParent);
  let snapshot = {left:250, top:180};
  for(const left of [410, 388, 437, 401, 452]){
    parentState.left = left;
    restorePosition(snapshot);
    const rect = panel.getBoundingClientRect();
    assert.ok(Math.abs(rect.left - 250) < 1e-9);
    assert.ok(Math.abs(rect.top - 180) < 1e-9);
    snapshot = {left:rect.left, top:rect.top};
  }
});

test('click switching skips both animations while first open and final close stay animated', () => {
  const closeAll = js.match(/function closeAllSmartPopovers\([\s\S]*?\n\}/)?.[0] || '';
  const pillBinding = js.match(/dynamicParams\.querySelectorAll\('\.smart-control > \.smart-pill'\)[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(closeAll, /\{instantControl=null\}=\{\}/);
  assert.match(closeAll, /outgoingControl\?\.classList\.add\('instant-popover-close'\)[\s\S]*?closeGenerationModePanel\(\{disarm:false\}\)[\s\S]*?void outgoingControl\.offsetWidth[\s\S]*?classList\.remove\('instant-popover-close'\)/);
  assert.match(css, /\.smart-control\.instant-popover-close \.smart-popover\s*\{[^}]*transition:none !important/);
  assert.match(css, /\.dynamic-params\.click-switching-smart-popovers \.smart-popover,\.generation-mode-panel\.instant-popover-switch\s*\{[^}]*transition:none !important/);
  assert.match(pillBinding, /pill\.onmousedown = event => \{[\s\S]*?event\.button === 0[\s\S]*?event\.preventDefault\(\)/);
  assert.match(pillBinding, /const wasPinned = previousPinned === ctrl[\s\S]*?const switchingControls = Boolean\(previousPinned && !wasPinned\)[\s\S]*?previousPinned\?\.contains\(focused\)[\s\S]*?focused\.blur\(\)/);
  assert.match(pillBinding, /if\(switchingControls\) dynamicParams\.classList\.add\('click-switching-smart-popovers'\)[\s\S]*?closeAllSmartPopovers\(\)[\s\S]*?if\(!wasPinned\)[\s\S]*?classList\.add\('pinned'\)[\s\S]*?void dynamicParams\.offsetWidth[\s\S]*?classList\.remove\('click-switching-smart-popovers'\)/);
  assert.match(js, /smart-prompt-prefix-activate[\s\S]*?instant-popover-switch[\s\S]*?opening\.then\(finishSwitch, finishSwitch\)/);
});

test('image and video parameter summary pills omit redundant carets', () => {
  const imageControl = js.match(/function renderImageSettingsControl\(\)[\s\S]*?\n\}/)?.[0] || '';
  const videoControl = js.match(/function renderVideoSettingsControl\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(imageControl, /pill-caret/);
  assert.doesNotMatch(videoControl, /pill-caret/);
  assert.match(css, /\.smart-pill\.parameter-settings-pill\s*\{[^}]*color:var\(--muted\)/);
  assert.match(css, /\.image-settings-pill \.image-settings-summary\s*\{[^}]*color:inherit[^}]*font-weight:500/);
  assert.match(css, /\.video-settings-pill \.video-settings-summary\s*\{[^}]*color:inherit[^}]*font-weight:500/);
});

test('clearing a generation mode only closes hover-opened or inline panels', () => {
  const clearMode = js.match(/function clearGenerationMode\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(clearMode, /keepPinnedPanelOpen[\s\S]*?classList\.contains\('pinned'\)[\s\S]*?!generationModePanel\?\.classList\.contains\('inline-anchor'\)/);
  assert.match(clearMode, /if\(!keepPinnedPanelOpen\)\{[\s\S]*?generationModePanel\?\.contains\(focused\)[\s\S]*?focused\?\.blur/);
  assert.match(clearMode, /if\(!keepPinnedPanelOpen\)\{[\s\S]*?classList\.remove\('pinned', 'interacting', 'hover-armed'\)[\s\S]*?classList\.add\('hover-dismissed'\)[\s\S]*?closeGenerationModePanel\(\)/);
  assert.match(clearMode, /closeGenerationModePanel\(\)[\s\S]*?renderDynamicParams\(\);[\s\S]*?renderGenerationModeControl\(\)/);
  assert.match(js, /function generationModeShouldBeOpen\([\s\S]*?!ctrl\.classList\.contains\('hover-dismissed'\)/);
  assert.match(js, /ctrl\.onmouseleave = \(\) => \{[\s\S]*?classList\.remove\('interacting', 'hover-armed', 'hover-dismissed'\)/);
  assert.match(css, /\.smart-control\.generation-mode-control\.hover-dismissed \.generation-mode-btn:not\(\.active\)\s*\{[^}]*background:transparent[^}]*border-color:transparent[^}]*box-shadow:none/);
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
