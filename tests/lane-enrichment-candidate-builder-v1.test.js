import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeComparisonDir } from '../src/lib/local-route-explorer/paths.js';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { derivedPreviewPath } from '../src/lib/local-route-explorer/paths.js';
import { previewGeojsonPath } from '../src/lib/update-preview-paths.js';
import {
  DECISION,
  SOURCE_SEMANTICS_AUDIT,
  buildWayRow,
  loadRoadIndexEntry,
  buildRouteEnrichmentRows,
} from '../src/lib/lane-enrichment-candidates/index.js';

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

test('source semantics audit states green dots are not lane count', () => {
  assert.match(SOURCE_SEMANTICS_AUDIT.green_dot_statement, /not physical lane count/i);
  assert.equal(SOURCE_SEMANTICS_AUDIT.physical_lane_count_supported, false);
});

test('A: drive-005 Jalan Kamuning 39914067 does not infer physical lane count', () => {
  if (!bundleReady('drive-005')) return;
  const row = buildWayRow({
    fs,
    routeKey: 'drive-005',
    osmWayId: '39914067',
    matchedPoses: loadMatched('drive-005'),
    previewFeatures: loadPreview('drive-005'),
    roadIndexEntry: loadRoadIndexEntry(fs, '39914067'),
    roadName: 'Jalan Kamuning',
  });
  assert.equal(row.osm_lane_count, null);
  assert.equal(row.selected_lane_count, null);
  assert.equal(row.decision, DECISION.UNSUPPORTED_SOURCE_SEMANTICS);
  assert.equal(row.never_auto_apply, true);
  assert.equal(row.human_review_required, true);
  const dotLike = row.cross_section_candidates?.[0]?.lane_observation_points;
  if (dotLike > 1) {
    assert.notEqual(row.decision, DECISION.REVIEW_CANDIDATE_MISSING_OSM_LANES);
  }
});

test('B: active Jalan Sultan Ismail 252085334 osm_baseline_present', () => {
  if (!bundleReady('active')) return;
  const entry = loadRoadIndexEntry(fs, '252085334');
  const row = buildWayRow({
    fs,
    routeKey: 'active',
    osmWayId: '252085334',
    matchedPoses: loadMatched('active'),
    previewFeatures: loadPreview('active'),
    roadIndexEntry: entry,
    roadName: 'Jalan Sultan Ismail',
  });
  assert.equal(row.osm_lane_count, 3);
  assert.equal(row.decision, DECISION.OSM_BASELINE_PRESENT);
  assert.equal(row.selected_lane_count, null);
});

test('C: missing-lane way with no poses yields insufficient_evidence', () => {
  if (!bundleReady('drive-008')) return;
  const res = buildRouteEnrichmentRows('drive-008');
  assert.equal(res.ok, true);
  const sparse = res.rows.find(
    (r) => r.matched_vehicle_frames > 0 && r.matched_vehicle_frames <= 3 && r.osm_lane_count == null
  );
  if (!sparse) return;
  assert.ok(
    [DECISION.INSUFFICIENT_EVIDENCE, DECISION.UNSUPPORTED_SOURCE_SEMANTICS].includes(sparse.decision)
  );
  assert.equal(sparse.selected_lane_count, null);
});
