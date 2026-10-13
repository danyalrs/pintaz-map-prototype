import { PREPARED_ROUTE_KEYS, AUDIT_VERSION, MINIMUM_SUPPORT_POLICY, DRIVE005_KAMUNING_WAY_ID } from './constants.js';
import { loadRouteScopedWays } from './route-corpus.js';
import { evaluateRoute } from './per-route-evaluation.js';
import { qualifyRoute, attachMultiMetrics } from './qualify-route.js';
import { buildUnknownOsmCoverage } from './unknown-coverage.js';
import { redactRouteMetrics, redactEvalRow, redactUnknownRow } from './redact.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';

export function runRouteAwareLaneCalibrationAudit() {
  const qualifications = [];
  const qualificationsByRoute = new Map();
  const perRouteEvaluation = {};
  const perRouteEvaluationRows = [];

  for (const routeKey of PREPARED_ROUTE_KEYS) {
    const { ways, bundle_ok } = loadRouteScopedWays(routeKey);
    const evaluation = evaluateRoute(ways, routeKey);
    perRouteEvaluation[routeKey] = evaluation;
    perRouteEvaluationRows.push(
      ...evaluation.single_best_frame.rows,
      ...evaluation.multi_frame_consensus.rows.map((r) => ({ ...r, eval_mode: 'multi' }))
    );

    let q = qualifyRoute({ routeKey, bundle_ok, waysMap: ways, evaluation });
    q = attachMultiMetrics(q, evaluation);
    qualifications.push(q);
    qualificationsByRoute.set(routeKey, q);
  }

  const unknownCoverage = buildUnknownOsmCoverage(qualificationsByRoute);
  const kamuning = unknownCoverage.find(
    (r) => normalizeOsmWayId(r.osm_way_id) === DRIVE005_KAMUNING_WAY_ID
  );

  const anyQualified = qualifications.some((q) => q.reliable_for_experimental_method);
  const evaluableRoutes = qualifications.filter((q) => q.evaluable).map((q) => q.route_key);

  return {
    version: AUDIT_VERSION,
    minimum_support_policy: MINIMUM_SUPPORT_POLICY,
    qualifications,
    perRouteEvaluation,
    unknownCoverage,
    kamuning_demonstration: kamuning,
    conclusions: {
      routes_evaluable: evaluableRoutes,
      routes_reliable_for_experimental_method: qualifications
        .filter((q) => q.reliable_for_experimental_method)
        .map((q) => q.route_key),
      unknown_ways_with_any_route_coverage: unknownCoverage.filter((u) => u.route_observations.length).length,
      real_enrichment_candidate_allowed: false,
      real_enrichment_note:
        'No production OSM enrichment candidate is allowed from this audit. Point-only signatures are experimental; unknown-OSM rows report coverage only, not lane counts.',
      exploratory_calibration_only: true,
    },
    redacted: {
      route_metrics: qualifications.map(redactRouteMetrics),
      per_route_evaluation: perRouteEvaluationRows.map(redactEvalRow),
      unknown_way_coverage: unknownCoverage.map(redactUnknownRow),
    },
  };
}
