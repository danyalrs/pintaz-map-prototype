import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeBareNanInJson, sha256Hex } from '../src/lib/json-nan-normalize.js';
import {
  prepareUpdatePreviewFromRaw,
  loadEnvelope,
  PAGE1_EXPECTED,
} from '../src/lib/update-preview-prepare.js';
import { buildPublicManifest } from '../src/lib/update-preview-manifest.js';
import { geometryFingerprints, countByLayer } from '../src/lib/update-preview-stats.js';
import { UPDATE_LAYER_IDS, updatePreviewLayerDefinitions } from '../src/lib/update-observation-info.js';
import { ALL_UPDATE_LAYER_IDS } from '../src/lib/update-observation-info.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import {
  createIsolatedMapsReadFixture,
  cleanupIsolatedMapsReadFixture,
  withIsolatedMapsReadRoot,
} from './helpers/isolated-maps-read-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = createIsolatedMapsReadFixture();
process.env.PINTAZ_MAPS_READ_ROOT = fixture.root;
process.env.PINTAZ_TEST = '1';
process.env.MAPBOX_ACCESS_TOKEN = '';

after(() => {
  cleanupIsolatedMapsReadFixture(fixture);
  delete process.env.PINTAZ_MAPS_READ_ROOT;
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('bare NaN normalization', () => {
  const input = '{"a":NaN,"b":"NaN","c":"back\\\\slash","d":1}';
  const { normalized, replacementCount } = normalizeBareNanInJson(input);
  assert.equal(replacementCount, 1);
  assert.equal(JSON.parse(normalized).a, null);
  assert.equal(JSON.parse(normalized).b, 'NaN');
});

test('escaped quotes in strings preserved', () => {
  const input = '{"msg":"say \\"hi\\"","v":NaN}';
  const { normalized, replacementCount } = normalizeBareNanInJson(input);
  assert.equal(replacementCount, 1);
  const j = JSON.parse(normalized);
  assert.equal(j.msg, 'say "hi"');
});

test('raw sample hash unchanged on disk', () => {
  if (!fs.existsSync(RAW_SAMPLE_PATH)) return;
  assert.equal(sha256File(RAW_SAMPLE_PATH), PAGE1_EXPECTED.rawSha256);
});

test('prepare preview: strict JSON, counts, geometry order', () => {
  if (!fs.existsSync(fixture.previewPaths.rawSamplePath)) return;
  const rawBefore = sha256File(fixture.previewPaths.rawSamplePath);
  const prep = withIsolatedMapsReadRoot(fixture, () =>
    prepareUpdatePreviewFromRaw({
      ...fixture.previewPaths,
      force: true,
      expected: PAGE1_EXPECTED,
    })
  );
  assert.equal(prep.ok, true);
  assert.equal(sha256File(fixture.previewPaths.rawSamplePath), rawBefore);
  const preview = JSON.parse(fs.readFileSync(fixture.previewPaths.previewPath, 'utf8'));
  assert.equal(preview.features.length, 5171);
  const layers = countByLayer(preview.features);
  assert.deepEqual(layers, PAGE1_EXPECTED.layerCounts);
  const rawText = fs.readFileSync(fixture.previewPaths.rawSamplePath, 'utf8');
  const { normalized } = normalizeBareNanInJson(rawText);
  const fromRaw = JSON.parse(normalized);
  assert.deepEqual(geometryFingerprints(preview.features), geometryFingerprints(fromRaw.features));
  assert.equal(prep.replacementCount, 978);
});

test('envelope schema and truncation fields', () => {
  if (!fs.existsSync(fixture.previewPaths.rawSamplePath)) return;
  withIsolatedMapsReadRoot(fixture, () =>
    prepareUpdatePreviewFromRaw({ ...fixture.previewPaths, force: true, expected: PAGE1_EXPECTED })
  );
  const env = JSON.parse(fs.readFileSync(fixture.previewPaths.envelopePath, 'utf8'));
  assert.equal(env.update_schema, 'pintaz.maps-read.update-preview');
  assert.equal(env.truncated, true);
  assert.equal(env.next_after_seg, 23);
  assert.equal(env.acceptance_state, 'pending');
  assert.equal(env.inside_area_count, 4256);
  assert.equal(env.outside_area_count, 915);
  assert.equal(env.normalization.geometry_changed, false);
});

test('public manifest redaction', () => {
  if (!fs.existsSync(fixture.previewPaths.envelopePath)) return;
  const env = JSON.parse(fs.readFileSync(fixture.previewPaths.envelopePath, 'utf8'));
  const m = buildPublicManifest(env);
  assert.ok(m.source_response_sha256_prefix.length <= 12);
  assert.equal(m.source, 'Maps Read API');
  assert.ok(!JSON.stringify(m).includes(env.source_dongle));
});

test('map layer ids and filters', () => {
  const layers = updatePreviewLayerDefinitions();
  assert.equal(layers.length, 4);
  const ids = layers.map((l) => l.id);
  assert.deepEqual(ids.sort(), [...ALL_UPDATE_LAYER_IDS].sort());
  for (const layer of layers) {
    assert.equal(layer.type, 'circle');
    assert.equal(layer.filter[2], layer.id.replace('pintaz-update-', ''));
  }
  assert.equal(UPDATE_LAYER_IDS.vehicle_pose, 'pintaz-update-vehicle_pose');
});

test('update preview area id constant', async () => {
  const { UPDATE_PREVIEW_AREA_ID } = await import('../src/lib/update-observation-info.js');
  assert.equal(UPDATE_PREVIEW_AREA_ID, 'bukit-bintang-imbi');
});
