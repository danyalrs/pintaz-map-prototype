import { ROUTE_VERDICT } from '../route-aware-lane-calibration-audit/constants.js';

export const ROUTE_ELIGIBILITY = {
  QUALIFIED_GEOMETRY: 'route_qualified_for_future_geometry',
  NOT_QUALIFIED: 'route_not_qualified',
  NOT_EVALUABLE: 'route_not_evaluable',
  INSUFFICIENT_COVERAGE: 'insufficient_route_coverage',
};

export function mapQualificationToEligibility(routeVerdict, { hasVehiclePoseIndex = true } = {}) {
  if (!hasVehiclePoseIndex) return ROUTE_ELIGIBILITY.INSUFFICIENT_COVERAGE;
  if (routeVerdict === ROUTE_VERDICT.QUALIFIED) return ROUTE_ELIGIBILITY.QUALIFIED_GEOMETRY;
  if (routeVerdict === ROUTE_VERDICT.NOT_QUALIFIED) return ROUTE_ELIGIBILITY.NOT_QUALIFIED;
  return ROUTE_ELIGIBILITY.NOT_EVALUABLE;
}

export const POINT_ONLY_LANE_COUNT_STATEMENT =
  'Current Maps Read point-only layers (lane_point, edge_point, lane_index, green markers) cannot be used to infer or enrich OSM lane counts; only route × road coverage and per-route qualification on known-lane OSM ways are reported.';
