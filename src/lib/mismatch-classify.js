import { median, percentile } from './geo-segment.js';
import { computeMismatchConfidence } from './mismatch-confidence.js';
import { resolveDiagnosticClassification } from './mismatch-eligibility.js';

export const TOLERANCE_GRID_M = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];

export const DEFAULT_PARAMS = {
  residualToleranceM: 1.0,
  minFrames: 8,
  minSectionLengthM: 25,
  minBothEdgeFrames: 3,
  maxUnmatchedDividerRate: 0.35,
  maxHeadingDiffDeg: 25,
  minCenterlineShiftM: 0.45,
  minDisplayWidthDiffM: 0.75,
};

function mandatorySupportGatesFailed(section, params) {
  const reasons = [];
  if (section.frame_count < params.minFrames) reasons.push('min_frames');
  if (section.section_length_m < params.minSectionLengthM) reasons.push('min_section_length');
  if (section.median_heading_diff_deg > params.maxHeadingDiffDeg) reasons.push('heading_disagreement');
  if (section.lane_edge_eligible && section.unmatched_divider_rate > params.maxUnmatchedDividerRate) {
    reasons.push('high_unmatched_divider_rate');
  }
  return reasons;
}

function classifyAtTolerance(section, params) {
  const g = section.gate_failures || [];
  if (g.includes('outside_coverage')) return 'not_evaluated';
  if (g.includes('ambiguous_parallel_road')) return 'ambiguous_parallel_road';
  if (g.includes('ambiguous_junction_or_flyover')) return 'ambiguous_junction_or_flyover';

  const laneEdge = section.lane_edge_eligible;
  const centreline = section.centreline_comparison_eligible;

  if (!laneEdge && !centreline) {
    return resolveDiagnosticClassification(section) || 'unsupported_osm_geometry';
  }

  const support = mandatorySupportGatesFailed(section, params);
  if (support.length) return 'insufficient_evidence';

  const shift = section.median_common_centre_shift_m;
  const shiftedDiv = section.median_p90_shifted_divider_residual_m;
  const rawDiv = section.median_p90_raw_divider_residual_m;
  const span = section.median_observed_span_m;
  const displayW = section.derived_display_width_m;
  const bothEdge = section.frames_with_both_edges >= params.minBothEdgeFrames;

  if (laneEdge && !section.osm_lane_count && bothEdge && section.lane_obs_count >= 6) {
    const spanStable = span != null && section.span_stability > 0.6;
    if (spanStable && section.frame_count >= params.minFrames) {
      return 'osm_lane_metadata_missing';
    }
  }

  if (
    laneEdge &&
    section.osm_lane_count &&
    bothEdge &&
    span != null &&
    displayW != null &&
    Math.abs(span - displayW) - Math.abs(shift || 0) > params.minDisplayWidthDiffM &&
    shiftedDiv != null &&
    shiftedDiv <= params.residualToleranceM
  ) {
    return 'possible_display_width_difference';
  }

  if (
    centreline &&
    shift != null &&
    Math.abs(shift) >= params.minCenterlineShiftM &&
    bothEdge &&
    !g.includes('ambiguous_parallel_road')
  ) {
    if (laneEdge && rawDiv != null && rawDiv <= params.residualToleranceM * 1.5 && section.frames_with_lane_divider_matches >= 3) {
      return 'possible_centerline_offset';
    }
    if (!laneEdge) {
      return 'possible_centerline_offset';
    }
  }

  if (
    laneEdge &&
    section.osm_lane_count &&
    bothEdge &&
    !section.partial_cross_section &&
    section.inferred_lane_structure_mismatch &&
    section.sensitivity_lane_stable
  ) {
    return 'possible_lane_count_mismatch';
  }

  if (
    laneEdge &&
    rawDiv != null &&
    rawDiv <= params.residualToleranceM &&
    (shift == null || Math.abs(shift) < params.minCenterlineShiftM)
  ) {
    return 'consistent_with_osm_lanes';
  }

  if (centreline && bothEdge && shift != null && Math.abs(shift) < params.minCenterlineShiftM) {
    return 'consistent_with_osm_lanes';
  }

  return 'insufficient_evidence';
}

export function runSensitivityClassification(section, params = DEFAULT_PARAMS) {
  const byTolerance = {};
  for (const tol of TOLERANCE_GRID_M) {
    const p = { ...params, residualToleranceM: tol };
    byTolerance[tol] = classifyAtTolerance(section, p);
  }
  const base = classifyAtTolerance(section, params);
  const actionable = [
    'possible_lane_count_mismatch',
    'possible_centerline_offset',
    'possible_display_width_difference',
    'osm_lane_metadata_missing',
  ];
  let stable = true;
  if (actionable.includes(base)) {
    const neighbours = TOLERANCE_GRID_M.filter((t) => Math.abs(t - params.residualToleranceM) <= 0.5);
    stable = neighbours.every((t) => byTolerance[t] === base);
  }
  return { classification: base, by_tolerance: byTolerance, sensitivity_stable: stable };
}

export function finalizeSectionMetrics(aggregates) {
  const rawDiv = aggregates.raw_divider_residuals || [];
  const shiftedDiv = aggregates.shifted_divider_residuals || [];
  const leftEdge = aggregates.left_edge_residuals || [];
  const rightEdge = aggregates.right_edge_residuals || [];
  const spans = aggregates.observed_spans || [];
  const shifts = aggregates.centre_shifts || [];

  return {
    ...aggregates,
    median_p90_raw_divider_residual_m: percentile(rawDiv, 90),
    median_p90_shifted_divider_residual_m: percentile(shiftedDiv, 90),
    median_raw_divider_residual_m: median(rawDiv),
    median_p90_left_edge_residual_m: percentile(leftEdge, 90),
    median_p90_right_edge_residual_m: percentile(rightEdge, 90),
    median_observed_span_m: median(spans),
    median_common_centre_shift_m: median(shifts),
    unmatched_divider_rate:
      aggregates.lane_obs_count > 0 ? aggregates.unmatched_lane_obs / aggregates.lane_obs_count : 1,
    span_stability:
      spans.length >= 3
        ? 1 - (percentile(spans, 90) - percentile(spans, 10)) / Math.max(percentile(spans, 50), 1)
        : 0,
    median_heading_diff_deg:
      aggregates.median_heading_diff_deg ?? median(aggregates.heading_diffs) ?? 999,
  };
}

export function classifySection(section, params = DEFAULT_PARAMS) {
  const metrics = finalizeSectionMetrics(section);
  const sens = runSensitivityClassification(metrics, params);
  const conf = computeMismatchConfidence({
    frameCount: metrics.frame_count,
    sectionLengthM: metrics.section_length_m,
    headingAgreement: metrics.median_heading_diff_deg,
    temporalContinuity: metrics.temporal_continuity,
    bothEdgeFrameRate: metrics.frames_with_both_edges / Math.max(1, metrics.frame_count),
    dividerMatchStability: 1 - metrics.unmatched_divider_rate,
    spanStability: metrics.span_stability,
    sensitivityStable: sens.sensitivity_stable,
    junctionPenalty: metrics.junction_ambiguity ? 1 : 0,
    parallelPenalty: metrics.gate_failures?.includes('ambiguous_parallel_road') ? 1 : 0,
    partialCrossPenalty: metrics.partial_cross_section ? 1 : 0,
    displayEstimatePenalty: metrics.road_width_source === 'lane_count_display_estimate' ? 0.5 : 0,
  });
  return {
    ...metrics,
    classification: sens.classification,
    sensitivity: sens,
    confidence: conf.score,
    confidence_detail: conf,
    classification_reasons: metrics.gate_failures || [],
  };
}
