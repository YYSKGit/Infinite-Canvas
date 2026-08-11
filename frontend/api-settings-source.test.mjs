import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../static/js/api-settings.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../static/css/api-settings.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../static/api-settings.html', import.meta.url), 'utf8');

test('model sections are ordered as chat, image, then video', () => {
  const chatIndex = html.indexOf('id="chatModelList"');
  const imageIndex = html.indexOf('id="imageModelList"');
  const videoIndex = html.indexOf('id="videoModelList"');
  assert.ok(chatIndex >= 0 && chatIndex < imageIndex && imageIndex < videoIndex);
});

test('secret previews stay separate from writable secret fields', () => {
  assert.match(source, /item\.venice_client_preview/);
  assert.doesNotMatch(source, /item\.__client\s*\|\|/);
  assert.match(source, /__client:item\.venice_client \|\| undefined/);
});

test('Venice model rows expose compact configurable I2I and T2V routes', () => {
  assert.match(source, /function veniceModelRouteHtml/);
  assert.match(source, /image_edit/);
  assert.match(source, /text_to_video/);
  assert.match(source, /model_routes:\(item\.model_routes/);
  assert.match(source, /FIXED_PROTOCOL_PROVIDER_IDS[^\n]*'venice'/);
  assert.match(css, /\.model-row\.has-venice-route/);
  assert.match(css, /\.venice-model-route/);
  assert.doesNotMatch(source, /function veniceModelColumnsHtml/);
  assert.match(source, /function veniceModelFieldsHtml/);
  assert.match(source, /api\.currentModelId/);
  assert.match(source, /api\.veniceImageRouteLabel/);
  assert.match(source, /api\.veniceVideoRouteLabel/);
  assert.match(source, />ID<\/span>/);
  assert.match(source, />NM<\/span>/);
  assert.match(source, /veniceModelRouteHtml[\s\S]*venice-model-name-field/);
  assert.doesNotMatch(css, /\.venice-model-columns/);
});

test('Venice routes follow source model rename and deletion', () => {
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(item\.model_routes, oldName\)/);
  assert.match(source, /delete item\.model_routes\[removed\]/);
});

test('chat model ID and name fields use the same compact prefixes', () => {
  assert.match(source, /function standardModelFieldsHtml/);
  assert.match(source, /if\(kind !== 'chat'\)/);
  assert.match(source, /model-inputs model-prefixed-inputs/);
  assert.match(css, /\.model-prefixed-inputs/);
  assert.match(css, /\.model-prefixed-inputs \.model-id-field[^}]*flex:1\.18/);
  assert.match(css, /\.model-prefixed-inputs \.model-name-field[^}]*flex:\.82/);
});
