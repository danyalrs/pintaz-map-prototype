import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeComparisonDir, derivedPreviewPath } from '../src/lib/local-route-explorer/paths.js';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { previewGeojsonPath } from '../src/lib/update-preview-paths.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { loadRoadIndexEntry } from '../src/lib/lane-enrichment-candidates/index.js';
import {
  buildFrameTrace,
  maxCrossingsPerLinePerFrame,
  lineIdentity,
} from '../src/lib/lane-enrichment-geometry-v2-1-diagnosis/index.js';

function bundleReady() {
  return fs.existsSync(matchedPosesPath(routeComparisonDir('active')));
}

test('invariant: at most one observation per source line per frame in preview', () => {
  if (!bundleReady()) return;
  const preview = JSON.parse(fs.readFileSync(previewGeojsonPath(), 'utf8')).features;
  const matched = JSON.parse(
    fs.readFileSync(matchedPosesPath(routeComparisonDir('active')), 'utf8')
  ).features;
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const feat = roads.features.find((f) => String(f.properties.osm_id) === '252085334');
  const entry = loadRoadIndexEntry(fs, '252085334');
  const trace = buildFrameTrace({
    routeKey: 'active',
    osmWayId: '252085334',
    roadFeature: feat,
    roadIndexEntry: entry,
    matchedPoses: matched,
    previewFeatures: preview,
  });
  const inv = maxCrossingsPerLinePerFrame(trace.point_traces);
  assert.equal(inv.ok, true, JSON.stringify(inv.violations));
});

test('V2 reproduction for 252085334 active is five lanes at cross-section ef9afb2b3f9c4e37', () => {
  if (!bundleReady()) return;
  const preview = JSON.parse(fs.readFileSync(previewGeojsonPath(), 'utf8')).features;
  const matched = JSON.parse(
    fs.readFileSync(matchedPosesPath(routeComparisonDir('active')), 'utf8')
  ).features;
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const feat = roads.features.find((f) => String(f.properties.osm_id) === '252085334');
  const entry = loadRoadIndexEntry(fs, '252085334');
  const trace = buildFrameTrace({
    routeKey: 'active',
    osmWayId: '252085334',
    roadFeature: feat,
    roadIndexEntry: entry,
    matchedPoses: matched,
    previewFeatures: preview,
  });
  assert.equal(trace.reproduction.selected_lane_count, 5);
  assert.equal(trace.reproduction.cross_section_id, 'ef9afb2b3f9c4e37');
  assert.equal(
    trace.per_frame_lane_count_logic.every((f) => f.v2_implied_lane_count_interior_bins_plus_one === 5),
    true
  );
});

test('lineIdentity encodes lane_index for lane_point', () => {
  const id = lineIdentity({
    layer: 'lane_point',
    lane_index: 2,
    source_feature_index: 99,
  });
  assert.match(id, /lane_index=2/);
});
