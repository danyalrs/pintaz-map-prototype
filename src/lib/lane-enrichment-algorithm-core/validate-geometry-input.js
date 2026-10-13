import { LIMITS, FEATURE_TYPE } from './constants.js';

export function validateGeometryInput(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, errors: ['missing_bundle'] };
  }
  if (bundle.source_kind === 'point_only' || bundle.point_only === true) {
    errors.push('point_only_source');
  }
  if (!bundle.centreline_section?.points?.length) {
    errors.push('missing_centreline_section');
  }
  if (bundle.centreline_section?.one_way !== true) {
    errors.push('not_one_way');
  }
  if (!bundle.cross_section?.anchor || !bundle.cross_section?.tangent) {
    errors.push('missing_cross_section');
  }
  const frames = bundle.frames || [];
  if (!frames.length) errors.push('no_frames');

  for (const fr of frames) {
    if (fr.frame_id == null) errors.push(`frame_missing_id:${fr}`);
    if (fr.pose_quality != null && fr.pose_quality < LIMITS.minPoseQuality) {
      errors.push(`pose_quality_low:${fr.frame_id}`);
    }
    if (fr.heading_aligned === false) errors.push(`wrong_heading:${fr.frame_id}`);
    for (const line of fr.lines || []) {
      if (!line.line_id) errors.push(`missing_line_id:frame_${fr.frame_id}`);
      if (![FEATURE_TYPE.LANE_BOUNDARY, FEATURE_TYPE.ROAD_EDGE].includes(line.feature_type)) {
        errors.push(`invalid_feature_type:${line.line_id}`);
      }
      const verts = line.coordinates_local_m || line.vertices;
      if (!Array.isArray(verts) || verts.length < LIMITS.minPolylineVertices) {
        errors.push(`polyline_too_short:${line.line_id}`);
      }
      if (line.probability != null && line.probability < LIMITS.minLineConfidence) {
        errors.push(`line_confidence_low:${line.line_id}`);
      }
    }
  }

  if (errors.some((e) => e === 'point_only_source' || e.startsWith('polyline_too_short'))) {
    return { ok: false, errors, unsupported: true };
  }
  return { ok: errors.length === 0, errors, unsupported: false };
}
