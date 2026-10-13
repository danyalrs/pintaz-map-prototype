import { classifyOsmWayTransition, CONTINUATION_CLASSES } from './continuation.js';
import { buildSafeTransitionGraph, chainStats, osmToLogicalRoadMap } from './logical-chains.js';

export const TOLERANCE_GRID_M = [0, 0.25, 0.5, 1.0];
export const HEADING_GRID_DEG = [10, 20, 30, 45];

const UNSAFE_CLASSES = new Set([
  'ambiguous_junction',
  'parallel_carriageway_risk',
  'ramp_or_link_transition',
  'roundabout_transition',
  'grade_separation_mismatch',
]);

export function runParameterSweep(observedPairs, wayStore, safetyTaggedPairs = new Set()) {
  const results = [];
  for (const toleranceM of TOLERANCE_GRID_M) {
    for (const maxHeadingDeg of HEADING_GRID_DEG) {
      const params = { toleranceM, maxHeadingDeg };
      const rejectedByReason = Object.fromEntries(CONTINUATION_CLASSES.map((c) => [c, 0]));
      let candidateTransitions = 0;
      let safeUnique = 0;
      let ambiguous = 0;
      let safetyControlFailures = 0;

      for (const { from_osm_id, to_osm_id } of observedPairs) {
        const v = classifyOsmWayTransition(from_osm_id, to_osm_id, wayStore, params);
        candidateTransitions += 1;
        rejectedByReason[v.classification] = (rejectedByReason[v.classification] || 0) + 1;
        if (v.classification === 'safe_unique_continuation') safeUnique += 1;
        if (v.classification === 'ambiguous_junction' || v.classification === 'parallel_carriageway_risk') {
          ambiguous += 1;
        }
        const key = `${from_osm_id}->${to_osm_id}`;
        if (safetyTaggedPairs.has(key) && v.classification === 'safe_unique_continuation') {
          safetyControlFailures += 1;
        }
        if (UNSAFE_CLASSES.has(v.classification) && safetyTaggedPairs.has(key)) {
          safetyControlFailures += 1;
        }
      }

      const { edges } = buildSafeTransitionGraph(observedPairs, wayStore, params);
      const osmMap = osmToLogicalRoadMap(edges);
      const stats = chainStats(edges, osmMap);
      const junctionCrossings = edges.filter((e) => e.reasons?.length === 0).length;
      const parallelRisks = rejectedByReason.parallel_carriageway_risk || 0;
      const gradeRisks = rejectedByReason.grade_separation_mismatch || 0;
      const unsafeJoin = safetyControlFailures > 0;

      results.push({
        tolerance_m: toleranceM,
        max_heading_deg: maxHeadingDeg,
        candidate_transitions: candidateTransitions,
        safe_unique_transitions: safeUnique,
        ambiguous_transitions: ambiguous,
        rejected_by_reason: rejectedByReason,
        logical_chains_formed: stats.logical_chain_count,
        max_chain_member_count: stats.max_chain_member_count,
        chains_crossing_junctions: junctionCrossings,
        parallel_carriageway_risks: parallelRisks,
        grade_separation_risks: gradeRisks,
        safety_control_failures: safetyControlFailures,
        parameter_set_unsafe: unsafeJoin,
      });
    }
  }
  return results;
}

export function selectTightestSafeCombo(sweepResults) {
  const safe = sweepResults.filter((r) => !r.parameter_set_unsafe && r.safe_unique_transitions > 0);
  if (!safe.length) return null;
  safe.sort((a, b) => {
    if (a.tolerance_m !== b.tolerance_m) return a.tolerance_m - b.tolerance_m;
    return a.max_heading_deg - b.max_heading_deg;
  });
  return safe[0];
}
