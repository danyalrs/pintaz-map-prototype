import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './json-nan-normalize.js';
import { countByLayer, insideOutsideCounts, parseBboxString } from './update-preview-stats.js';
import {
  DERIVED_ENVELOPE_PATH,
  DERIVED_PREVIEW_PATH,
  DERIVED_VALIDATION_PATH,
  PAGE_MANIFEST_PRIVATE_PATH,
  PAGE_000_PATH,
  EXISTING_RAW_SOURCE_PATH,
  SELECTED_ROUTE_DERIVED_DIR,
  SELECTED_ROUTE_RAW_DIR,
} from './selected-route-paths.js';
import { loadRouteSelectionPrivate } from './selected-route-identity.js';
import { parseRawPageForDerived, coordinateBounds, validateNormalizedDerivedFeature } from './selected-route-page-validate.js';
import { redactDongle, redactRoute } from './update-preview-prepare.js';

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function atomicWriteJson(filePath, obj) {
  atomicWrite(filePath, `${JSON.stringify(obj, null, 2)}\n`);
}

function listOrderedRawPages() {
  if (!fs.existsSync(SELECTED_ROUTE_RAW_DIR)) return [];
  return fs
    .readdirSync(SELECTED_ROUTE_RAW_DIR)
    .filter((f) => /^page-\d{3}.*\.geojson$/.test(f) && !f.endsWith('.part'))
    .sort();
}

function featureFingerprint(feature) {
  return JSON.stringify({
    g: feature.geometry,
    p: feature.properties,
  });
}

export function ensurePage000FromExisting() {
  fs.mkdirSync(SELECTED_ROUTE_RAW_DIR, { recursive: true });
  if (!fs.existsSync(EXISTING_RAW_SOURCE_PATH)) {
    throw new Error('existing_raw_missing');
  }
  if (fs.existsSync(PAGE_000_PATH)) {
    const a = sha256Hex(fs.readFileSync(EXISTING_RAW_SOURCE_PATH));
    const b = sha256Hex(fs.readFileSync(PAGE_000_PATH));
    if (a !== b) throw new Error('page_000_hash_mismatch');
    return { copied: false, sha256: a, sourcePath: EXISTING_RAW_SOURCE_PATH };
  }
  fs.copyFileSync(EXISTING_RAW_SOURCE_PATH, PAGE_000_PATH);
  const sha = sha256Hex(fs.readFileSync(PAGE_000_PATH));
  return { copied: true, sha256: sha, sourcePath: EXISTING_RAW_SOURCE_PATH };
}

export function buildDerivedSelectedRoute() {
  const selection = loadRouteSelectionPrivate();
  const pageFiles = listOrderedRawPages();
  if (!pageFiles.length) return { ok: false, error: 'no_raw_pages' };

  const pageManifest = [];
  const allFeatures = [];
  let totalRawNan = 0;
  let totalNormalizedReplacements = 0;
  let lastTruncated = true;
  let lastNext = null;

  for (let pageIndex = 0; pageIndex < pageFiles.length; pageIndex += 1) {
    const fileName = pageFiles[pageIndex];
    const filePath = path.join(SELECTED_ROUTE_RAW_DIR, fileName);
    const buf = fs.readFileSync(filePath);
    const sha = sha256Hex(buf);
    const { collection, replacementCount, rawLiteralNan } = parseRawPageForDerived(buf);
    totalRawNan += rawLiteralNan;
    totalNormalizedReplacements += replacementCount;
    const md = collection.metadata ?? {};
    lastTruncated = Boolean(md.truncated);
    lastNext = md.next_after_seg ?? null;

    const features = collection.features ?? [];
    for (let fi = 0; fi < features.length; fi += 1) {
      const f = features[fi];
      allFeatures.push({
        ...f,
        properties: {
          ...(f.properties || {}),
          source_page: pageIndex,
          source_feature_index: fi,
        },
      });
    }

    pageManifest.push({
      page_number: pageIndex,
      file_name: fileName,
      sha256: sha,
      byte_size: buf.length,
      requested_after_seg: pageIndex === 0 ? null : pageManifest[pageIndex - 1]?.returned_next_after_seg ?? null,
      returned_next_after_seg: md.next_after_seg ?? null,
      truncated: Boolean(md.truncated),
      feature_count: features.length,
      layer_counts: countByLayer(features),
      http_status: 200,
      schema: md.schema,
      schema_version: md.schema_version,
    });
  }

  const fpCounts = new Map();
  for (const f of allFeatures) {
    const fp = featureFingerprint(f);
    fpCounts.set(fp, (fpCounts.get(fp) || 0) + 1);
  }
  let duplicateGroups = 0;
  let duplicateFeatureInstances = 0;
  for (const c of fpCounts.values()) {
    if (c > 1) {
      duplicateGroups += 1;
      duplicateFeatureInstances += c - 1;
    }
  }

  const layerCounts = countByLayer(allFeatures);
  const bounds = coordinateBounds(allFeatures);
  const areaBbox = parseBboxString(selection.bbox);
  const { inside_area_count, outside_area_count } = areaBbox
    ? insideOutsideCounts(allFeatures, areaBbox)
    : { inside_area_count: null, outside_area_count: null };

  let invalidDerived = 0;
  for (const f of allFeatures) {
    if (!validateNormalizedDerivedFeature(f)) invalidDerived += 1;
  }

  const routeComplete = lastTruncated === false;
  const firstPage = parseRawPageForDerived(fs.readFileSync(path.join(SELECTED_ROUTE_RAW_DIR, pageFiles[0]))).collection;
  const mergedMeta = { ...(firstPage.metadata || {}) };
  mergedMeta.truncated = lastTruncated;
  mergedMeta.next_after_seg = lastNext;
  mergedMeta.merged_page_count = pageFiles.length;
  mergedMeta.merged_feature_count = allFeatures.length;

  const previewCollection = {
    type: 'FeatureCollection',
    name: firstPage.name || 'kommu-maps-visualization-point-cloud',
    metadata: mergedMeta,
    features: allFeatures,
  };

  const previewText = `${JSON.stringify(previewCollection)}\n`;
  atomicWrite(DERIVED_PREVIEW_PATH, previewText);

  const envelope = {
    envelope_schema: 'pintaz.maps-read.complete-route',
    envelope_schema_version: 1,
    source: 'Maps Read visualization GeoJSON',
    raw_pages_immutable: true,
    normalization: {
      type: 'transport_only',
      description: 'Bare NaN converted to null in derived copy only',
      replacement_count: totalNormalizedReplacements,
      raw_literal_nan_count: totalRawNan,
    },
    route_status: routeComplete ? 'complete' : 'partial',
    total_pages: pageFiles.length,
    total_features: allFeatures.length,
    counts_by_layer: layerCounts,
    coordinate_bounds: bounds,
    inside_area_count,
    outside_area_count,
    source_page_hashes: pageManifest.map((p) => p.sha256),
    baseline_osm_changed: false,
    acceptance_state: 'pending',
    source_dongle_redacted: redactDongle(selection.dongle),
    source_route_redacted: redactRoute(selection.route),
    truncated: lastTruncated,
    next_after_seg: lastNext,
  };
  atomicWriteJson(DERIVED_ENVELOPE_PATH, envelope);

  const validation = {
    ok: invalidDerived === 0,
    invalid_derived_coordinates: invalidDerived,
    duplicate_groups: duplicateGroups,
    duplicate_extra_instances: duplicateFeatureInstances,
    features_retained: allFeatures.length,
    pages: pageManifest.length,
    anomalies: invalidDerived ? ['derived_non_finite_coordinates'] : [],
  };
  atomicWriteJson(DERIVED_VALIDATION_PATH, validation);

  const privateManifest = {
    pages: pageManifest,
    source_dongle: selection.dongle,
    source_route: selection.route,
    built_at: new Date().toISOString(),
  };
  atomicWriteJson(PAGE_MANIFEST_PRIVATE_PATH, privateManifest);

  return {
    ok: true,
    routeComplete,
    totalPages: pageFiles.length,
    totalFeatures: allFeatures.length,
    layerCounts,
    bounds,
    duplicateGroups,
    duplicateFeatureInstances,
    totalRawNan,
    totalNormalizedReplacements,
    pageHashes: pageManifest.map((p) => p.sha256),
  };
}
