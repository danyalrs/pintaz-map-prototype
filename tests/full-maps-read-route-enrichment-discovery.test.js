import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWayCoverage,
  rankRouteRoadPairs,
  loadUnknownLaneOsmWays,
  WAY_COVERAGE_CLASS,
  TARGET_WAYS,
  mapQualificationToEligibility,
  ROUTE_ELIGIBILITY,
  loadPhase2ProgressSummary,
} from '../src/lib/full-maps-read-route-enrichment-discovery/index.js';
import { ROUTE_VERDICT } from '../src/lib/route-aware-lane-calibration-audit/constants.js';

test('unknown lane ways load from road index', () => {
  const ways = loadUnknownLaneOsmWays();
  assert.ok(ways.length > 10);
  const kamuning = ways.find((w) => w.osm_way_id === TARGET_WAYS.JALAN_KAMUNING);
  assert.ok(kamuning);
  // Lorong Kuda may appear in road index with a usable lane tag; discovery still reports it explicitly.
});

test('coverage classification thresholds', () => {
  assert.equal(classifyWayCoverage({ matched_pose_count: 0 }), WAY_COVERAGE_CLASS.NONE);
  assert.equal(
    classifyWayCoverage({ matched_pose_count: 5, median_distance_m: 8, median_heading_diff_deg: 10 }),
    WAY_COVERAGE_CLASS.CANDIDATE
  );
  assert.equal(
    classifyWayCoverage({ matched_pose_count: 1, median_distance_m: 2, median_heading_diff_deg: 5 }),
    WAY_COVERAGE_CLASS.LOW
  );
});

test('eligibility mapping for phase 2 qualification', () => {
  assert.equal(
    mapQualificationToEligibility(ROUTE_VERDICT.QUALIFIED),
    ROUTE_ELIGIBILITY.QUALIFIED_GEOMETRY
  );
  assert.equal(
    mapQualificationToEligibility(ROUTE_VERDICT.NOT_QUALIFIED),
    ROUTE_ELIGIBILITY.NOT_QUALIFIED
  );
  assert.equal(
    mapQualificationToEligibility(null, { hasVehiclePoseIndex: false }),
    ROUTE_ELIGIBILITY.INSUFFICIENT_COVERAGE
  );
});

test('phase2 progress summary reads checkpoint counts', () => {
  const s = loadPhase2ProgressSummary();
  assert.equal(s.catalog_route_count, 1706);
  assert.ok(s.routes_indexed_in_checkpoint >= 0);
});

test('ranking marks top pairs as ranked', () => {
  const rows = rankRouteRoadPairs([
    { route_ref: 'drive-001', osm_way_id: '1', matched_pose_count: 10, median_distance_m: 4, median_heading_diff_deg: 8, direction_compatible_fraction: 0.9, continuous_covered_length_m: 40 },
    { route_ref: 'drive-002', osm_way_id: '1', matched_pose_count: 2, median_distance_m: 4, median_heading_diff_deg: 8, direction_compatible_fraction: 0.5, continuous_covered_length_m: 5 },
  ]);
  assert.equal(rows[0].coverage_class, WAY_COVERAGE_CLASS.RANKED);
});
