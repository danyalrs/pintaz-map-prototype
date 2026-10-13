import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatMismatchDiagnosticCardHtml } from '../src/lib/mismatch-card-format.js';
import { computeEligibilityTiers, supportGatesFailed } from '../src/lib/mismatch-eligibility.js';
import { aggregateEligibilityTierCounts } from '../src/lib/mismatch-support-stats.js';
import { MISMATCH_HIT_WIDTH, MISMATCH_VISIBLE_LINE_WIDTH } from '../src/lib/mismatch-layer-constants.js';

test('diagnostic hit layer width exceeds visible diagnostic line', () => {
  assert.ok(MISMATCH_HIT_WIDTH > MISMATCH_VISIBLE_LINE_WIDTH);
});

test('insufficient evidence diagnostic card is non-actionable', () => {
  const html = formatMismatchDiagnosticCardHtml({
    classification: 'insufficient_evidence',
    osm_id: '1',
    gate_failures: ['min_frames', 'min_section_length'],
    vehicle_frames: 4,
    section_length_m: 12,
    evaluation_scope: 'lane_edge_surface',
    global_surface_accepted: false,
    local_surface_accepted: true,
    confidence: 0.2,
    sensitivity_stable: false,
  });
  assert.match(html, /Not enough evidence to suggest a map change/);
  assert.match(html, /min_frames/);
  assert.match(html, /min_section_length/);
  assert.doesNotMatch(html, /Accept<\/button>/);
});

test('geometry capable does not imply support eligible', () => {
  const elig = {
    centreline_comparison_eligible: true,
    lane_edge_eligible: true,
  };
  const section = {
    frame_count: 3,
    section_length_m: 10,
    median_heading_diff_deg: 5,
    lane_edge_eligible: true,
    unmatched_divider_rate: 0,
    heading_diffs: [5],
  };
  const tiers = computeEligibilityTiers(elig, section, 'insufficient_evidence');
  assert.equal(tiers.geometry_capable_lane_edge, true);
  assert.equal(tiers.support_eligible_lane_edge, false);
  assert.ok(supportGatesFailed(section).includes('min_frames'));
});

test('click priority order documented in map-selection', () => {
  const src = fs.readFileSync(new URL('../src/public/map-selection.js', import.meta.url), 'utf8');
  const start = src.indexOf('return function handleMapClick');
  const body = src.slice(start, start + 2800);
  const candIdx = body.indexOf('tryMismatchCandidateClick');
  const obsIdx = body.indexOf('handleObservationEvidenceClick');
  const diagIdx = body.indexOf('tryMismatchNonCandidateClick');
  const compIdx = body.indexOf('comparisonClickLayerIds');
  const roadsIdx = body.indexOf('DETAILED_FILL_LAYER_IDS');
  assert.ok(candIdx >= 0 && obsIdx > candIdx && diagIdx > obsIdx && compIdx > diagIdx && roadsIdx > compIdx);
});

test('tier aggregate counts overlaps', () => {
  const rows = [
    {
      geometry_capable_centreline: true,
      geometry_capable_lane_edge: true,
      support_eligible_centreline: false,
      support_eligible_lane_edge: false,
      actionable_candidate: false,
    },
    {
      geometry_capable_centreline: true,
      geometry_capable_lane_edge: false,
      support_eligible_centreline: true,
      support_eligible_lane_edge: false,
      actionable_candidate: false,
    },
  ];
  const c = aggregateEligibilityTierCounts(rows);
  assert.equal(c.geometry_capable_lane_edge, 1);
  assert.equal(c.geometry_capable_centreline, 2);
  assert.equal(c.support_eligible_either, 1);
  assert.equal(c.geometry_capable_support_ineligible, 1);
});

test('mismatch layers place hit targets on top', () => {
  const src = fs.readFileSync(new URL('../src/public/mismatch-layers.js', import.meta.url), 'utf8');
  assert.match(src, /repositionMismatchHitLayers/);
  assert.match(src, /addHit/);
});
