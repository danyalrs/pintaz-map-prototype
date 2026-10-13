const ROUTE_REDACT = {
  active: 'production-active',
  'drive-001': 'probe-001',
  'drive-005': 'probe-005',
  'drive-007': 'probe-007',
  'drive-008': 'probe-008',
  'drive-010': 'probe-010',
};

export function redactRouteKey(k) {
  return ROUTE_REDACT[k] || 'probe-redacted';
}

export function redactWayId(id) {
  return id ? `way-${String(id).slice(-6)}` : null;
}

export function redactRouteMetrics(row) {
  return {
    ...row,
    route_key: redactRouteKey(row.route_key),
  };
}

export function redactEvalRow(row) {
  return {
    ...row,
    route_key: redactRouteKey(row.route_key),
    osm_way_id: redactWayId(row.osm_way_id),
  };
}

export function redactUnknownRow(row) {
  return {
    ...row,
    osm_way_id: redactWayId(row.osm_way_id),
    route_observations: (row.route_observations || []).map((r) => ({
      ...r,
      route_key: redactRouteKey(r.route_key),
    })),
  };
}
