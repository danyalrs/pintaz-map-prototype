import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINAL_RESULTS_SCHEMA } from '../src/lib/full-maps-read-route-enrichment-discovery/build-final-phase3-results.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUMMARY_PATH = path.join(ROOT, 'reports', 'public', 'final_phase3_summary.json');

test('committed public Phase 3 summary matches published screening counts', () => {
  assert.ok(fs.existsSync(SUMMARY_PATH), 'reports/public/final_phase3_summary.json is required in public clone');
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  assert.equal(summary.schema, FINAL_RESULTS_SCHEMA);
  assert.equal(summary.lane_counts_inferred, 0);
  assert.equal(summary.checkpoint_validation.routes_completed_total, 1597);
  assert.equal(summary.checkpoint_validation.routes_pending, 0);
  assert.equal(summary.checkpoint_validation.routes_qualified_for_future_geometry, 198);
  assert.equal(summary.pair_shortlist.qualified_route_unknown_way_pairs_before_geometry_gates, 1123);
  assert.equal(summary.pair_shortlist.qualified_route_pairs_pose_min_reached_before_geometry_gate, 430);
  assert.equal(summary.pair_shortlist.future_geometry_candidate_pairs, 90);
  assert.equal(summary.pair_shortlist.unknown_lane_ways_with_at_least_one_qualified_route, 46);
});

test('public lane-edge export audit aggregate is point-only only', () => {
  const auditPath = path.join(ROOT, 'reports', 'public', 'qualified_route_lane_edge_export_audit.json');
  assert.ok(fs.existsSync(auditPath));
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  assert.equal(audit.qualified_route_count, 198);
  assert.equal(audit.counts.point_only, 198);
  assert.equal(audit.counts.polyline_containing, 0);
  assert.equal(audit.lane_count_inferred, false);
});
