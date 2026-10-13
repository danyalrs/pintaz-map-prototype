const LINE_TYPES = new Set(['lane_boundary', 'road_edge']);

function verticesFromFeature(feature) {
  const props = feature.properties || {};
  if (Array.isArray(props.coordinates_local_m) && props.coordinates_local_m.length >= 2) {
    return props.coordinates_local_m.map((c) => [Number(c[0]), Number(c[1])]);
  }
  const g = feature.geometry;
  if (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return g.coordinates.map((c) => [Number(c[0]), Number(c[1])]);
  }
  return null;
}

export function parsePolylineFeatures(raw) {
  const lineFeatures = [];
  const vehicleByFrame = new Map();
  const errors = [];

  for (const feature of raw.features || []) {
    const props = feature.properties || {};
    const ft = props.feature_type;
    if (ft === 'vehicle_pose' || props.role === 'vehicle_pose') {
      const fid = props.frame_id;
      if (fid == null) {
        errors.push('vehicle_pose_missing_frame_id');
        continue;
      }
      vehicleByFrame.set(fid, {
        frame_id: fid,
        timestamp: props.timestamp ?? String(60000000000 + fid),
        pose: props.pose,
        pose_match: props.pose_match,
      });
      continue;
    }
    if (!LINE_TYPES.has(ft)) {
      if (feature.geometry?.type === 'Point') {
        errors.push('point_geometry_in_polyline_export');
      }
      continue;
    }
    const verts = verticesFromFeature(feature);
    if (!verts) {
      errors.push(`missing_ordered_vertices:${props.line_id || 'unknown'}`);
      const partial =
        feature.geometry?.coordinates ||
        (Array.isArray(props.coordinates_local_m) ? props.coordinates_local_m : null);
      if (partial?.length && props.line_id != null && props.frame_id != null) {
        lineFeatures.push({
          frame_id: props.frame_id,
          feature_type: ft,
          line_id: props.line_id,
          probability: props.probability,
          uncertainty: props.uncertainty,
          coordinates_local_m: partial.map((c) => [Number(c[0]), Number(c[1])]),
        });
      }
      continue;
    }
    lineFeatures.push({
      frame_id: props.frame_id,
      feature_type: ft,
      line_id: props.line_id,
      probability: props.probability,
      uncertainty: props.uncertainty,
      coordinates_local_m: verts,
    });
    if (props.pose && props.pose_match && props.frame_id != null) {
      if (!vehicleByFrame.has(props.frame_id)) {
        vehicleByFrame.set(props.frame_id, {
          frame_id: props.frame_id,
          timestamp: props.timestamp ?? String(60000000000 + props.frame_id),
          pose: props.pose,
          pose_match: props.pose_match,
        });
      }
    }
  }
  return { lineFeatures, vehicleByFrame, errors };
}
