import fs from 'node:fs';
import path from 'node:path';
import { normalizeBareNanInJson, sha256Hex } from './json-nan-normalize.js';
import {
  RAW_SAMPLE_PATH,
  ROUTE_SELECTION_PRIVATE_PATH,
  UPDATE_BUNDLE_ID,
  UPDATE_PREVIEW_AREA_ID,
  previewGeojsonPath,
  updateEnvelopePath,
  resolveUpdatePreviewPaths,
} from './update-preview-paths.js';
import { countByLayer, insideOutsideCounts, parseBboxString, geometryFingerprints } from './update-preview-stats.js';
import { loadActiveSourceManifest, validateActiveSourceManifest } from './active-source-manifest.js';

export const PAGE1_EXPECTED = {
  featureCount: 5171,
  layerCounts: { lane_point: 2872, edge_point: 1436, vehicle_pose: 718, gps_point: 145 },
  inside: 4256,
  outside: 915,
  truncated: true,
  next_after_seg: 23,
  rawSha256: 'f5c96176bc9f528ba53e3e25d407396c300593e71d73111e8e1e9316f6b8e826',
};

/** @deprecated alias */
export const EXPECTED = PAGE1_EXPECTED;

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function atomicWriteUtf8(filePath, text) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function verifyPreparedCollection(collection, expected = PAGE1_EXPECTED) {
  const features = collection.features || [];
  if (features.length !== expected.featureCount) {
    throw new Error(`Feature count ${features.length} !== ${expected.featureCount}`);
  }
  const layers = countByLayer(features);
  for (const [k, v] of Object.entries(expected.layerCounts)) {
    if (layers[k] !== v) throw new Error(`Layer ${k}: ${layers[k]} !== ${v}`);
  }
  const areaBbox =
    parseBboxString(
      fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)
        ? JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8')).bbox
        : '101.708993,3.141007,101.727007,3.158993'
    ) || parseBboxString('101.708993,3.141007,101.727007,3.158993');
  const { inside_area_count, outside_area_count } = insideOutsideCounts(features, areaBbox);
  if (inside_area_count !== expected.inside) {
    throw new Error(`inside_area_count ${inside_area_count} !== ${expected.inside}`);
  }
  if (outside_area_count !== expected.outside) {
    throw new Error(`outside_area_count ${outside_area_count} !== ${expected.outside}`);
  }
  if (collection.metadata?.truncated !== expected.truncated) {
    throw new Error('metadata.truncated mismatch');
  }
  if (collection.metadata?.next_after_seg !== expected.next_after_seg) {
    throw new Error('metadata.next_after_seg mismatch');
  }
  return { layers, inside_area_count, outside_area_count, areaBbox };
}

/**
 * Build preview + envelope at explicit paths (tests and tooling).
 */
export function prepareUpdatePreviewFromRaw({
  rawSamplePath,
  previewPath,
  envelopePath,
  expected = PAGE1_EXPECTED,
  routeSelectionPath = ROUTE_SELECTION_PRIVATE_PATH,
  force = false,
}) {
  if (!rawSamplePath || !previewPath || !envelopePath) {
    throw new Error('prepareUpdatePreviewFromRaw requires rawSamplePath, previewPath, envelopePath');
  }
  if (!force && fs.existsSync(previewPath) && fs.existsSync(envelopePath)) {
    return { ok: true, skipped: true };
  }
  if (!fs.existsSync(rawSamplePath)) {
    return { ok: false, error: 'raw_sample_missing' };
  }

  const rawBuf = fs.readFileSync(rawSamplePath);
  const rawSha = sha256Hex(rawBuf);
  if (expected.rawSha256 && rawSha !== expected.rawSha256) {
    throw new Error(`Raw SHA-256 mismatch: ${rawSha}`);
  }

  const rawText = rawBuf.toString('utf8');
  const { normalized, replacementCount, affectedPropertyNames } = normalizeBareNanInJson(rawText);
  const normalizedSha = sha256Hex(normalized);
  const collection = JSON.parse(normalized);
  const stats = verifyPreparedCollection(collection, expected);
  const previewText = `${JSON.stringify(collection)}\n`;
  atomicWriteUtf8(previewPath, previewText);

  const routePrivate = fs.existsSync(routeSelectionPath)
    ? JSON.parse(fs.readFileSync(routeSelectionPath, 'utf8'))
    : null;

  const dongleFull = routePrivate?.selected?.dongle ?? collection.metadata?.dongle ?? null;
  const routeFull = routePrivate?.selected?.route ?? collection.metadata?.route ?? null;

  const envelope = {
    update_id: 'bukit-sample-page-1-v1',
    update_schema: 'pintaz.maps-read.update-preview',
    update_schema_version: 1,
    created_at: new Date().toISOString(),
    area_id: UPDATE_PREVIEW_AREA_ID,
    source_type: 'maps-read-api',
    source_response_path: 'data/maps-read/samples/bukit_sample_drive.geojson',
    source_response_sha256: rawSha,
    source_response_size: rawBuf.length,
    normalized_preview_path: 'data/maps-read/updates/bukit-sample-page-1/preview.geojson',
    normalized_preview_sha256: sha256Hex(previewText),
    normalization: {
      type: 'transport_only',
      description: 'NaN converted to null',
      replacement_count: replacementCount,
      affected_property_names: affectedPropertyNames,
      normalized_sha256: normalizedSha,
      geometry_changed: false,
      features_removed: 0,
      features_added: 0,
    },
    requested_layers: ['lane_point', 'edge_point', 'vehicle_pose', 'gps_point'],
    original_api_metadata: collection.metadata ?? {},
    source_dongle_redacted: redactDongle(dongleFull),
    source_route_redacted: redactRoute(routeFull),
    source_dongle: dongleFull,
    source_route: routeFull,
    bbox: routePrivate?.bbox ?? collection.metadata?.bbox ?? '101.708993,3.141007,101.727007,3.158993',
    total_feature_count: collection.features.length,
    counts_by_layer: stats.layers,
    inside_area_count: stats.inside_area_count,
    outside_area_count: stats.outside_area_count,
    truncated: expected.truncated,
    next_after_seg: expected.next_after_seg,
    page_scope: 'partial-first-page',
    route_status: 'partial',
    route_page_count: 1,
    acceptance_state: 'pending',
    acceptance_history: [],
    baseline_osm_changed: false,
  };

  atomicWriteJson(envelopePath, envelope);

  return {
    ok: true,
    rawSha256: rawSha,
    normalizedSha256: normalizedSha,
    replacementCount,
    affectedPropertyNames,
    geometryFingerprints: geometryFingerprints(collection.features).length,
  };
}

/**
 * Build preview.geojson + update-envelope.json if missing.
 * Never modifies raw sample. Never overwrites active complete-route manifest bundle.
 */
export function ensureUpdatePreviewPrepared({ force = false, paths = null } = {}) {
  const resolved = paths || resolveUpdatePreviewPaths();
  const previewPath = paths?.previewPath || previewGeojsonPath();
  const envelopePath = paths?.envelopePath || updateEnvelopePath();
  const rawSamplePath = paths?.rawSamplePath || RAW_SAMPLE_PATH;

  if (!force) {
    const manifest = loadActiveSourceManifest();
    if (manifest?.source_type === 'complete_selected_route') {
      const validation = validateActiveSourceManifest(manifest);
      if (validation.ok) {
        return { ok: true, skipped: true, reason: 'active_complete_manifest' };
      }
    }
    if (fs.existsSync(previewPath) && fs.existsSync(envelopePath)) {
      return { ok: true, skipped: true };
    }
  }

  return prepareUpdatePreviewFromRaw({
    rawSamplePath,
    previewPath,
    envelopePath,
    expected: PAGE1_EXPECTED,
    force: true,
  });
}

export function redactDongle(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.length <= 8) return '…';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function redactRoute(id) {
  if (!id || typeof id !== 'string') return null;
  const parts = id.split('--');
  if (parts.length >= 3) return `${parts[0]}--…--${parts[parts.length - 1]}`;
  if (id.length <= 10) return '…';
  return `${id.slice(0, 10)}…`;
}

export function loadEnvelope() {
  const p = updateEnvelopePath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadPreviewGeojson() {
  const p = previewGeojsonPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
