import { countByLayer, parseBboxString, LAYER_NAMES } from './update-preview-stats.js';
import { assertRouteIdentityMatches, routeIdentityFromCollection } from './selected-route-identity.js';
import { normalizeBareNanInJson } from './json-nan-normalize.js';

const EXPECTED_SCHEMA = 'kommu.maps.visualization-point-cloud';
const EXPECTED_SCHEMA_VERSION = 1;

export function countLiteralNanTokens(text) {
  let count = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (text.slice(i, i + 3) === 'NaN') {
      const prev = i > 0 ? text[i - 1] : '';
      const next = i + 3 < text.length ? text[i + 3] : '';
      if ((i === 0 || /[\s,:{}\[\]]/.test(prev)) && (i + 3 >= text.length || /[\s,:{}\[\]]/.test(next))) {
        count += 1;
        i += 2;
      }
    }
  }
  return count;
}

export function coordinateBounds(features) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const f of features) {
    if (f?.geometry?.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

/**
 * Validate raw page bytes (immutable API response).
 */
export function validateRawPageBuffer(buf, { expectedRoute, previousNextAfterSeg, requestedAfterSeg }) {
  const anomalies = [];
  const text = buf.toString('utf8');
  const literalNanCount = countLiteralNanTokens(text);

  let collection;
  try {
    collection = JSON.parse(text);
  } catch {
    try {
      const { normalized } = normalizeBareNanInJson(text);
      collection = JSON.parse(normalized);
    } catch (e) {
      return { ok: false, anomalies: [`json_parse_failed:${e.message}`] };
    }
  }

  if (collection?.type !== 'FeatureCollection') {
    anomalies.push('not_feature_collection');
  }

  const md = collection.metadata ?? {};
  if (md.schema !== EXPECTED_SCHEMA) anomalies.push('schema_mismatch');
  if (md.schema_version !== EXPECTED_SCHEMA_VERSION) anomalies.push('schema_version_mismatch');

  const identity = assertRouteIdentityMatches(collection, expectedRoute);
  if (!identity.ok) anomalies.push(identity.reason);

  const features = collection.features ?? [];
  for (let i = 0; i < Math.min(features.length, 50); i += 1) {
    const g = features[i]?.geometry;
    if (g?.type !== 'Point') anomalies.push('non_point_geometry');
    const [lon, lat] = g?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) anomalies.push('non_finite_coordinate');
  }

  const layers = countByLayer(features);
  for (const name of LAYER_NAMES) {
    if (layers[name] === undefined) anomalies.push(`missing_layer_count:${name}`);
  }

  const maxFeatures = md.max_features ?? 80000;
  if (features.length > maxFeatures) anomalies.push('feature_count_exceeds_max_features');

  if (requestedAfterSeg != null && previousNextAfterSeg != null && requestedAfterSeg !== previousNextAfterSeg) {
    anomalies.push('pagination_after_seg_gap');
  }

  const bounds = coordinateBounds(features);
  const bbox = parseBboxString(md.bbox ?? collection.bbox);
  if (!bounds && features.length) anomalies.push('empty_coordinate_bounds');

  return {
    ok: anomalies.length === 0,
    anomalies,
    collection,
    metadata: md,
    featureCount: features.length,
    layerCounts: layers,
    literalNanCount,
    bounds,
    bbox,
    truncated: Boolean(md.truncated),
    nextAfterSeg: md.next_after_seg ?? null,
    identity: routeIdentityFromCollection(collection),
  };
}

export function validateNormalizedDerivedFeature(feature) {
  const g = feature?.geometry;
  if (g?.type !== 'Point') return false;
  const [lon, lat] = g.coordinates ?? [];
  return Number.isFinite(lon) && Number.isFinite(lat);
}

export function parseRawPageForDerived(buf) {
  const text = buf.toString('utf8');
  const { normalized, replacementCount } = normalizeBareNanInJson(text);
  const collection = JSON.parse(normalized);
  return { collection, replacementCount, rawLiteralNan: countLiteralNanTokens(text) };
}
