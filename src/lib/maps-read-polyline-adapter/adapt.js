import {
  ADAPTER_VERSION,
  FUTURE_EXPORT_SCHEMA,
  REJECTION,
  isAllowedSyntheticRouteKey,
} from './constants.js';
import { rejectPointOnlyIfPresent } from './detect-point-only.js';
import { parsePolylineFeatures } from './parse-features.js';
import {
  mergeEnrichmentInputContract,
  validateOsmEnrichmentContext,
} from './osm-enrichment-context.js';

export const ADAPTER_BOUNDARY_STATEMENT =
  'Maps Read supplies observation geometry. Pintaz performs OSM matching, road eligibility, cross-section selection, filtering, and enrichment decisions.';

/**
 * @param {object} serverExport — future Maps Read polyline FeatureCollection (observations only)
 * @param {object} osmEnrichmentContext — local Pintaz OSM / cross-section / pose-match context
 */
export function adaptMapsReadPolylineExport(serverExport, osmEnrichmentContext) {
  const pointReject = rejectPointOnlyIfPresent(serverExport);
  if (pointReject) return { ok: false, adapter_version: ADAPTER_VERSION, ...pointReject };

  if (!serverExport || serverExport.type !== 'FeatureCollection') {
    return {
      ok: false,
      adapter_version: ADAPTER_VERSION,
      rejection: REJECTION.NOT_FEATURE_COLLECTION,
    };
  }

  const meta = serverExport.metadata || {};
  const routeKey = meta.route_key;
  if (!isAllowedSyntheticRouteKey(routeKey)) {
    return {
      ok: false,
      adapter_version: ADAPTER_VERSION,
      rejection: REJECTION.REAL_ROUTE_DISABLED,
      route_key: routeKey ?? null,
      message: 'Real-route Maps Read exports are disabled in adapter V1.1.',
    };
  }

  if (meta.schema !== FUTURE_EXPORT_SCHEMA) {
    return {
      ok: false,
      adapter_version: ADAPTER_VERSION,
      rejection: REJECTION.MISSING_METADATA,
      message: `Expected metadata.schema ${FUTURE_EXPORT_SCHEMA}`,
    };
  }

  const ctxCheck = validateOsmEnrichmentContext(osmEnrichmentContext);
  if (!ctxCheck.ok) {
    return { ok: false, adapter_version: ADAPTER_VERSION, ...ctxCheck };
  }

  const { lineFeatures, vehicleByFrame, errors } = parsePolylineFeatures(serverExport);
  if (errors.some((e) => e.startsWith('point_geometry'))) {
    return {
      ok: false,
      adapter_version: ADAPTER_VERSION,
      rejection: REJECTION.UNSUPPORTED_POINT_ONLY,
      outcome: 'unsupported_point_only',
      errors,
    };
  }

  const vehicle_frames =
    meta.vehicle_frames?.length
      ? meta.vehicle_frames.map((vf) => ({
          frame_id: vf.frame_id,
          timestamp: vf.timestamp,
          pose: vf.pose,
        }))
      : [...vehicleByFrame.values()]
          .sort((a, b) => a.frame_id - b.frame_id)
          .map((vf) => ({
            frame_id: vf.frame_id,
            timestamp: vf.timestamp,
            pose: vf.pose,
          }));

  if (!lineFeatures.length) {
    return {
      ok: false,
      adapter_version: ADAPTER_VERSION,
      rejection: errors.length ? REJECTION.INVALID_FEATURE : REJECTION.NO_POLYLINE_FEATURES,
      errors,
    };
  }

  const contract = mergeEnrichmentInputContract({
    routeKey,
    coordinateFrame: meta.coordinate_frame,
    vehicleFrames: vehicle_frames,
    lineFeatures,
    osmContext: osmEnrichmentContext,
  });

  return {
    ok: true,
    adapter_version: ADAPTER_VERSION,
    contract,
    parse_warnings: errors,
    lane_count_inferred: false,
    osm_context_authoritative: true,
    ignored_server_osm_hints: Boolean(meta.osm_road || meta.osm_way_id || meta.cross_section),
  };
}

/** @deprecated Use adaptMapsReadPolylineExport(export, osmContext) */
export function adaptMapsReadPolylineGeoJson(raw, osmEnrichmentContext) {
  return adaptMapsReadPolylineExport(raw, osmEnrichmentContext);
}
