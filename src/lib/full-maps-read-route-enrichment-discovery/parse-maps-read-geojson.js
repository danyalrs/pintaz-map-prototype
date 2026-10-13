import { normalizeNonStandardJsonNumericTokens } from '../json-nan-normalize.js';

export function emptyGeoJsonParseStats() {
  return {
    normalized_numeric_token_replacements: 0,
    normalized_nan_tokens: 0,
    normalized_infinity_tokens: 0,
    normalized_negative_infinity_tokens: 0,
    malformed_observations_dropped: 0,
  };
}

export function mergeGeoJsonParseStats(into, from) {
  if (!from) return into;
  into.normalized_numeric_token_replacements += from.normalized_numeric_token_replacements || 0;
  into.normalized_nan_tokens += from.normalized_nan_tokens || 0;
  into.normalized_infinity_tokens += from.normalized_infinity_tokens || 0;
  into.normalized_negative_infinity_tokens += from.normalized_negative_infinity_tokens || 0;
  into.malformed_observations_dropped += from.malformed_observations_dropped || 0;
  return into;
}

function finiteOrAbsent(value) {
  if (value == null) return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function validVehiclePoseTime(p) {
  if (p.log_mono_time == null) return true;
  if (typeof p.log_mono_time === 'string' && p.log_mono_time.length > 0) return true;
  return typeof p.log_mono_time === 'number' && Number.isFinite(p.log_mono_time);
}

export function isValidMapsReadObservationFeature(feature) {
  if (!feature || feature.type !== 'Feature') return false;
  if (feature.geometry?.type !== 'Point') return false;
  const [lon, lat] = feature.geometry.coordinates ?? [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;

  const layer = feature.properties?.layer;
  const p = feature.properties || {};
  if (layer === 'vehicle_pose') {
    if (p.frame_id == null || p.frame_id === '') return false;
    return (
      finiteOrAbsent(p.heading_deg) &&
      finiteOrAbsent(p.distance_m) &&
      validVehiclePoseTime(p)
    );
  }
  if (layer === 'lane_point') {
    return Number.isFinite(p.model_y_m) && finiteOrAbsent(p.lane_probability);
  }
  if (layer === 'edge_point') {
    return Number.isFinite(p.model_y_m) && finiteOrAbsent(p.edge_probability);
  }
  return true;
}

/**
 * Drop observations with invalid geometry or required numeric pose/lane fields.
 * Nulls from normalized tokens are never treated as evidence.
 */
export function sanitizeMapsReadFeatureCollection(collection) {
  const input = collection?.features ?? [];
  const features = [];
  let dropped = 0;
  for (const f of input) {
    if (!isValidMapsReadObservationFeature(f)) {
      dropped += 1;
      continue;
    }
    features.push(f);
  }
  return {
    type: 'FeatureCollection',
    features,
    metadata: collection?.metadata,
    malformed_observations_dropped: dropped,
  };
}

/**
 * @returns {{ ok: true, geojson: object, stats: object } | { ok: false, parseReason: string, stats: object }}
 */
export function parseMapsReadGeoJsonFromUtf8(text) {
  const stats = emptyGeoJsonParseStats();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const norm = normalizeNonStandardJsonNumericTokens(text);
    stats.normalized_numeric_token_replacements = norm.replacementCount;
    stats.normalized_nan_tokens = norm.nanCount;
    stats.normalized_infinity_tokens = norm.infinityCount;
    stats.normalized_negative_infinity_tokens = norm.negativeInfinityCount;
    try {
      parsed = JSON.parse(norm.normalized);
    } catch (e) {
      return { ok: false, parseReason: `json_parse_failed:${e.message}`, stats };
    }
  }

  const sanitized = sanitizeMapsReadFeatureCollection(parsed);
  stats.malformed_observations_dropped = sanitized.malformed_observations_dropped;
  const { malformed_observations_dropped: _drop, ...geojson } = sanitized;
  return { ok: true, geojson, stats };
}
