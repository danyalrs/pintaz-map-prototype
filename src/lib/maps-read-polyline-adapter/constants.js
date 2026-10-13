export const ADAPTER_VERSION = 'maps-read-polyline-adapter-v1.1';

/** Future Maps Read export schema identifier (synthetic / fixture only in V1). */
export const FUTURE_EXPORT_SCHEMA = 'kommu.maps.lane_polyline_export';

export const REJECTION = {
  UNSUPPORTED_POINT_ONLY: 'unsupported_point_only',
  REAL_ROUTE_DISABLED: 'real_route_disabled',
  NOT_FEATURE_COLLECTION: 'not_feature_collection',
  MISSING_METADATA: 'missing_export_metadata',
  NO_POLYLINE_FEATURES: 'no_polyline_features',
  INVALID_FEATURE: 'invalid_feature',
  MISSING_OSM_ENRICHMENT_CONTEXT: 'missing_osm_enrichment_context',
};

/** Production / local observation routes must not enter via this adapter in V1. */
export const DISABLED_ROUTE_KEYS = new Set([
  'active',
  'drive-001',
  'drive-005',
  'drive-007',
  'drive-008',
  'drive-010',
]);

export function isAllowedSyntheticRouteKey(routeKey) {
  if (!routeKey || typeof routeKey !== 'string') return false;
  if (DISABLED_ROUTE_KEYS.has(routeKey)) return false;
  return (
    routeKey.startsWith('synthetic-') ||
    routeKey.startsWith('fixture-') ||
    routeKey.startsWith('future-maps-read-')
  );
}
