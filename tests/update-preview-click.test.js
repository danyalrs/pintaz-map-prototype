import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  observationClickQueryBox,
  getSelectableObservationLayerIds,
  pickTopObservationFeature,
  buildObservationPanelFields,
  redactDongleInSourceFile,
  OBSERVATION_HIT_RADIUS_PX,
  SELECTION_LAYER_ID,
} from '../src/lib/update-preview-click.js';
import { ALL_UPDATE_LAYER_IDS, UPDATE_LAYER_IDS } from '../src/lib/update-observation-info.js';

test('observation layer id list matches map layers', () => {
  assert.deepEqual(ALL_UPDATE_LAYER_IDS.sort(), [
    'pintaz-update-edge_point',
    'pintaz-update-gps_point',
    'pintaz-update-lane_point',
    'pintaz-update-vehicle_pose',
  ]);
  assert.equal(UPDATE_LAYER_IDS.lane_point, 'pintaz-update-lane_point');
});

test('±6 px query box', () => {
  const box = observationClickQueryBox({ x: 100, y: 200 }, OBSERVATION_HIT_RADIUS_PX);
  assert.deepEqual(box, [[94, 194], [106, 206]]);
});

test('visible-layer filtering excludes hidden layout', () => {
  const map = {
    getLayer: (id) => (ALL_UPDATE_LAYER_IDS.includes(id) ? {} : null),
    getLayoutProperty: (id) => (id === 'pintaz-update-lane_point' ? 'none' : 'visible'),
  };
  const ids = getSelectableObservationLayerIds(map, {
    visible: true,
    areaId: 'bukit-bintang-imbi',
    layerVisibility: { vehicle_pose: true, lane_point: true, edge_point: true, gps_point: true },
  });
  assert.ok(!ids.includes('pintaz-update-lane_point'));
  assert.ok(ids.includes('pintaz-update-edge_point'));
});

test('hidden preview returns no selectable layers', () => {
  const map = {
    getLayer: () => ({}),
    getLayoutProperty: () => 'visible',
  };
  assert.deepEqual(
    getSelectableObservationLayerIds(map, { visible: false, areaId: 'bukit-bintang-imbi', layerVisibility: {} }),
    []
  );
});

test('pick top observation feature', () => {
  const a = { layer: { id: 'pintaz-update-lane_point' } };
  const b = { layer: { id: 'pintaz-update-vehicle_pose' } };
  assert.equal(pickTopObservationFeature([a, b]), a);
  assert.equal(pickTopObservationFeature([]), null);
});

test('observation panel fields and NaN null wording', () => {
  const fields = buildObservationPanelFields(
    { layer: 'lane_point', lane_index: 0, t: null, lane_probability: 0.9 },
    [101.72, 3.15]
  );
  assert.match(fields.disclaimer, /not part of the accepted OSM baseline/);
  const tRow = fields.rows.find((r) => r[0] === 'Time (t)');
  assert.equal(tRow[1], 'null (was NaN in raw API)');
  const typeRow = fields.rows.find((r) => r[0] === 'Observation type');
  assert.equal(typeRow[1], 'Lane observation');
});

test('dongle redaction in source file field', () => {
  const redacted = redactDongleInSourceFile('0367014303470e14---2026-08-30--07-33-21--0---qlog.bz2');
  assert.ok(!redacted.includes('0367014303470e14'));
  assert.match(redacted, /^0367…/);
});

test('selection halo layer id', () => {
  assert.equal(SELECTION_LAYER_ID, 'pintaz-update-selection-halo');
});

test('map click path uses proposal then observation then OSM roads', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const appJs = fs.readFileSync(path.join(root, '..', 'src', 'public', 'app.js'), 'utf8');
  const selectionJs = fs.readFileSync(path.join(root, '..', 'src', 'public', 'map-selection.js'), 'utf8');
  assert.match(appJs, /initMapSelection/);
  assert.match(selectionJs, /handleObservationEvidenceClick/);
  const idx = selectionJs.indexOf('return function handleMapClick');
  const block = selectionJs.slice(idx, idx + 2500);
  const candIdx = block.indexOf('tryMismatchCandidateClick');
  const obsIdx = block.indexOf('handleObservationEvidenceClick');
  const mismatchIdx = block.indexOf('tryMismatchNonCandidateClick');
  const proposalIdx = block.indexOf("group === 'proposed'");
  const roadIdx = block.indexOf('layers: DETAILED_FILL_LAYER_IDS');
  assert.ok(candIdx >= 0 && obsIdx >= 0 && mismatchIdx >= 0 && proposalIdx >= 0 && roadIdx >= 0);
  assert.ok(candIdx < obsIdx && obsIdx < mismatchIdx && mismatchIdx < proposalIdx && proposalIdx < roadIdx);
});

test('observation info panel exists in index', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(root, '..', 'src', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="observation-info"/);
  assert.match(html, /Observation info/);
});
