import { OUTCOME } from './outcomes.js';
import { validateCoordinateFrame } from './coordinate-frame.js';
import { validatePolylineVertices } from './polyline.js';
import { normalizeInput } from './normalize.js';

const FEATURE_TYPES = new Set(['lane_boundary', 'road_edge']);

function missing(outcome, field, details = []) {
  return { ok: false, outcome, errors: [`missing:${field}`, ...details] };
}

export function validateLaneEnrichmentInputContract(raw) {
  const norm = normalizeInput(raw);

  if (norm.kind === 'maps_read_point_geojson') {
    return {
      ok: false,
      outcome: OUTCOME.UNSUPPORTED_POINT_ONLY,
      errors: ['maps_read_visualization_point_cloud'],
      lane_count_inferred: false,
    };
  }

  const b = norm.bundle;
  if (!b || norm.kind === 'invalid' || norm.kind === 'unknown') {
    return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'bundle');
  }

  if (b.osm_road?.one_way !== true) {
    return {
      ok: false,
      outcome: OUTCOME.NOT_ONE_WAY_ELIGIBLE,
      errors: ['osm_road.one_way'],
      lane_count_inferred: false,
    };
  }

  const cf = validateCoordinateFrame(b.coordinate_frame);
  if (!cf.ok) {
    return {
      ok: false,
      outcome: OUTCOME.INVALID_COORDINATE_FRAME,
      errors: [cf.reason],
      lane_count_inferred: false,
    };
  }

  const requiredTop = ['route_key', 'osm_road', 'vehicle_frames', 'line_features'];
  for (const k of requiredTop) {
    if (b[k] == null) return missing(OUTCOME.MISSING_REQUIRED_FIELD, k);
  }
  if (!b.osm_road.osm_way_id) return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'osm_road.osm_way_id');
  if (!b.osm_road.centreline_local_m?.length && !b.osm_road.centreline?.length) {
    return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'osm_road.centreline_local_m');
  }
  const hasCross =
    b.cross_section?.anchor_forward_m != null ||
    (b.cross_section?.anchor && b.cross_section?.tangent);
  if (!hasCross) return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'cross_section');

  const frameMap = new Map();
  for (const vf of b.vehicle_frames) {
    if (vf.frame_id == null) return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'vehicle_frames.frame_id');
    if (vf.timestamp == null) return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'vehicle_frames.timestamp');
    if (vf.pose?.heading_deg == null) {
      return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'vehicle_frames.pose.heading_deg');
    }
    if (vf.pose?.forward_m == null || vf.pose?.lateral_m == null) {
      return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'vehicle_frames.pose.position');
    }
    if (vf.pose_match?.distance_m == null || vf.pose_match?.heading_diff_deg == null) {
      return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'vehicle_frames.pose_match');
    }
    frameMap.set(vf.frame_id, vf);
  }

  const lineKeySeen = new Set();
  for (const line of b.line_features || []) {
    if (line.frame_id == null) return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'line_features.frame_id');
    if (!line.line_id) return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'line_features.line_id');
    if (!FEATURE_TYPES.has(line.feature_type)) {
      return {
        ok: false,
        outcome: OUTCOME.UNKNOWN_FEATURE_TYPE,
        errors: [line.feature_type],
        lane_count_inferred: false,
      };
    }
    const dupKey = `${line.frame_id}|${line.line_id}|${line.feature_type}`;
    if (lineKeySeen.has(dupKey)) {
      return {
        ok: false,
        outcome: OUTCOME.DUPLICATE_LINE_ID_IN_FRAME,
        errors: [dupKey],
        lane_count_inferred: false,
      };
    }
    lineKeySeen.add(dupKey);

    if (line.probability != null) {
      const p = Number(line.probability);
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        return {
          ok: false,
          outcome: OUTCOME.INVALID_PROBABILITY,
          errors: [line.line_id],
          lane_count_inferred: false,
        };
      }
    }

    const pl = validatePolylineVertices(line.coordinates_local_m);
    if (!pl.ok) {
      return {
        ok: false,
        outcome: OUTCOME.INVALID_POLYLINE,
        errors: [`${line.line_id}:${pl.reason}`],
        lane_count_inferred: false,
      };
    }

    if (line.geometry?.type === 'Point') {
      return {
        ok: false,
        outcome: OUTCOME.UNSUPPORTED_POINT_ONLY,
        errors: [line.line_id],
        lane_count_inferred: false,
      };
    }
  }

  if (!b.line_features?.length) {
    return missing(OUTCOME.MISSING_REQUIRED_FIELD, 'line_features');
  }

  for (const lf of b.line_features) {
    if (!frameMap.has(lf.frame_id)) {
      return missing(OUTCOME.MISSING_REQUIRED_FIELD, `vehicle_frame_for_line:${lf.frame_id}`);
    }
  }

  return {
    ok: true,
    outcome: OUTCOME.VALID,
    errors: [],
    lane_count_inferred: false,
    contract: b,
  };
}
