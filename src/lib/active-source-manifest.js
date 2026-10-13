import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { sha256Hex } from './json-nan-normalize.js';
import { mapsReadRootDir } from './maps-read-root.js';

export const ACTIVE_SOURCE_MANIFEST_FILENAME = 'active-source.manifest.private.json';
export const ANALYSIS_GENERATION_VERSION = 'complete-selected-route-v1';

export function activeSourceManifestPath() {
  return path.join(mapsReadRootDir(), ACTIVE_SOURCE_MANIFEST_FILENAME);
}

export function resolveFromRepoRoot(relativePath) {
  const resolved = path.resolve(ROOT_DIR, relativePath);
  const rel = path.relative(ROOT_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

export function writeActiveSourceManifest(manifest) {
  const p = activeSourceManifestPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

export function loadActiveSourceManifest() {
  const p = activeSourceManifestPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function validateActiveSourceManifest(manifest = loadActiveSourceManifest()) {
  if (!manifest) return { ok: false, error: 'active_source_manifest_missing' };
  const previewRel = manifest.preview_relative_path;
  const envelopeRel = manifest.envelope_relative_path;
  if (!previewRel || !envelopeRel) {
    return { ok: false, error: 'manifest_paths_incomplete' };
  }
  const previewAbs = resolveFromRepoRoot(previewRel);
  const envelopeAbs = resolveFromRepoRoot(envelopeRel);
  if (!previewAbs || !envelopeAbs) {
    return { ok: false, error: 'manifest_paths_invalid' };
  }
  if (!fs.existsSync(previewAbs)) {
    return { ok: false, error: 'active_preview_missing', preview_relative_path: previewRel };
  }
  if (!fs.existsSync(envelopeAbs)) {
    return { ok: false, error: 'active_envelope_missing', envelope_relative_path: envelopeRel };
  }
  const previewSha = sha256Hex(fs.readFileSync(previewAbs));
  if (manifest.preview_sha256 && previewSha !== manifest.preview_sha256) {
    return { ok: false, error: 'active_preview_hash_mismatch' };
  }
  const envelope = JSON.parse(fs.readFileSync(envelopeAbs, 'utf8'));
  if (manifest.route_status && envelope.route_status !== manifest.route_status) {
    return { ok: false, error: 'envelope_route_status_mismatch' };
  }
  if (
    manifest.total_features != null &&
    envelope.total_feature_count != null &&
    envelope.total_feature_count !== manifest.total_features
  ) {
    return { ok: false, error: 'envelope_feature_count_mismatch' };
  }
  return {
    ok: true,
    previewAbs,
    envelopeAbs,
    previewSha256: previewSha,
    envelope,
  };
}

export function buildActiveSourceManifestFromEnvelope(envelope, { previewSha256, derivedPreviewSha256, rawPageHashes }) {
  const previewRel = envelope.normalized_preview_path || 'data/maps-read/updates/bukit-sample-page-1/preview.geojson';
  return {
    manifest_schema: 'pintaz.maps-read.active-source',
    manifest_schema_version: 1,
    source_type: envelope.route_status === 'complete' ? 'complete_selected_route' : 'partial_selected_route',
    route_status: envelope.route_status || (envelope.truncated ? 'partial' : 'complete'),
    raw_page_count: envelope.route_page_count ?? 1,
    total_features: envelope.total_feature_count,
    inside_pilot: envelope.inside_area_count,
    outside_pilot: envelope.outside_area_count,
    raw_page_hashes: rawPageHashes || envelope.source_page_hashes || [],
    preview_relative_path: previewRel,
    envelope_relative_path: 'data/maps-read/updates/bukit-sample-page-1/update-envelope.json',
    preview_sha256: previewSha256,
    derived_preview_sha256: derivedPreviewSha256 || null,
    generation_timestamp: new Date().toISOString(),
    analysis_generation_version: ANALYSIS_GENERATION_VERSION,
    source_dongle_redacted: envelope.source_dongle_redacted,
    source_route_redacted: envelope.source_route_redacted,
  };
}
