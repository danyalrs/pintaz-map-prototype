import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeComparisonDir, derivedPreviewPath } from '../src/lib/local-route-explorer/paths.js';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { previewGeojsonPath } from '../src/lib/update-preview-paths.js';
import {
  OUTCOME,
  buildGeometryWayRow,
  buildRouteGeometry,
  isOneWayWay,
} from '../src/lib/lane-enrichment-geometry-v2/index.js';
import { loadRoadIndexEntry } from '../src/lib/lane-enrichment-candidates/index.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';

function bundleReady(routeKey) {
  return fs.existsSync(matchedPosesPath(routeComparisonDir(routeKey)));
}

function loadMatched(routeKey) {
  return JSON.parse(fs.readFileSync(matchedPosesPath(routeComparisonDir(routeKey)), 'utf8')).features;
}

function loadPreview(routeKey) {
  const p = routeKey === 'active' ? previewGeojsonPath() : derivedPreviewPath(routeKey);
  return JSON.parse(fs.readFileSync(p, 'utf8')).features;
}

function roadFeature(osmId) {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  return roads.features.find((f) => String(f.properties?.osm_id) === String(osmId));
}

test('geometry V2 never uses lane_index in exports as lane count field', () => {
  const row = buildGeometryWayRow({
    routeKey: 'test',
    osmWayId: '0',
    roadFeature: null,
    roadIndexEntry: null,
    matchedPoses: [],
    previewFeatures: [],
  });
  assert.equal(row.never_auto_apply, true);
  assert.equal(row.human_review_required, true);
  assert.equal('lane_index' in row, false);
});

test('drive-005 Jalan Kamuning 39914067: not three lanes from samples', () => {
  if (!bundleReady('drive-005')) return;
  const entry = loadRoadIndexEntry(fs, '39914067');
  const feat = roadFeature('39914067');
  assert.equal(isOneWayWay(feat, entry), true);
  const row = buildGeometryWayRow({
    routeKey: 'drive-005',
    osmWayId: '39914067',
    roadFeature: feat,
    roadIndexEntry: entry,
    matchedPoses: loadMatched('drive-005'),
    previewFeatures: loadPreview('drive-005'),
  });
  const lanePointCount = (row.frame_evidence || []).reduce(
    (n, fr) => n + (fr.lane_point_lateral_m?.length || 0),
    0
  );
  if (lanePointCount > 2) {
    assert.notEqual(row.selected_lane_count, 3);
  }
  if (row.selected_lane_count === 1) {
    assert.ok(row.confidence >= 0.6);
    assert.equal(row.decision, OUTCOME.GEOMETRY_CANDIDATE_MISSING_OSM_LANES);
  } else {
    assert.equal(row.selected_lane_count, null);
    assert.equal(
      [OUTCOME.INSUFFICIENT_EVIDENCE, OUTCOME.GEOMETRY_CANDIDATE_MISSING_OSM_LANES].includes(
        row.decision
      ),
      true
    );
  }
});

test('active 252085334 one-way eval row does not use OSM lanes during build flags', () => {
  if (!bundleReady('active')) return;
  const entry = loadRoadIndexEntry(fs, '252085334');
  const feat = roadFeature('252085334');
  assert.equal(isOneWayWay(feat, entry), true);
  const row = buildGeometryWayRow({
    routeKey: 'active',
    osmWayId: '252085334',
    roadFeature: feat,
    roadIndexEntry: entry,
    matchedPoses: loadMatched('active'),
    previewFeatures: loadPreview('active'),
    evalLabelOsmLanes: entry.lane_count_total,
  });
  assert.ok(
    [
      OUTCOME.GEOMETRY_AGREES_WITH_OSM_BASELINE,
      OUTCOME.GEOMETRY_DISAGREES_WITH_OSM_REVIEW,
      OUTCOME.INSUFFICIENT_EVIDENCE,
    ].includes(row.decision)
  );
});

test('two-way ways return not_eligible_two_way', () => {
  const row = buildGeometryWayRow({
    routeKey: 'drive-001',
    osmWayId: '1',
    roadFeature: { properties: { oneway: 'no' }, geometry: { coordinates: [[0, 0], [0.001, 0]] } },
    roadIndexEntry: { oneway: { isOneway: false } },
    matchedPoses: [],
    previewFeatures: [],
  });
  assert.equal(row.decision, OUTCOME.NOT_ELIGIBLE_TWO_WAY);
});

test('buildRouteGeometry returns rows for drive-005 when bundle exists', () => {
  if (!bundleReady('drive-005')) return;
  const res = buildRouteGeometry('drive-005');
  assert.equal(res.ok, true);
  const k = res.rows.find((r) => r.osm_way_id === '39914067');
  assert.ok(k);
});
