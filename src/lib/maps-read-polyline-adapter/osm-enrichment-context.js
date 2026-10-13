import { REJECTION } from './constants.js';

export const OSM_CONTEXT_SCHEMA = 'pintaz.osm-enrichment-context.v1';

export function validateOsmEnrichmentContext(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    return { ok: false, rejection: REJECTION.MISSING_OSM_ENRICHMENT_CONTEXT, outcome: 'missing_osm_enrichment_context' };
  }
  const errors = [];
  if (!ctx.osm_way_id) errors.push('osm_way_id');
  const road = ctx.osm_road;
  if (!road) errors.push('osm_road');
  else {
    if (road.one_way !== true) errors.push('osm_road.one_way');
    if (!road.centreline_local_m?.length && !road.centreline?.length) {
      errors.push('osm_road.centreline_local_m');
    }
  }
  const cs = ctx.cross_section;
  if (!cs) errors.push('cross_section');
  else if (
    cs.anchor_forward_m == null &&
    !(cs.anchor && cs.tangent) &&
    !(cs.anchor && cs.tangent_forward)
  ) {
    errors.push('cross_section.anchor');
  }
  if (!ctx.pose_match_by_frame_id || typeof ctx.pose_match_by_frame_id !== 'object') {
    errors.push('pose_match_by_frame_id');
  }
  if (errors.length) {
    return {
      ok: false,
      rejection: REJECTION.MISSING_OSM_ENRICHMENT_CONTEXT,
      outcome: 'missing_osm_enrichment_context',
      errors,
    };
  }
  return { ok: true };
}

/** Local Pintaz context is authoritative; server export OSM hints are ignored. */
export function mergeEnrichmentInputContract({ routeKey, coordinateFrame, vehicleFrames, lineFeatures, osmContext }) {
  const poseMatchByFrame = osmContext.pose_match_by_frame_id;
  const mergedVehicleFrames = vehicleFrames.map((vf) => {
    const pm = poseMatchByFrame[String(vf.frame_id)] ?? poseMatchByFrame[vf.frame_id];
    return {
      ...vf,
      pose_match: pm,
    };
  });

  return {
    schema: 'pintaz.lane-enrichment-input.v1',
    route_key: routeKey,
    coordinate_frame: coordinateFrame,
    osm_road: {
      ...osmContext.osm_road,
      osm_way_id: osmContext.osm_way_id,
    },
    cross_section: osmContext.cross_section,
    vehicle_frames: mergedVehicleFrames,
    line_features: lineFeatures,
  };
}
