import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const smartCanvasSource = fs.readFileSync(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const apiSettingsSource = fs.readFileSync(new URL('../static/js/api-settings.js', import.meta.url), 'utf8');

test('Smart Canvas submits structured size intent beside the legacy pixel size', () => {
    assert.match(smartCanvasSource, /function imageSizeSpecForRun\(/);
    assert.match(smartCanvasSource, /mode:'auto_aspect', resolution/);
    assert.match(smartCanvasSource, /size_spec:imageSizeSpecForRun\(requestSettings\)/);
    assert.match(smartCanvasSource, /quality:imageQualityForRequest\(requestSettings\)/);
});

test('Smart Canvas image settings use the compact image-only option set', () => {
    assert.match(smartCanvasSource, /function renderImageSettingsControl\(/);
    assert.match(smartCanvasSource, /\['low','medium','high'\]\.map/);
    assert.match(smartCanvasSource, /\['1k','2k','4k'\]\.map/);
    assert.match(smartCanvasSource, /\[1,2,4\]\.map/);
    assert.match(smartCanvasSource, /\['auto',tr\('smart\.imageAspectAuto'\)\]/);
    assert.match(smartCanvasSource, /renderImageSettingsControl\(\)/);
    assert.match(smartCanvasSource, /setDynamicSetting\(key, value, \{render:false\}\)/);
    assert.match(smartCanvasSource, /syncImageSettingsSelection\(ctrl\)/);
});

test('Smart Canvas no longer derives or renders a source-ratio option', () => {
    assert.doesNotMatch(smartCanvasSource, /sourceImageRatioLabel|sourceRatioImageForNode|applySourceRatioToSettings/);
    assert.doesNotMatch(smartCanvasSource, /\[\s*['"]source['"]\s*,/);
});

test('pixel-size models allow auto only when an image reference will be submitted', () => {
    assert.match(smartCanvasSource, /const autoDisabled = caps\.sizeMode === 'pixel' && !hasReferenceImage/);
    assert.match(smartCanvasSource, /hasReferenceImage:imageRefsOnly\(refs\)\.length > 0/);
    assert.match(smartCanvasSource, /syncImageSettingsPanelForRefs\(\)/);
});

test('API settings saves and exposes editable per-model capabilities', () => {
    assert.match(apiSettingsSource, /image_capabilities:\(item\.image_capabilities/);
    assert.match(apiSettingsSource, /item\.image_capabilities\[newName\] = capability/);
    assert.match(apiSettingsSource, /delete item\.image_capabilities\[removed\]/);
    assert.match(apiSettingsSource, /function veniceImageCapabilityHtml/);
    assert.match(apiSettingsSource, /function updateVeniceImageCapability/);
});
