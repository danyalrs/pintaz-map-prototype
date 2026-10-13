/**
 * Accept contract object or GeoJSON FeatureCollection with metadata.lane_enrichment_contract.
 */
export function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'invalid', bundle: null };
  if (raw.type === 'FeatureCollection' && raw.metadata?.lane_enrichment_contract) {
    return {
      kind: 'contract',
      bundle: {
        ...raw.metadata.lane_enrichment_contract,
        _geojson_features: raw.features || [],
      },
    };
  }
  if (raw.route_key && raw.schema?.startsWith?.('pintaz.lane-enrichment-input')) {
    return { kind: 'contract', bundle: raw };
  }
  if (raw.route_key && (raw.vehicle_frames || raw.line_features)) {
    return { kind: 'contract', bundle: raw };
  }
  if (raw.type === 'FeatureCollection' && raw.metadata?.schema === 'kommu.maps.visualization-point-cloud') {
    return { kind: 'maps_read_point_geojson', bundle: raw };
  }
  if (raw.type === 'FeatureCollection') {
    const hasPointLane = (raw.features || []).some(
      (f) =>
        (f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point') &&
        f.geometry?.type === 'Point'
    );
    if (hasPointLane) return { kind: 'maps_read_point_geojson', bundle: raw };
  }
  return { kind: 'unknown', bundle: raw };
}
