/**
 * Documented Maps Read semantics from data/maps-read/docs.safe.json (local copy).
 * Do not infer undocumented count scopes.
 */

export const ROUTES_API_SEMANTICS = {
  endpoint: '/v1/routes',
  bbox_order: ['minLon', 'minLat', 'maxLon', 'maxLat'],
  bbox_max_edge_exclusive: true,
  limit_default: 100,
  limit_maximum: 500,
  pagination_fields: ['offset', 'returned', 'next_offset'],
  route_fields: ['dongle', 'route', 'version', 'segments', 'model_frames', 'gps_fixes'],
  list_purpose: 'List drives inside a box so a client can request one route at a time.',
  segment_in_bbox_rule:
    'A segment is inside a bbox when its first usable GPS fix (origin_lat, origin_lon) falls inside. status must be done.',
  coverage_endpoint_purpose: 'Count stored data whose segment origin falls in the box.',
  per_route_model_frames_scope: 'unknown',
  per_route_gps_fixes_scope: 'unknown',
  per_route_segments_scope: 'unknown',
  scope_note:
    'Local API docs define bbox filtering for the route list and aggregate /v1/coverage counts, but do not state whether each route record\'s model_frames, gps_fixes, or segments counts are limited to the bbox or describe the whole drive.',
};

export function countScopeLabel() {
  return ROUTES_API_SEMANTICS.per_route_model_frames_scope;
}
