import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { signedLateralM, pointInPolygon } from '../src/lib/mismatch-projection.js';
import { matchDividersMonotonic, estimateCommonCentreShift } from '../src/lib/mismatch-divider-match.js';
import { classifySection, DEFAULT_PARAMS, TOLERANCE_GRID_M } from '../src/lib/mismatch-classify.js';
import { computeMismatchConfidence } from '../src/lib/mismatch-confidence.js';
import { isActionableMismatch, ACTIONABLE_MISMATCH } from '../src/lib/mismatch-ui-groups.js';
import { buildOsmServerMismatchV1 } from '../src/lib/mismatch-build.js';
import { applyMismatchDecision, loadMismatchDecisions } from '../src/lib/mismatch-decisions.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import { prepareUpdatePreviewFromRaw, PAGE1_EXPECTED } from '../src/lib/update-preview-prepare.js';
import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';
import {
  createIsolatedMapsReadFixture,
  cleanupIsolatedMapsReadFixture,
  withIsolatedMapsReadRoot,
} from './helpers/isolated-maps-read-fixture.js';
import { summaryPath, surfacesPath } from '../src/lib/lane-baseline-paths.js';
import { sectionResultsPath, mismatchSummaryPath } from '../src/lib/mismatch-paths.js';
import { NOT_ACTIONABLE_MSG } from '../src/lib/mismatch-routes.js';

test('road-relative lateral sign: right positive', () => {
  const r = signedLateralM(101.7102, 3.147, 0, 101.71, 3.147);
  assert.ok(r.lateralM > 0.1);
  const l = signedLateralM(101.7098, 3.147, 0, 101.71, 3.147);
  assert.ok(l.lateralM < -0.1);
});

test('monotonic divider matching no duplicate obs', () => {
  const { pairs, unmatchedObs } = matchDividersMonotonic([-1, 1.2, 3.1], [-3, 0, 3], 2);
  assert.ok(pairs.length >= 2);
  const obsIdx = pairs.map((p) => p.obsIndex);
  assert.equal(new Set(obsIdx).size, obsIdx.length, 'one obs per divider match');
  const divIdx = pairs.map((p) => p.divIndex);
  assert.equal(new Set(divIdx).size, divIdx.length, 'one divider per obs match');
});

test('common centre shift from both edges', () => {
  const shift = estimateCommonCentreShift([-4.1], [4.2]);
  assert.ok(Math.abs(shift) < 0.2);
});

test('partial cross-section fails lane-count mismatch gates', () => {
  const r = classifySection({
    gate_failures: [],
    lane_edge_eligible: true,
    centreline_comparison_eligible: true,
    frame_count: 12,
    section_length_m: 40,
    heading_diffs: [5, 8],
    unmatched_lane_obs: 1,
    lane_obs_count: 10,
    partial_cross_section: true,
    frames_with_both_edges: 1,
    osm_lane_count: 3,
    inferred_lane_structure_mismatch: true,
    sensitivity_lane_stable: true,
    raw_divider_residuals: [0.2, 0.3],
    shifted_divider_residuals: [0.2],
    road_width_source: 'lane_count_display_estimate',
    derived_display_width_m: 9.6,
    temporal_continuity: 1,
    junction_ambiguity: false,
    parallel_ambiguity: false,
  });
  assert.notEqual(r.classification, 'possible_lane_count_mismatch');
});

test('display width classification labels estimate', () => {
  const r = classifySection({
    gate_failures: [],
    lane_edge_eligible: true,
    centreline_comparison_eligible: true,
    frame_count: 15,
    section_length_m: 60,
    heading_diffs: [4],
    unmatched_lane_obs: 0,
    lane_obs_count: 20,
    partial_cross_section: false,
    frames_with_both_edges: 8,
    frames_with_lane_divider_matches: 6,
    osm_lane_count: 3,
    median_common_centre_shift_m: 0.1,
    median_observed_span_m: 11.5,
    derived_display_width_m: 9.6,
    raw_divider_residuals: [0.3, 0.4, 0.2],
    shifted_divider_residuals: [0.3, 0.2],
    left_edge_residuals: [0.5],
    right_edge_residuals: [0.4],
    road_width_source: 'lane_count_display_estimate',
    temporal_continuity: 1,
    junction_ambiguity: false,
    parallel_ambiguity: false,
    inferred_lane_structure_mismatch: false,
    sensitivity_lane_stable: false,
  });
  assert.ok(
    ['possible_display_width_difference', 'insufficient_evidence', 'consistent_with_osm_lanes'].includes(
      r.classification
    )
  );
});

test('confidence cannot override mandatory gate failure', () => {
  const r = classifySection({
    gate_failures: ['global_surface_not_accepted', 'local_surface_rejected'],
    lane_edge_eligible: false,
    centreline_comparison_eligible: false,
    frame_count: 50,
    section_length_m: 100,
    heading_diffs: [2],
    median_heading_diff_deg: 2,
    unmatched_lane_obs: 0,
    lane_obs_count: 40,
    temporal_continuity: 1,
    junction_ambiguity: false,
    parallel_ambiguity: false,
    partial_cross_section: false,
    raw_divider_residuals: [],
    shifted_divider_residuals: [],
  });
  assert.equal(r.classification, 'unsupported_osm_geometry');
  const c = computeMismatchConfidence({ frameCount: 50, sectionLengthM: 100 });
  assert.ok(c.score <= 1);
});

test('sensitivity grid documents all tolerances', () => {
  assert.deepEqual(TOLERANCE_GRID_M, [0.5, 0.75, 1.0, 1.5, 2.0, 3.0]);
});

test('outside corridor not_evaluated via gate', () => {
  const r = classifySection({
    gate_failures: ['outside_coverage'],
    lane_edge_eligible: false,
    centreline_comparison_eligible: false,
    frame_count: 5,
    section_length_m: 30,
    heading_diffs: [10],
    median_heading_diff_deg: 10,
    unmatched_lane_obs: 0,
    lane_obs_count: 0,
    temporal_continuity: 1,
    junction_ambiguity: false,
    parallel_ambiguity: false,
    partial_cross_section: true,
    raw_divider_residuals: [],
    shifted_divider_residuals: [],
  });
  assert.equal(r.classification, 'not_evaluated');
});

test('build mismatch deterministic and non-mutating', () => {
  const osm = localAreaGeojsonPath('bukit-bintang-imbi');
  const raw = RAW_SAMPLE_PATH;
  const laneSum = summaryPath('bukit-bintang-imbi');
  if (!fs.existsSync(osm) || !fs.existsSync(raw) || !fs.existsSync(laneSum)) return;
  const fixture = createIsolatedMapsReadFixture();
  try {
    const beforeOsm = crypto.createHash('sha256').update(fs.readFileSync(osm)).digest('hex');
    const beforeRaw = crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex');
    const beforeLane = crypto.createHash('sha256').update(fs.readFileSync(laneSum)).digest('hex');
    prepareUpdatePreviewFromRaw({ ...fixture.previewPaths, force: true, expected: PAGE1_EXPECTED });
    let a;
    let b;
    withIsolatedMapsReadRoot(fixture, () => {
      buildObservationOsmComparison({
        previewPath: fixture.previewPaths.previewPath,
        outputDir: fixture.comparisonOutputDir,
      });
      a = buildOsmServerMismatchV1({
        previewPath: fixture.previewPaths.previewPath,
        comparisonOutputDir: fixture.comparisonOutputDir,
        mismatchOutputDir: fixture.mismatchOutputDir,
      });
      b = buildOsmServerMismatchV1({
        previewPath: fixture.previewPaths.previewPath,
        comparisonOutputDir: fixture.comparisonOutputDir,
        mismatchOutputDir: fixture.mismatchOutputDir,
      });
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.summary.section_count, b.summary.section_count);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(osm)).digest('hex'), beforeOsm);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex'), beforeRaw);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(laneSum)).digest('hex'), beforeLane);
  } finally {
    cleanupIsolatedMapsReadFixture(fixture);
  }
});

test('output GeoJSON valid and sorted', () => {
  if (!fs.existsSync(sectionResultsPath())) return;
  const geo = JSON.parse(fs.readFileSync(sectionResultsPath(), 'utf8'));
  assert.equal(geo.type, 'FeatureCollection');
  const ids = geo.features.map((f) => f.properties.candidate_id);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted);
  for (const f of geo.features) {
    assert.ok(f.properties.classification);
    assert.ok(f.geometry);
  }
});

test('summary has no MAPS_READ_TOKEN', () => {
  if (!fs.existsSync(mismatchSummaryPath())) return;
  const t = fs.readFileSync(mismatchSummaryPath(), 'utf8');
  assert.doesNotMatch(t, /MAPS_READ_TOKEN=/);
  assert.doesNotMatch(t, /pk\.ey/);
});

test('decision isolation actionable only', () => {
  assert.equal(isActionableMismatch('consistent_with_osm_lanes'), false);
  assert.equal(isActionableMismatch('possible_centerline_offset'), true);
  for (const c of ACTIONABLE_MISMATCH) assert.ok(isActionableMismatch(c));
});

test('API rejects non-actionable decision', async () => {
  process.env.PINTAZ_TEST = '1';
  const http = await import('node:http');
  const { app } = await import('../src/server.js');
  if (!fs.existsSync(sectionResultsPath())) return;
  const geo = JSON.parse(fs.readFileSync(sectionResultsPath(), 'utf8'));
  const diag = geo.features.find((f) => f.properties.classification === 'insufficient_evidence');
  if (!diag) return;
  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/mismatch/v1/bukit-bintang-imbi/candidate/${diag.properties.candidate_id}/decision`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state: 'accepted' }),
          }
        );
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.match(body.error, new RegExp(NOT_ACTIONABLE_MSG.slice(0, 20)));
        server.close();
        resolve();
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.on('error', reject);
  });
});

test('mismatch sidebar controls in index', () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /OSM vs server mismatch/);
  assert.match(html, /mismatch-results-toggle/);
  assert.match(html, /mismatch-zero-candidates-hint/);
  assert.match(html, /Support eligible/);
  assert.match(html, /Locally usable geometry/);
});

test('point in polygon coverage helper', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  assert.equal(pointInPolygon(0.5, 0.5, ring), true);
  assert.equal(pointInPolygon(2, 2, ring), false);
});

test('atomic decision write', () => {
  const id = 'test_candidate_decision';
  applyMismatchDecision({
    candidateId: id,
    newState: 'rejected',
    sectionHash: 'abc',
    osmBaselineHash: 'def',
  });
  const store = loadMismatchDecisions();
  assert.equal(store.decisions[id].state, 'rejected');
});
