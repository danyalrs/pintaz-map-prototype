const ROUTE_REDACT = {
  active: 'production-active',
  'drive-001': 'probe-001',
  'drive-005': 'probe-005',
  'drive-007': 'probe-007',
  'drive-008': 'probe-008',
  'drive-010': 'probe-010',
};

export function redactEvaluationRow(row) {
  return {
    ...row,
    osm_way_id: row.osm_way_id ? `way-${String(row.osm_way_id).slice(-6)}` : null,
    route_keys: (row.route_keys || []).map((k) => ROUTE_REDACT[k] || 'probe-redacted'),
  };
}
