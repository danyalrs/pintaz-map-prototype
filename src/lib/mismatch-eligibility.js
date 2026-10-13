import { median } from './geo-segment.js';
import { DEFAULT_PARAMS } from './mismatch-classify.js';
import { isActionableMismatch } from './mismatch-ui-groups.js';

/** Classifier-aligned support gates (geometry-capable ≠ support-eligible). */
export function supportGatesFailed(section, params = DEFAULT_PARAMS) {
  const reasons = [];
  if (section.frame_count < params.minFrames) reasons.push('min_frames');
  if (section.section_length_m < params.minSectionLengthM) reasons.push('min_section_length');
  const heading =
    section.median_heading_diff_deg ?? median(section.heading_diffs) ?? 999;
  if (heading > params.maxHeadingDiffDeg) reasons.push('heading_disagreement');
  if (section.lane_edge_eligible && section.unmatched_divider_rate > params.maxUnmatchedDividerRate) {
    reasons.push('high_unmatched_divider_rate');
  }
  return reasons;
}

export function computeEligibilityTiers(elig, section, classification) {
  const geometry_capable_centreline = !!elig.centreline_comparison_eligible;
  const geometry_capable_lane_edge = !!elig.lane_edge_eligible;
  const supportFails = supportGatesFailed(section);
  const support_eligible_centreline = geometry_capable_centreline && supportFails.length === 0;
  const support_eligible_lane_edge = geometry_capable_lane_edge && supportFails.length === 0;
  const actionable_candidate = isActionableMismatch(classification);
  return {
    geometry_capable_centreline,
    geometry_capable_lane_edge,
    support_eligible_centreline,
    support_eligible_lane_edge,
    actionable_candidate,
    locally_usable_geometry: geometry_capable_centreline || geometry_capable_lane_edge,
  };
}

/**
 * Granular gate assessment — multiple failures preserved; no collapse to a single code.
 */
export function assessEligibility({
  outsideCoverage,
  globalSurfaceAccepted,
  globalGeometryStatus,
  localSurfaceAccepted,
  localSurfaceRejectionReason,
  headingDiffs,
  junctionAmbiguity,
  parallelMatcherFlag,
  frameCount,
  sectionLengthM,
}) {
  const gate_failures = [];
  const gate_failure_details = {};

  if (outsideCoverage) gate_failures.push('outside_coverage');

  if (!globalSurfaceAccepted) {
    gate_failures.push('global_surface_not_accepted');
    gate_failure_details.global_geometry_status = globalGeometryStatus || 'unknown';
  }

  if (!localSurfaceAccepted && !globalSurfaceAccepted) {
    gate_failures.push('local_surface_rejected');
    gate_failure_details.local_surface_rejection_reason = localSurfaceRejectionReason || 'not_validated';
  }

  const medHeading = median(headingDiffs) ?? 999;
  if (medHeading > DEFAULT_PARAMS.maxHeadingDiffDeg) {
    gate_failures.push('heading_disagreement');
  }
  if (parallelMatcherFlag) {
    gate_failures.push('ambiguous_parallel_road');
  }
  if (junctionAmbiguity) {
    gate_failures.push('ambiguous_junction_or_flyover');
  }

  if (frameCount < DEFAULT_PARAMS.minFrames) gate_failures.push('min_frames');
  if (sectionLengthM < DEFAULT_PARAMS.minSectionLengthM) gate_failures.push('min_section_length');

  const inCorridor = !outsideCoverage;
  const noParallel = !gate_failures.includes('ambiguous_parallel_road');
  const noJunction = !gate_failures.includes('ambiguous_junction_or_flyover');
  const headingOk = medHeading <= DEFAULT_PARAMS.maxHeadingDiffDeg;

  const centreline_comparison_eligible =
    inCorridor && noParallel && noJunction && headingOk;

  const lane_edge_eligible =
    centreline_comparison_eligible &&
    (globalSurfaceAccepted || localSurfaceAccepted);

  let evaluation_scope = 'not_evaluated';
  if (outsideCoverage) evaluation_scope = 'outside_corridor';
  else if (lane_edge_eligible) evaluation_scope = 'lane_edge_surface';
  else if (centreline_comparison_eligible) evaluation_scope = 'centreline_only';
  else if (inCorridor) evaluation_scope = 'diagnostic_in_corridor';

  return {
    gate_failures,
    gate_failure_details,
    median_heading_diff_deg: medHeading,
    centreline_comparison_eligible,
    lane_edge_eligible,
    geometry_capable_centreline: centreline_comparison_eligible,
    geometry_capable_lane_edge: lane_edge_eligible,
    evaluation_scope,
    locally_usable: lane_edge_eligible || centreline_comparison_eligible,
  };
}

/**
 * Display classification priority — parallel/junction not masked by geometry failures.
 */
export function resolveDiagnosticClassification(section) {
  const g = section.gate_failures || [];
  if (g.includes('outside_coverage')) return 'not_evaluated';
  if (g.includes('ambiguous_parallel_road')) return 'ambiguous_parallel_road';
  if (g.includes('ambiguous_junction_or_flyover')) return 'ambiguous_junction_or_flyover';
  if (g.includes('min_frames') || g.includes('min_section_length')) return 'insufficient_evidence';
  if (g.includes('heading_disagreement')) return 'insufficient_evidence';
  if (g.includes('local_surface_rejected') && !section.centreline_comparison_eligible) {
    return 'unsupported_osm_geometry';
  }
  if (g.includes('global_surface_not_accepted') && !section.lane_edge_eligible && !section.centreline_comparison_eligible) {
    return 'unsupported_osm_geometry';
  }
  if (!section.lane_edge_eligible && !section.centreline_comparison_eligible) {
    return 'unsupported_osm_geometry';
  }
  return null;
}
