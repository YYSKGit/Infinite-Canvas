import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const smartCanvasSource = fs.readFileSync(new URL('../static/js/smart-canvas.js', import.meta.url), 'utf8');
const smartCanvasCss = fs.readFileSync(new URL('../static/css/smart-canvas.css', import.meta.url), 'utf8');
const apiSettingsSource = fs.readFileSync(new URL('../static/js/api-settings.js', import.meta.url), 'utf8');

test('Smart Canvas submits structured size intent beside the legacy pixel size', () => {
    assert.match(smartCanvasSource, /function imageSizeSpecForRun\(/);
    assert.match(smartCanvasSource, /mode:'auto_aspect', resolution/);
    assert.match(smartCanvasSource, /size_spec:imageSizeSpecForRun\(requestSettings\)/);
    assert.match(smartCanvasSource, /quality:imageQualityForRequest\(requestSettings, \{hasReferenceImage\}\)/);
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

test('Venice catalog loads once without blocking the canvas and reuses the last snapshot on failure', () => {
    assert.match(smartCanvasSource, /let veniceModelCatalogPromise = null/);
    assert.match(smartCanvasSource, /if\(veniceModelCatalogPromise\) return veniceModelCatalogPromise/);
    assert.match(smartCanvasSource, /await loadConfig\(\);\s*void loadVeniceModelCatalogOnce\(\);/);
    assert.doesNotMatch(smartCanvasSource, /await loadVeniceModelCatalogOnce\(\)/);
    assert.equal((smartCanvasSource.match(/loadVeniceModelCatalogOnce\(\)/g) || []).length, 2);
    assert.match(smartCanvasSource, /cachedCatalog = await readCachedVeniceModelCatalog\(providerId\)/);
    assert.match(smartCanvasSource, /已继续使用上次成功记录/);
    assert.match(smartCanvasSource, /当前无法校验模型参数/);
    assert.match(smartCanvasSource, /caps\.catalogControlled && !caps\.qualityOptions\.includes\(value\).*disabled/);
    assert.match(smartCanvasSource, /caps\.catalogControlled && !caps\.aspects\.includes\(value\).*disabled/);
    assert.match(smartCanvasSource, /if\(btn\.disabled\) return/);
});

test('entirely unsupported Venice parameter groups are hidden instead of showing only disabled choices', () => {
    assert.match(smartCanvasSource, /const qualityHtml = caps\.supportsQuality \?/);
    assert.match(smartCanvasSource, /const generalHtml = caps\.generateAudio\s*\?/);
    assert.match(smartCanvasSource, /const aspectHtml = visibleAspects\.length \?/);
    assert.match(smartCanvasSource, /const durationHtml = caps\.supportsDuration \?/);
});

test('invalid Venice model IDs and missing edit routes render a compact error state', () => {
    assert.match(smartCanvasSource, /function veniceCatalogImageResolution\(/);
    assert.match(smartCanvasSource, /未配置 I2I 编辑模型/);
    assert.match(smartCanvasSource, /模型目录中未找到编辑模型/);
    assert.match(smartCanvasSource, /function renderVeniceCapabilityErrorControl\(/);
    assert.match(smartCanvasSource, /venice-capability-error-card/);
    assert.match(smartCanvasSource, /if\(caps\.invalid \|\| caps\.pending\) return renderVeniceCapabilityErrorControl\('image', caps\)/);
    assert.match(smartCanvasSource, /if\(imageCaps\.invalid \|\| imageCaps\.pending\) throw new Error/);
    assert.match(smartCanvasSource, /参数加载中/);
    assert.match(smartCanvasSource, /function normalizedVeniceCatalogModelId\(value\)\{\s*return String\(value \|\| ''\)\.trim\(\)\.toLowerCase\(\);/);
    assert.doesNotMatch(smartCanvasSource, /function normalizedVeniceCatalogModelId\(value\)\{[^}]*replace\(\/_\/g, '-'/);
    assert.match(smartCanvasSource, /function smartNodeVeniceCapabilityIssue\(/);
    assert.match(smartCanvasSource, /plan\?\.invalid === 'capability'/);
    assert.match(smartCanvasSource, /renderDynamicParams[\s\S]*?syncRunButtonState\(\);\s*syncCascadeRunButton\(\);/);
    assert.match(smartCanvasCss, /\.venice-image-quote\.is-error \{ color:#f59e0b; \}/);
    assert.match(smartCanvasCss, /\.venice-video-quote\.is-error \{ color:#f59e0b; \}/);
});

test('Smart Canvas no longer derives or renders a source-ratio option', () => {
    assert.doesNotMatch(smartCanvasSource, /sourceImageRatioLabel|sourceRatioImageForNode|applySourceRatioToSettings/);
    assert.doesNotMatch(smartCanvasSource, /\[\s*['"]source['"]\s*,/);
});

test('pixel-size models allow auto only when an image reference will be submitted', () => {
    assert.match(smartCanvasSource, /const autoDisabled = caps\.sizeMode === 'pixel' && !hasReferenceImage/);
    assert.match(smartCanvasSource, /const hasReferenceImage = imageRefsOnly\(refs\)\.length > 0/);
    assert.match(smartCanvasSource, /syncImageSettingsPanelForRefs\(\)/);
});

test('API settings preserves legacy capability data without exposing manual controls', () => {
    assert.match(apiSettingsSource, /image_capabilities:\(item\.image_capabilities/);
    assert.match(apiSettingsSource, /item\.image_capabilities\[newName\] = capability/);
    assert.match(apiSettingsSource, /delete item\.image_capabilities\[removed\]/);
    assert.doesNotMatch(apiSettingsSource, /function veniceImageCapabilityHtml/);
    assert.doesNotMatch(apiSettingsSource, /function updateVeniceImageCapability/);
});
