import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { routeComparisonDir } from '../src/lib/local-route-explorer/paths.js';
import {
  runRouteAwareLaneCalibrationAudit,
  PREPARED_ROUTE_KEYS,
  ROUTE_VERDICT,
  UNKNOWN_WAY_COVERAGE,
  DRIVE005_KAMUNING_WAY_ID,
  loadRouteScopedWays,
} from '../src/lib/route-aware-lane-calibration-audit/index.js';
import { leaveOneWayOutForRoute } from '../src/lib/route-aware-lane-calibration-audit/per-route-evaluation.js';
import { normalizeOsmWayId } from '../src/lib/selected-route-osm-comparison-lookup.js';

function bundlesReady() {
  return fs.existsSync(matchedPosesPath(routeComparisonDir('active')));
}

test('audit includes all prepared routes', () => {
  const audit = runRouteAwareLaneCalibrationAudit();
  assert.equal(audit.qualifications.length, PREPARED_ROUTE_KEYS.length);
  assert.equal(audit.conclusions.real_enrichment_candidate_allowed, false);
});

test('LOO on a route never trains on held-out way (same route frames)', () => {
  if (!bundlesReady()) return;
  const routeKey = 'drive-008';
  const { ways } = loadRouteScopedWays(routeKey);
  const rows = leaveOneWayOutForRoute(ways, routeKey);
  for (const row of rows) {
    assert.equal(row.route_key, routeKey);
  }
});

test('no cross-route frame mixing in route-scoped corpus', () => {
  if (!bundlesReady()) return;
  const { ways } = loadRouteScopedWays('active');
  for (const w of ways.values()) {
    assert.ok(w.frames.every((f) => f.route_key === 'active'));
  }
});

test('kamuning unknown way demonstration on drive-005', () => {
  if (!bundlesReady()) return;
  if (!fs.existsSync(matchedPosesPath(routeComparisonDir('drive-005')))) return;
  const audit = runRouteAwareLaneCalibrationAudit();
  const k = audit.kamuning_demonstration;
  assert.ok(k);
  assert.equal(normalizeOsmWayId(k.osm_way_id), DRIVE005_KAMUNING_WAY_ID);
  assert.equal(k.osm_lane_count_label, null);
  assert.ok(k.demonstration?.drive_005_covers);
  assert.notEqual(k.coverage_status, UNKNOWN_WAY_COVERAGE.QUALIFIED);
});

test('qualified routes have zero high-margin incorrect (policy)', () => {
  if (!bundlesReady()) return;
  const audit = runRouteAwareLaneCalibrationAudit();
  for (const q of audit.qualifications) {
    if (q.route_verdict === ROUTE_VERDICT.QUALIFIED) {
      assert.equal(q.held_out_single_best.high_margin_incorrect_count, 0);
    }
  }
});
