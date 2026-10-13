import { ROUTE_VERDICT } from '../route-aware-lane-calibration-audit/constants.js';
import { POINT_ONLY_LANE_COUNT_STATEMENT } from './eligibility.js';
import {
  PAIR_SHORTLIST_STATUS,
  PHASE3_GEOMETRY_GATES,
  SHORTLIST_NOT_OSM_ENRICHMENT,
} from './phase3-constants.js';

const WAY_STATUS_PRIORITY = {
  [PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY]: 6,
  [PAIR_SHORTLIST_STATUS.NOT_GEOMETRY_ELIGIBLE]: 5,
  [PAIR_SHORTLIST_STATUS.NOT_QUALIFIED]: 4,
  [PAIR_SHORTLIST_STATUS.NOT_EVALUABLE]: 3,
  [PAIR_SHORTLIST_STATUS.INSUFFICIENT_COVERAGE]: 2,
  [PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING]: 1,
};

export function geometryEligibleForUnknownWay(coverageRow) {
  if (!coverageRow) return false;
  const g = PHASE3_GEOMETRY_GATES;
  if ((coverageRow.matched_pose_count ?? 0) < g.minPosesOnUnknownWay) return false;
  if ((coverageRow.median_distance_m ?? 99) > g.maxMedianDistanceM) return false;
  if ((coverageRow.median_heading_diff_deg ?? 180) > g.maxMedianHeadingDiffDeg) return false;
  if ((coverageRow.direction_compatible_fraction ?? 0) < g.minDirectionCompatibleFraction) return false;
  if ((coverageRow.continuous_covered_length_m ?? 0) < g.minContinuousCoveredLengthM) return false;
  return true;
}

export function routeScreenFromQualification(routeQual) {
  if (!routeQual) {
    return { screen: PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING, route_verdict: null };
  }
  if (routeQual.route_fetch_status === 'malformed_response') {
    return { screen: PAIR_SHORTLIST_STATUS.NOT_EVALUABLE, route_verdict: null, retryable: true };
  }
  if (routeQual.route_fetch_status === 'insufficient_route_coverage') {
    return { screen: PAIR_SHORTLIST_STATUS.INSUFFICIENT_COVERAGE, route_verdict: routeQual.route_verdict };
  }
  const v = routeQual.route_verdict;
  if (v === ROUTE_VERDICT.QUALIFIED) {
    return { screen: 'route_passes_labelled_screen', route_verdict: v, route_qualified: true };
  }
  if (v === ROUTE_VERDICT.NOT_QUALIFIED) {
    return { screen: PAIR_SHORTLIST_STATUS.NOT_QUALIFIED, route_verdict: v };
  }
  return { screen: PAIR_SHORTLIST_STATUS.NOT_EVALUABLE, route_verdict: v };
}

/**
 * Classify one unknown-lane OSM way × route pair (no lane-count inference).
 */
export function classifyUnknownLanePair(coverageRow, routeQual) {
  const poses = coverageRow?.matched_pose_count ?? 0;
  if (!coverageRow || poses < 1) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.INSUFFICIENT_COVERAGE,
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }
  if (poses < PHASE3_GEOMETRY_GATES.minPosesOnUnknownWay) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.INSUFFICIENT_COVERAGE,
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }

  const screen = routeScreenFromQualification(routeQual);
  if (screen.screen === PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING,
      route_verdict: null,
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }
  if (screen.screen === PAIR_SHORTLIST_STATUS.NOT_QUALIFIED) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.NOT_QUALIFIED,
      route_verdict: screen.route_verdict,
      disqualification_reasons: routeQual?.disqualification_reasons ?? [],
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }
  if (screen.screen === PAIR_SHORTLIST_STATUS.NOT_EVALUABLE) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.NOT_EVALUABLE,
      route_verdict: screen.route_verdict,
      disqualification_reasons: routeQual?.disqualification_reasons ?? [],
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }
  if (screen.screen === PAIR_SHORTLIST_STATUS.INSUFFICIENT_COVERAGE) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.INSUFFICIENT_COVERAGE,
      route_verdict: screen.route_verdict,
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }

  if (!screen.route_qualified) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.NOT_EVALUABLE,
      route_verdict: screen.route_verdict,
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }

  if (!geometryEligibleForUnknownWay(coverageRow)) {
    return {
      shortlist_status: PAIR_SHORTLIST_STATUS.NOT_GEOMETRY_ELIGIBLE,
      route_verdict: screen.route_verdict,
      point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
    };
  }

  return {
    shortlist_status: PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY,
    route_verdict: screen.route_verdict,
    route_qualified_for_future_geometry: true,
    point_only_limitation_note: POINT_ONLY_LANE_COUNT_STATEMENT,
  };
}

export function shortlistPairRankingScore(coverageRow, classification) {
  if (classification.shortlist_status !== PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY) return 0;
  return (
    (coverageRow.matched_pose_count ?? 0) * 3 +
    (coverageRow.continuous_covered_length_m ?? 0) / 8 +
    (coverageRow.direction_compatible_fraction ?? 0) * 10 -
    (coverageRow.median_distance_m ?? 0) * 0.3 -
    (coverageRow.median_heading_diff_deg ?? 0) * 0.08
  );
}

export function buildPairShortlistRows(wayRows, routeQualByRef) {
  const pairs = [];
  for (const row of wayRows) {
    const routeQual = routeQualByRef.get(row.route_ref);
    const classification = classifyUnknownLanePair(row, routeQual);
    pairs.push({
      route_ref: row.route_ref,
      dongle_ref: row.dongle_ref,
      osm_way_id: row.osm_way_id,
      matched_pose_count: row.matched_pose_count,
      median_distance_m: row.median_distance_m,
      median_heading_diff_deg: row.median_heading_diff_deg,
      direction_compatible_fraction: row.direction_compatible_fraction,
      continuous_covered_length_m: row.continuous_covered_length_m,
      shortlist_status: classification.shortlist_status,
      route_verdict: classification.route_verdict ?? routeQual?.route_verdict ?? null,
      route_qualification_evidence: routeQual
        ? {
            route_fetch_status: routeQual.route_fetch_status,
            eligible_labelled_ways: routeQual.eligible_labelled_ways,
            labelled_ways_on_route: routeQual.labelled_ways_on_route,
            held_out_single_best: routeQual.held_out_single_best,
            disqualification_reasons: routeQual.disqualification_reasons,
          }
        : null,
      shortlist_ranking_score: shortlistPairRankingScore(row, classification),
      selected_lane_count: null,
      point_only_limitation_note: classification.point_only_limitation_note,
    });
  }
  pairs.sort((a, b) => b.shortlist_ranking_score - a.shortlist_ranking_score);
  return pairs;
}

export function aggregateWayShortlistStatuses(pairs, unknownWayIdsWithCoverage) {
  const byWay = new Map();
  for (const wayId of unknownWayIdsWithCoverage) {
    byWay.set(String(wayId), {
      osm_way_id: String(wayId),
      best_shortlist_status: PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING,
      pair_count: 0,
      future_geometry_route_count: 0,
    });
  }
  for (const p of pairs) {
    const w = byWay.get(String(p.osm_way_id));
    if (!w) continue;
    w.pair_count += 1;
    if (p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY) w.future_geometry_route_count += 1;
    const cur = WAY_STATUS_PRIORITY[w.best_shortlist_status] ?? 0;
    const next = WAY_STATUS_PRIORITY[p.shortlist_status] ?? 0;
    if (next > cur) w.best_shortlist_status = p.shortlist_status;
  }
  const counts = {};
  for (const status of Object.values(PAIR_SHORTLIST_STATUS)) counts[status] = 0;
  for (const w of byWay.values()) {
    counts[w.best_shortlist_status] = (counts[w.best_shortlist_status] || 0) + 1;
  }
  return { ways: [...byWay.values()], status_counts: counts };
}

export function topFutureGeometryCandidates(pairs, limit = 20) {
  return pairs
    .filter((p) => p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY)
    .slice(0, limit);
}

export function pairsForTargetWay(pairs, wayId) {
  return pairs
    .filter((p) => String(p.osm_way_id) === String(wayId))
    .sort((a, b) => b.shortlist_ranking_score - a.shortlist_ranking_score);
}

export { SHORTLIST_NOT_OSM_ENRICHMENT, POINT_ONLY_LANE_COUNT_STATEMENT };
