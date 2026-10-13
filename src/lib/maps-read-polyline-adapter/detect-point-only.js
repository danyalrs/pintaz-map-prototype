import { REJECTION } from './constants.js';

export function isCurrentMapsReadPointOnlyExport(raw) {
  if (!raw || raw.type !== 'FeatureCollection') return false;
  if (raw.metadata?.schema === 'kommu.maps.visualization-point-cloud') return true;
  return (raw.features || []).some(
    (f) =>
      f.geometry?.type === 'Point' &&
      (f.properties?.layer === 'lane_point' ||
        f.properties?.layer === 'edge_point' ||
        f.properties?.lane_index != null ||
        f.properties?.edge_index != null)
  );
}

export function rejectPointOnlyIfPresent(raw) {
  if (isCurrentMapsReadPointOnlyExport(raw)) {
    return {
      ok: false,
      rejection: REJECTION.UNSUPPORTED_POINT_ONLY,
      outcome: 'unsupported_point_only',
      message: 'Current Maps Read point-only visualization GeoJSON cannot be adapted to lane enrichment.',
    };
  }
  return null;
}
