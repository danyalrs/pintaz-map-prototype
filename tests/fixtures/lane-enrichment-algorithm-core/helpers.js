/** Synthetic local metres: road along +x, lateral = y, cross-section at x=50. */
export function baseBundle(overrides = {}) {
  return {
    source_kind: 'polyline_contract',
    route_key: 'synthetic-route',
    osm_way_id: 'synthetic-way',
    centreline_section: {
      one_way: true,
      points: [[0, 0], [50, 0], [100, 0]],
      junction_nearby: false,
    },
    cross_section: {
      cross_section_id: 'synthetic-cs-50',
      anchor: [50, 0],
      tangent: [1, 0],
    },
    frames: [],
    ...overrides,
  };
}

export function horizLine(y, lineId, featureType, probability = 0.9) {
  return {
    line_id: lineId,
    feature_type: featureType,
    probability,
    coordinates_local_m: [[35, y], [65, y]],
  };
}
