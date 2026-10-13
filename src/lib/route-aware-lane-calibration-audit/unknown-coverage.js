import { PREPARED_ROUTE_KEYS, UNKNOWN_WAY_COVERAGE, DRIVE005_KAMUNING_WAY_ID } from './constants.js';
import { ROUTE_VERDICT } from './constants.js';
import { loadRouteScopedWays, isUnknownLaneWay, routeSourceQualitySummary } from './route-corpus.js';
import { loadLabelledWayCorpus } from '../point-only-lane-signature-calibration/corpus.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';

function verdictRank(verdict) {
  if (verdict === ROUTE_VERDICT.QUALIFIED) return 3;
  if (verdict === ROUTE_VERDICT.NOT_QUALIFIED) return 2;
  return 1;
}

export function buildUnknownOsmCoverage(qualificationsByRoute) {
  const { ways: globalWays, roadIndex } = loadLabelledWayCorpus();
  const routeWayStats = new Map();

  for (const routeKey of PREPARED_ROUTE_KEYS) {
    const { ways, bundle_ok } = loadRouteScopedWays(routeKey);
    for (const w of ways.values()) {
      if (!isUnknownLaneWay(roadIndex, w.osm_way_id)) continue;
      const quality = routeSourceQualitySummary(new Map([[w.osm_way_id, w]]), { labelledOnly: false });
      const row = {
        route_key: routeKey,
        bundle_ok,
        matched_frame_count: w.frame_count,
        accepted_frame_count: quality.accepted_frame_count,
        accepted_frame_fraction: quality.accepted_frame_fraction,
        mean_pose_distance_m: quality.mean_pose_distance_m,
        mean_heading_diff_deg: quality.mean_heading_diff_deg,
        road_eligibility: bundle_ok ? 'one_way_or_unknown_lane_tag' : 'bundle_missing',
        route_verdict: qualificationsByRoute.get(routeKey)?.route_verdict ?? ROUTE_VERDICT.NOT_EVALUABLE,
      };
      if (!routeWayStats.has(w.osm_way_id)) routeWayStats.set(w.osm_way_id, []);
      routeWayStats.get(w.osm_way_id).push(row);
    }
  }

  const unknownRows = [];
  const allUnknownIds = new Set();
  for (const [wayId, w] of globalWays) {
    if (isUnknownLaneWay(roadIndex, wayId)) allUnknownIds.add(wayId);
  }

  for (const wayId of [...allUnknownIds].sort()) {
    const routes = routeWayStats.get(wayId) || [];
    let coverage_status = UNKNOWN_WAY_COVERAGE.NONE;
    if (routes.length) {
      const best = routes.reduce((a, b) =>
        verdictRank(a.route_verdict) >= verdictRank(b.route_verdict) ? a : b
      );
      if (best.route_verdict === ROUTE_VERDICT.QUALIFIED) {
        coverage_status = UNKNOWN_WAY_COVERAGE.QUALIFIED;
      } else if (best.route_verdict === ROUTE_VERDICT.NOT_QUALIFIED) {
        coverage_status = UNKNOWN_WAY_COVERAGE.UNQUALIFIED;
      } else {
        coverage_status = UNKNOWN_WAY_COVERAGE.NOT_EVALUABLE;
      }
    }
    unknownRows.push({
      osm_way_id: wayId,
      osm_lane_count_label: null,
      coverage_status,
      route_observations: routes,
      demonstration:
        normalizeOsmWayId(wayId) === DRIVE005_KAMUNING_WAY_ID
          ? {
              note:
                'Jalan Kamuning demonstration row — OSM lane count unknown. No confirmed lane count; no manual map inspection.',
              drive_005_covers: routes.some((r) => r.route_key === 'drive-005'),
            }
          : null,
    });
  }
  return unknownRows;
}
