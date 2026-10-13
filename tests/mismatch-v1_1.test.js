import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateLocalSectionSurface, clipCentrelineToAlongRange } from '../src/lib/mismatch-local-geometry.js';
import { groupSectionsLegacyFrameGap, groupSectionsContiguous } from '../src/lib/mismatch-section-group.js';
import { assessEligibility, resolveDiagnosticClassification } from '../src/lib/mismatch-eligibility.js';
import { classifySection } from '../src/lib/mismatch-classify.js';
import { buildOsmServerMismatchV1 } from '../src/lib/mismatch-build.js';
import { localAreaGeojsonPath, FALLBACK_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import { prepareUpdatePreviewFromRaw, PAGE1_EXPECTED } from '../src/lib/update-preview-prepare.js';
import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';
import {
  createIsolatedMapsReadFixture,
  cleanupIsolatedMapsReadFixture,
  withIsolatedMapsReadRoot,
} from './helpers/isolated-maps-read-fixture.js';
import { summaryPath } from '../src/lib/lane-baseline-paths.js';
import { eligibilityAuditPath, mismatchSummaryPath, MISMATCH_AREA_ID } from '../src/lib/mismatch-paths.js';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';

function pose(osmId, idx, lon, lat, frameId, logTime) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      osm_id: osmId,
      pose_index: idx,
      frame_id: frameId,
      log_mono_time: logTime,
      bridge: false,
      tunnel: false,
    },
  };
}

test('legacy grouping is one pose per section for this sample', () => {
  const p = matchedPosesPath();
  if (!fs.existsSync(p)) return;
  const poses = JSON.parse(fs.readFileSync(p, 'utf8')).features;
  const legacy = groupSectionsLegacyFrameGap(poses);
  const modern = groupSectionsContiguous(poses);
  assert.equal(legacy.length, 127);
  assert.ok(modern.length < legacy.length, 'contiguous grouping merges poses on same way');
});

test('contiguous grouping does not merge across OSM ways', () => {
  const a = pose('1', 0, 101.71, 3.147, 1, 1e9);
  const b = pose('2', 1, 101.7101, 3.147, 2, 1.1e9);
  const sections = groupSectionsContiguous([a, b]);
  assert.equal(sections.length, 2);
});

test('globally rejected straight span can validate locally', () => {
  const coords = [
    [101.71, 3.147],
    [101.711, 3.147],
    [101.712, 3.147],
    [101.713, 3.147],
  ];
  const local = clipCentrelineToAlongRange(coords, 0, 80);
  const r = validateLocalSectionSurface({ highway: 'primary', lanes: '3' }, local);
  assert.equal(r.local_surface_accepted, true);
});

test('locally self-intersecting span remains rejected', () => {
  const bowtie = [
    [101.71, 3.147],
    [101.712, 3.149],
    [101.712, 3.147],
    [101.71, 3.149],
  ];
  const r = validateLocalSectionSurface({ highway: 'primary', lanes: '2' }, bowtie);
  assert.equal(r.local_surface_accepted, false);
  assert.ok(r.local_surface_rejection_reason);
});

test('centreline-only path cannot emit display-width candidate', () => {
  const r = classifySection({
    gate_failures: [],
    lane_edge_eligible: false,
    centreline_comparison_eligible: true,
    frame_count: 12,
    section_length_m: 40,
    heading_diffs: [5],
    median_heading_diff_deg: 5,
    unmatched_lane_obs: 0,
    lane_obs_count: 10,
    partial_cross_section: false,
    frames_with_both_edges: 5,
    frames_with_lane_divider_matches: 0,
    osm_lane_count: 3,
    median_common_centre_shift_m: 0,
    median_observed_span_m: 12,
    derived_display_width_m: 9.6,
    raw_divider_residuals: [],
    shifted_divider_residuals: [],
    left_edge_residuals: [0.5],
    right_edge_residuals: [0.4],
    road_width_source: 'lane_count_display_estimate',
    temporal_continuity: 1,
    junction_ambiguity: false,
    parallel_ambiguity: false,
    inferred_lane_structure_mismatch: false,
    sensitivity_lane_stable: false,
  });
  assert.notEqual(r.classification, 'possible_display_width_difference');
  assert.notEqual(r.classification, 'possible_lane_count_mismatch');
});

test('centreline offset blocked when parallel ambiguity gate fails', () => {
  const r = classifySection({
    gate_failures: ['ambiguous_parallel_road'],
    lane_edge_eligible: false,
    centreline_comparison_eligible: false,
    frame_count: 12,
    section_length_m: 40,
    heading_diffs: [5],
    median_heading_diff_deg: 5,
    unmatched_lane_obs: 0,
    lane_obs_count: 10,
    partial_cross_section: false,
    frames_with_both_edges: 8,
    frames_with_lane_divider_matches: 0,
    osm_lane_count: 3,
    median_common_centre_shift_m: 1.2,
    median_observed_span_m: 10,
    derived_display_width_m: 9.6,
    raw_divider_residuals: [0.2],
    shifted_divider_residuals: [0.2],
    temporal_continuity: 1,
    junction_ambiguity: false,
    parallel_ambiguity: true,
    inferred_lane_structure_mismatch: false,
    sensitivity_lane_stable: true,
  });
  assert.equal(r.classification, 'ambiguous_parallel_road');
  assert.notEqual(r.classification, 'possible_centerline_offset');
});

test('parallel failure not masked by geometry failure', () => {
  const c = resolveDiagnosticClassification({
    gate_failures: ['global_surface_not_accepted', 'ambiguous_parallel_road'],
    centreline_comparison_eligible: false,
    lane_edge_eligible: false,
  });
  assert.equal(c, 'ambiguous_parallel_road');
});

test('multiple gate failures preserved in audit', () => {
  if (!fs.existsSync(eligibilityAuditPath())) return;
  const audit = JSON.parse(fs.readFileSync(eligibilityAuditPath(), 'utf8'));
  const multi = audit.sections.filter((s) => (s.gate_failures?.length || 0) >= 2);
  assert.ok(multi.length > 0);
  assert.ok(Object.keys(audit.gate_counts).length > 1);
});

test('v1.1 rebuild hashes unchanged', () => {
  const osm = localAreaGeojsonPath('bukit-bintang-imbi');
  if (!fs.existsSync(osm)) return;
  const fixture = createIsolatedMapsReadFixture();
  try {
    const before = crypto.createHash('sha256').update(fs.readFileSync(osm)).digest('hex');
    if (fs.existsSync(RAW_SAMPLE_PATH)) {
      prepareUpdatePreviewFromRaw({ ...fixture.previewPaths, force: true, expected: PAGE1_EXPECTED });
      withIsolatedMapsReadRoot(fixture, () => {
        buildObservationOsmComparison({
          previewPath: fixture.previewPaths.previewPath,
          outputDir: fixture.comparisonOutputDir,
        });
        buildOsmServerMismatchV1({
          previewPath: fixture.previewPaths.previewPath,
          comparisonOutputDir: fixture.comparisonOutputDir,
          mismatchOutputDir: fixture.mismatchOutputDir,
        });
      });
    }
    const after = crypto.createHash('sha256').update(fs.readFileSync(osm)).digest('hex');
    assert.equal(before, after);
    if (fs.existsSync(RAW_SAMPLE_PATH)) {
      const rawBefore = crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex');
      const rawAfter = crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex');
      assert.equal(rawBefore, rawAfter);
    }
    const lane = summaryPath('bukit-bintang-imbi');
    if (fs.existsSync(lane)) {
      const lb = crypto.createHash('sha256').update(fs.readFileSync(lane)).digest('hex');
      assert.equal(lb, crypto.createHash('sha256').update(fs.readFileSync(lane)).digest('hex'));
    }
  } finally {
    cleanupIsolatedMapsReadFixture(fixture);
  }
});

test('zero actionable candidates is valid summary state', () => {
  if (!fs.existsSync(mismatchSummaryPath())) return;
  const s = JSON.parse(fs.readFileSync(mismatchSummaryPath(), 'utf8'));
  assert.equal(s.schema_version, 1.1);
  assert.ok(s.actionable_candidate_count >= 0);
  assert.ok(s.eligibility_tiers);
  assert.equal(s.eligibility_tiers.actionable_candidate, s.actionable_candidate_count);
  assert.ok(s.support_distributions?.matched_frames);
});

test('eligibility assess retains min_frames separately', () => {
  const e = assessEligibility({
    outsideCoverage: false,
    globalSurfaceAccepted: true,
    globalGeometryStatus: 'surface_and_dividers',
    localSurfaceAccepted: true,
    localSurfaceRejectionReason: null,
    headingDiffs: [10],
    junctionAmbiguity: false,
    parallelMatcherFlag: false,
    frameCount: 2,
    sectionLengthM: 5,
  });
  assert.ok(e.gate_failures.includes('min_frames'));
  assert.ok(e.gate_failures.includes('min_section_length'));
});

test('Kinrara mismatch API is scoped to Bukit only', async () => {
  process.env.PINTAZ_TEST = '1';
  const http = await import('node:http');
  const { app } = await import('../src/server.js');
  assert.notEqual(FALLBACK_LOCAL_AREA_ID, MISMATCH_AREA_ID);
  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/mismatch/v1/${FALLBACK_LOCAL_AREA_ID}/summary`);
        assert.equal(res.status, 404);
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

test('summary and audit contain no token material', () => {
  for (const p of [mismatchSummaryPath(), eligibilityAuditPath()]) {
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(t, /MAPS_READ_TOKEN=/);
    assert.doesNotMatch(t, /pk\.ey/);
  }
});
