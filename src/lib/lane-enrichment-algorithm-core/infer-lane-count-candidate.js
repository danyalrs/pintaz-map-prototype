import { DECISION, HUMAN_REVIEW_REQUIRED, NEVER_AUTO_APPLY, LIMITS } from './constants.js';
import {
  detectStrongCompetingLaneCountHypotheses,
  perFrameLaneHypothesis,
  resolveRoadEdgeWindow,
  isHighQualityObservationFrame,
} from './per-frame-hypothesis.js';
import { CONFIDENCE_BAND, SUPPORT_TYPE, insufficientSemantics } from './result-semantics.js';

function perFrameLaneCounts(acceptedFrames) {
  const counts = [];
  for (const fr of acceptedFrames) {
    const hyp = perFrameLaneHypothesis(fr);
    if (!hyp) continue;
    counts.push({ frame_id: fr.frame_id, lanes: hyp.lanes });
  }
  return counts;
}

function passesSingleFrameStrictChecks(frameRecord, mode, leftEdge, rightEdge, width) {
  if (!isHighQualityObservationFrame(frameRecord)) return false;
  if ((frameRecord.road_edges || []).length < 2) return false;
  const sortedEdges = [...frameRecord.road_edges].sort((a, b) => a.lateral_m - b.lateral_m);
  if (sortedEdges[0].lateral_m > leftEdge + LIMITS.lateralAmbiguityToleranceM) return false;
  if (sortedEdges[sortedEdges.length - 1].lateral_m < rightEdge - LIMITS.lateralAmbiguityToleranceM) {
    return false;
  }
  const interiors = (frameRecord.lane_boundaries || [])
    .map((p) => p.lateral_m)
    .filter((v) => v > leftEdge + 0.4 && v < rightEdge - 0.4);
  const expectedInterior = Math.max(0, mode - 1);
  if (mode > 1 && interiors.length < expectedInterior) return false;
  const laneWidth = width / mode;
  if (laneWidth < LIMITS.minLaneWidthM || laneWidth > LIMITS.maxLaneWidthM) return false;
  const allLines = [...frameRecord.lane_boundaries, ...frameRecord.road_edges];
  if (!allLines.every((x) => (x.probability ?? 1) >= LIMITS.singleFrameMinConfidence)) return false;
  return true;
}

export function inferLaneCountCandidate({ consensus, frameEvidence, centrelineSection }) {
  const base = insufficientSemantics();

  const accepted = consensus.accepted_frames || [];
  const { lane_boundaries } = consensus;

  const edgeWindow = resolveRoadEdgeWindow(consensus, accepted);
  if (!edgeWindow) {
    return insufficientSemantics({ note: 'missing_stable_road_edges' });
  }
  const { leftEdge, rightEdge, edgeSource } = edgeWindow;
  const width = rightEdge - leftEdge;
  if (width < LIMITS.minRoadWidthM || width > LIMITS.maxRoadWidthM) {
    return insufficientSemantics({ note: 'implausible_road_width' });
  }

  if (accepted.length >= LIMITS.minClusterSupportFrames) {
    const competition = detectStrongCompetingLaneCountHypotheses(accepted);
    if (competition.competing) {
      return insufficientSemantics({
        note: 'strong_competing_lane_count_hypotheses',
        competing_lane_count_groups: competition.strong_groups,
      });
    }
  }

  const frameCounts = perFrameLaneCounts(accepted);
  if (!frameCounts.length) {
    return insufficientSemantics({ note: 'no_per_frame_intervals' });
  }
  const freq = new Map();
  for (const c of frameCounts) freq.set(c.lanes, (freq.get(c.lanes) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const [mode, modeCount] = sorted[0];
  const agreement = modeCount / frameCounts.length;
  if (
    accepted.length >= LIMITS.minClusterSupportFrames &&
    sorted.length > 1 &&
    sorted[1][1] / modeCount > 0.35
  ) {
    return insufficientSemantics({ note: 'conflicting_frame_lane_counts', competing: sorted });
  }
  const laneWidth = width / mode;
  if (laneWidth < LIMITS.minLaneWidthM || laneWidth > LIMITS.maxLaneWidthM) {
    return insufficientSemantics({ note: 'implausible_lane_width', implied_lane_width_m: laneWidth });
  }

  const interiorStable = lane_boundaries.filter(
    (c) => c.center_lateral_m > leftEdge + 0.5 && c.center_lateral_m < rightEdge - 0.5
  );
  const expectedInterior = Math.max(0, mode - 1);
  if (mode > 1 && edgeSource === 'temporal_cluster' && interiorStable.length < expectedInterior) {
    return insufficientSemantics({ note: 'interior_boundaries_not_stable_enough' });
  }
  if (mode > 1 && edgeSource === 'single_frame') {
    const fr0 = accepted[0];
    const interiors = (fr0.lane_boundaries || []).filter(
      (p) => p.lateral_m > leftEdge + 0.4 && p.lateral_m < rightEdge - 0.4
    );
    if (interiors.length < expectedInterior) {
      return insufficientSemantics({ note: 'single_frame_interior_boundaries_missing' });
    }
  }

  if (
    accepted.length === 1 &&
    edgeSource === 'single_frame' &&
    centrelineSection?.one_way === true &&
    !centrelineSection?.junction_nearby &&
    !centrelineSection?.merge_nearby
  ) {
    const fr0 = accepted[0];
    if (passesSingleFrameStrictChecks(fr0, mode, leftEdge, rightEdge, width) && agreement >= 1) {
      return {
        selected_lane_count: mode,
        decision_score: LIMITS.singleFrameReviewConfidence,
        confidence_band: CONFIDENCE_BAND.PROVISIONAL_SINGLE_FRAME,
        decision: DECISION.SINGLE_FRAME_REVIEW_CANDIDATE,
        human_review_required: HUMAN_REVIEW_REQUIRED,
        never_auto_apply: NEVER_AUTO_APPLY,
        support_type: SUPPORT_TYPE.SINGLE_FRAME,
        temporal_stability: false,
        road_edges: edgeSource === 'single_frame' ? fr0.road_edges : consensus.road_edges,
        interior_boundaries: fr0.lane_boundaries,
        implied_lane_width_m: Math.round(laneWidth * 100) / 100,
      };
    }
    return insufficientSemantics({ note: 'single_frame_strict_checks_failed', mode });
  }

  if (
    accepted.length >= LIMITS.minClusterSupportFrames &&
    agreement >= LIMITS.multiFrameConsensusFraction
  ) {
    const multiDecisionScore = Math.min(1, Math.round(agreement * 100) / 100);
    if (multiDecisionScore <= LIMITS.singleFrameReviewConfidence) {
      return insufficientSemantics({ note: 'weak_temporal_support', agreement, mode });
    }
    return {
      selected_lane_count: mode,
      decision_score: multiDecisionScore,
      confidence_band: CONFIDENCE_BAND.SUPPORTED_MULTI_FRAME,
      decision: DECISION.MULTI_FRAME_REVIEW_CANDIDATE,
      human_review_required: HUMAN_REVIEW_REQUIRED,
      never_auto_apply: NEVER_AUTO_APPLY,
      support_type: SUPPORT_TYPE.MULTI_FRAME,
      temporal_stability: true,
      road_edges: consensus.road_edges,
      interior_boundaries: interiorStable,
      implied_lane_width_m: Math.round(laneWidth * 100) / 100,
    };
  }

  return insufficientSemantics({ note: 'weak_temporal_support', agreement, mode });
}
