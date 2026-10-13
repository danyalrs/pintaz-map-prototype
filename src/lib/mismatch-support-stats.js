import { percentile } from './geo-segment.js';
import { DEFAULT_PARAMS } from './mismatch-classify.js';
import { isActionableMismatch } from './mismatch-ui-groups.js';
import { supportGatesFailed } from './mismatch-eligibility.js';

function distStats(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) {
    return { min: null, median: null, p90: null, max: null };
  }
  return {
    min: sorted[0],
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1],
  };
}

const AMBIGUITY_HEADING_GATES = new Set([
  'heading_disagreement',
  'ambiguous_parallel_road',
  'ambiguous_junction_or_flyover',
]);

/**
 * Compact support distributions for diagnosis (does not change gates).
 */
export function computeSupportDistributions(sections, params = DEFAULT_PARAMS) {
  const frames = [];
  const lengths = [];
  const laneObs = [];
  const edgeObs = [];
  let passMinFramesOnly = 0;
  let passMinLengthOnly = 0;
  let passBothSupport = 0;
  let failAmbiguityOrHeading = 0;
  let geometryCapableSupportIneligible = 0;

  for (const s of sections) {
    frames.push(s.matched_pose_count ?? s.frame_count);
    lengths.push(s.section_length_m);
    laneObs.push(s.lane_observations ?? s.lane_obs_count ?? 0);
    edgeObs.push(s.edge_observations ?? s.edge_obs_count ?? 0);

    const gates = s.gate_failures || [];
    const failsFrames = gates.includes('min_frames');
    const failsLen = gates.includes('min_section_length');
    if (!failsFrames && failsLen) passMinFramesOnly += 1;
    if (failsFrames && !failsLen) passMinLengthOnly += 1;
    if (!failsFrames && !failsLen) passBothSupport += 1;
    if (gates.some((g) => AMBIGUITY_HEADING_GATES.has(g))) failAmbiguityOrHeading += 1;

    const locallyUsable =
      s.locally_usable ?? (s.geometry_capable_centreline || s.geometry_capable_lane_edge);
    const supportOk =
      (s.support_eligible_centreline || s.support_eligible_lane_edge) ??
      (locallyUsable && supportGatesFailed(s, params).length === 0);
    if (locallyUsable && !supportOk) geometryCapableSupportIneligible += 1;
  }

  return {
    matched_frames: distStats(frames),
    section_length_m: distStats(lengths),
    lane_observations: distStats(laneObs),
    edge_observations: distStats(edgeObs),
    pass_min_frames_only: passMinFramesOnly,
    pass_min_section_length_only: passMinLengthOnly,
    pass_min_frames_and_length: passBothSupport,
    fail_ambiguity_or_heading_gates: failAmbiguityOrHeading,
    geometry_capable_support_ineligible: geometryCapableSupportIneligible,
  };
}

export function aggregateEligibilityTierCounts(sectionTiers) {
  const c = {
    geometry_capable_centreline: 0,
    geometry_capable_lane_edge: 0,
    centreline_geometry_only: 0,
    support_eligible_centreline: 0,
    support_eligible_lane_edge: 0,
    support_eligible_either: 0,
    actionable_candidate: 0,
    geometry_capable_support_ineligible: 0,
  };
  for (const t of sectionTiers) {
    if (t.geometry_capable_centreline) c.geometry_capable_centreline += 1;
    if (t.geometry_capable_lane_edge) c.geometry_capable_lane_edge += 1;
    if (t.geometry_capable_centreline && !t.geometry_capable_lane_edge) c.centreline_geometry_only += 1;
    if (t.support_eligible_centreline) c.support_eligible_centreline += 1;
    if (t.support_eligible_lane_edge) c.support_eligible_lane_edge += 1;
    if (t.support_eligible_centreline || t.support_eligible_lane_edge) c.support_eligible_either += 1;
    if (t.actionable_candidate) c.actionable_candidate += 1;
    const geomUsable = t.geometry_capable_centreline || t.geometry_capable_lane_edge;
    if (geomUsable && !t.support_eligible_centreline && !t.support_eligible_lane_edge) {
      c.geometry_capable_support_ineligible += 1;
    }
  }
  return c;
}

export function isActionableClassification(classification) {
  return isActionableMismatch(classification);
}
