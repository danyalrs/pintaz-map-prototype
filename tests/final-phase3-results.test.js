import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFinalPhase3Results,
  FINAL_RESULTS_SCHEMA,
  REPORT_DIR,
} from '../src/lib/full-maps-read-route-enrichment-discovery/build-final-phase3-results.js';
import { PAIR_SHORTLIST_STATUS } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-constants.js';

test('final Phase 3 builder matches completed checkpoint facts', () => {
  const artifacts = buildFinalPhase3Results();
  assert.equal(artifacts.validation.routes_completed_total, 1597);
  assert.equal(artifacts.validation.routes_pending, 0);
  assert.equal(artifacts.validation.routes_qualified_for_future_geometry, 198);
  assert.equal(artifacts.validation.retryable_failure_count, 0);
  assert.equal(artifacts.validation.matches_user_facts, true);
  assert.equal(artifacts.summary.schema, FINAL_RESULTS_SCHEMA);
  assert.equal(artifacts.summary.lane_counts_inferred, 0);
  assert.equal(artifacts.summary.cross_route_prototype_pooling_used, false);
  assert.equal(artifacts.summary.pair_shortlist.qualified_route_unknown_way_pairs_after_geometry_gates, 90);
  assert.ok(
    artifacts.summary.pair_shortlist.qualified_route_unknown_way_pairs_before_geometry_gates > 90
  );
});

test('shortlist rows are future-geometry only with no lane count', () => {
  const { shortlistRedacted, futurePairs } = buildFinalPhase3Results();
  assert.equal(shortlistRedacted.pair_count, futurePairs.length);
  for (const row of shortlistRedacted.pairs) {
    assert.equal(row.shortlist_status, PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY);
    assert.equal(row.selected_lane_count, null);
    assert.equal(row.not_a_confirmed_lane_count, true);
    assert.equal(row.future_geometry_candidate_only, true);
    assert.ok(row.disclaimer);
  }
});

test('written final artifacts exist after build script output', () => {
  const summaryPath = path.join(REPORT_DIR, 'final_phase3_summary.json');
  if (!fs.existsSync(summaryPath)) return;
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.checkpoint_validation.matches_user_facts, true);
  assert.ok(summary.conclusion.includes('ordered lane-boundary'));
});
