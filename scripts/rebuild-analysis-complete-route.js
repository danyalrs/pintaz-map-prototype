#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDerivedSelectedRoute } from '../src/lib/selected-route-derived-build.js';
import { DERIVED_ENVELOPE_PATH, DERIVED_PREVIEW_PATH, PAGE1_METRICS_SNAPSHOT_PATH } from '../src/lib/selected-route-paths.js';
import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';
import { buildOsmServerMismatchV1 } from '../src/lib/mismatch-build.js';
import { mismatchSummaryPath } from '../src/lib/mismatch-paths.js';
import { comparisonSummaryPath } from '../src/lib/comparison-paths.js';
import { previewGeojsonPath, updateEnvelopePath, UPDATE_BUNDLE_ID, UPDATE_PREVIEW_AREA_ID } from '../src/lib/update-preview-paths.js';
import { redactDongle, redactRoute } from '../src/lib/update-preview-prepare.js';
import { sha256Hex } from '../src/lib/json-nan-normalize.js';
import { loadRouteSelectionPrivate } from '../src/lib/selected-route-identity.js';
import {
  buildActiveSourceManifestFromEnvelope,
  writeActiveSourceManifest,
} from '../src/lib/active-source-manifest.js';

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function snapshotPage1Metrics() {
  const snap = { captured_at: new Date().toISOString() };
  if (fs.existsSync(comparisonSummaryPath())) {
    snap.comparison = JSON.parse(fs.readFileSync(comparisonSummaryPath(), 'utf8'));
  }
  if (fs.existsSync(mismatchSummaryPath())) {
    snap.mismatch = JSON.parse(fs.readFileSync(mismatchSummaryPath(), 'utf8'));
  }
  atomicWriteJson(PAGE1_METRICS_SNAPSHOT_PATH, snap);
  return snap;
}

function syncUpdatePreviewFromDerived(derivedEnvelope) {
  const previewText = fs.readFileSync(DERIVED_PREVIEW_PATH, 'utf8');
  const previewPath = previewGeojsonPath();
  const tmp = `${previewPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, previewText, 'utf8');
  fs.renameSync(tmp, previewPath);

  const selection = loadRouteSelectionPrivate();
  const envelope = {
    update_id: derivedEnvelope.route_status === 'complete' ? 'bukit-complete-route-v1' : 'bukit-partial-route-v1',
    update_schema: 'pintaz.maps-read.update-preview',
    update_schema_version: 1,
    created_at: new Date().toISOString(),
    area_id: UPDATE_PREVIEW_AREA_ID,
    source_type: 'maps-read-api-merged',
    source_response_path: 'data/maps-read/selected-route-v1/derived/complete-route-preview.geojson',
    source_response_sha256: sha256Hex(previewText),
    source_response_size: Buffer.byteLength(previewText),
    normalized_preview_path: `data/maps-read/updates/${UPDATE_BUNDLE_ID}/preview.geojson`,
    normalized_preview_sha256: sha256Hex(previewText),
    normalization: derivedEnvelope.normalization,
    requested_layers: ['lane_point', 'edge_point', 'vehicle_pose', 'gps_point'],
    original_api_metadata: {},
    source_dongle_redacted: derivedEnvelope.source_dongle_redacted,
    source_route_redacted: derivedEnvelope.source_route_redacted,
    source_dongle: selection.dongle,
    source_route: selection.route,
    bbox: selection.bbox,
    total_feature_count: derivedEnvelope.total_features,
    counts_by_layer: derivedEnvelope.counts_by_layer,
    inside_area_count: derivedEnvelope.inside_area_count,
    outside_area_count: derivedEnvelope.outside_area_count,
    truncated: derivedEnvelope.truncated,
    next_after_seg: derivedEnvelope.next_after_seg,
    page_scope: derivedEnvelope.route_status === 'complete' ? 'complete-selected-route' : 'partial-selected-route',
    route_page_count: derivedEnvelope.total_pages,
    route_status: derivedEnvelope.route_status,
    acceptance_state: 'pending',
    acceptance_history: [],
    baseline_osm_changed: false,
    source_page_hashes: derivedEnvelope.source_page_hashes,
  };
  atomicWriteJson(updateEnvelopePath(), envelope);

  const manifest = buildActiveSourceManifestFromEnvelope(envelope, {
    previewSha256: sha256Hex(previewText),
    derivedPreviewSha256: sha256Hex(fs.readFileSync(DERIVED_PREVIEW_PATH, 'utf8')),
    rawPageHashes: derivedEnvelope.source_page_hashes,
  });
  writeActiveSourceManifest(manifest);
}

function main() {
  snapshotPage1Metrics();
  const derived = buildDerivedSelectedRoute();
  if (!derived.ok) {
    console.error(derived.error || 'derived_build_failed');
    process.exit(1);
  }
  const derivedEnvelope = JSON.parse(fs.readFileSync(DERIVED_ENVELOPE_PATH, 'utf8'));
  syncUpdatePreviewFromDerived(derivedEnvelope);

  const comparison = buildObservationOsmComparison();
  if (!comparison.ok) {
    console.error(comparison.error);
    process.exit(2);
  }
  const mismatch = buildOsmServerMismatchV1();
  if (!mismatch.ok) {
    console.error(mismatch.error);
    process.exit(3);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        route_complete: derived.routeComplete,
        total_features: derived.totalFeatures,
        comparison_sections: comparison.summary?.section_count,
        mismatch_actionable: mismatch.actionable_count,
      },
      null,
      2
    )
  );
}

main();
