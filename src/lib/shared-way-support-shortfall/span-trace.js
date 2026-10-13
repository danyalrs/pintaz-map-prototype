import { reconstructPairSpans } from '../bukit-overlap-multi-drive-analysis/shared-spans.js';
import { runPerDriveMatching } from '../bukit-overlap-multi-drive-analysis/per-drive-matching.js';
import { perDriveBinSummaries } from '../bukit-overlap-multi-drive-analysis/bin-evidence.js';
import { perDonglePassesGates, combinedSupport } from '../bukit-overlap-multi-drive-analysis/classify-spans.js';
import { TARGET_OSM_WAY_ID, SELECTED_CONTRIBUTION, PRODUCTION_SUPPORT } from './config.js';
import { median } from '../geo-segment.js';

function binSet(records, binSize) {
  return new Set(records.map((r) => Math.floor(r.chain_s / binSize)));
}

export function buildMatchingForRoutes(dataDir) {
  const active = runPerDriveMatching('active', null, dataDir);
  const d005 = runPerDriveMatching('drive-005', 'drive-005', dataDir);
  return { active, d005 };
}

export function spansOnTargetWay(active, d005, metaActive, metaD005) {
  const all = reconstructPairSpans(active, d005, metaActive, metaD005, {
    maxBinGapM: SELECTED_CONTRIBUTION.maxBinGapM,
  });
  return all.filter((s) => String(s.osm_id) === TARGET_OSM_WAY_ID && !s.classification_hint);
}

export function enrichSpan(span) {
  const binSize = SELECTED_CONTRIBUTION.binSizeM;
  const activeRecs = span.per_route?.active?.records || [];
  const d005Recs = span.per_route?.['drive-005']?.records || [];
  const activeBins = binSet(activeRecs, binSize);
  const d005Bins = binSet(d005Recs, binSize);
  const sharedBins = [...activeBins].filter((b) => d005Bins.has(b));
  const gates = perDonglePassesGates(span, {
    minFramesPerDongle: SELECTED_CONTRIBUTION.minFramesPerDongle,
    minLengthPerDongleM: SELECTED_CONTRIBUTION.minLengthPerDongleM,
  });
  const support = combinedSupport(span, {
    minFrames: PRODUCTION_SUPPORT.minFrames,
    minSectionLengthM: PRODUCTION_SUPPORT.minContinuousLengthM,
    maxHeadingDiffDeg: 25,
  });
  return {
    ...span,
    osm_id: TARGET_OSM_WAY_ID,
    continuous_length_m: span.shared_length_m,
    active_frames: span.per_route?.active?.frames ?? 0,
    drive_005_frames: span.per_route?.['drive-005']?.frames ?? 0,
    active_bins: [...activeBins].sort((a, b) => a - b),
    drive_005_bins: [...d005Bins].sort((a, b) => a - b),
    shared_bins: sharedBins.sort((a, b) => a - b),
    active_lane_obs: span.per_route?.active?.lane_obs ?? 0,
    drive_005_lane_obs: span.per_route?.['drive-005']?.lane_obs ?? 0,
    active_edge_obs: span.per_route?.active?.edge_obs ?? 0,
    drive_005_edge_obs: span.per_route?.['drive-005']?.edge_obs ?? 0,
    direction_group: span.direction_sign,
    residuals: {
      active_median_centreline_m: span.per_route?.active?.median_centreline_residual_m,
      drive_005_median_centreline_m: span.per_route?.['drive-005']?.median_centreline_residual_m,
      active_median_heading_deg: span.per_route?.active?.median_heading_diff_deg,
      drive_005_median_heading_deg: span.per_route?.['drive-005']?.median_heading_diff_deg,
    },
    contribution_gates_passed: gates,
    production_support_gates: support,
    disjoint_coverage_flag: span.disjoint_coverage,
    evidence: perDriveBinSummaries(span, binSize),
  };
}

export function gapsBetweenSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.span_start_s - b.span_start_s);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.direction_sign !== prev.direction_sign) continue;
    const gapLen = cur.span_start_s - prev.span_end_s;
    if (gapLen <= 0) continue;
    gaps.push({
      previous_span_end_s: prev.span_end_s,
      next_span_start_s: cur.span_start_s,
      gap_length_m: gapLen,
      direction_sign: cur.direction_sign,
    });
  }
  return gaps;
}

export function overlapSummary(spans) {
  const lengths = spans.map((s) => s.shared_length_m || 0);
  return {
    span_count: spans.length,
    total_separated_overlap_m: lengths.reduce((a, b) => a + b, 0),
    longest_continuous_overlap_m: lengths.length ? Math.max(...lengths) : 0,
    median_span_length_m: median(lengths),
  };
}
