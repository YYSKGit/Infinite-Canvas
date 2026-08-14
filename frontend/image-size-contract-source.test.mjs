import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const smartCanvasSource = fs.readFileSync(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const apiSettingsSource = fs.readFileSync(new URL('../static/js/api-settings.js', import.meta.url), 'utf8');

test('Smart Canvas submits structured size intent beside the legacy pixel size', () => {
    assert.match(smartCanvasSource, /function imageSizeSpecForRun\(/);
    assert.match(smartCanvasSource, /size_spec:imageSizeSpecForRun\(runSettings\)/);
    assert.match(smartCanvasSource, /size_spec:sizeSpec/);
    assert.match(smartCanvasSource, /quality:String\(settings\.quality \|\| 'auto'\)/);
});

test('API settings saves and exposes editable per-model capabilities', () => {
    assert.match(apiSettingsSource, /image_capabilities:\(item\.image_capabilities/);
    assert.match(apiSettingsSource, /item\.image_capabilities\[newName\] = capability/);
    assert.match(apiSettingsSource, /delete item\.image_capabilities\[removed\]/);
    assert.match(apiSettingsSource, /function veniceImageCapabilityHtml/);
    assert.match(apiSettingsSource, /function updateVeniceImageCapability/);
});
