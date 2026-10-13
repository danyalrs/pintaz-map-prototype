import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeBareNanInJson, sha256Hex } from './json-nan-normalize.js';
import { parseProbePageCollection } from './bukit-page1-parse.js';
import { countByLayer, insideOutsideCounts, parseBboxString } from './update-preview-stats.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from './update-preview-paths.js';
import { driveDerivedPreviewPath } from './multi-drive-mismatch-paths.js';
import { driveSpec, EXPECTED_RAW_SHA256 } from './multi-drive-mismatch-config.js';

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function pilotBbox() {
  const bboxStr = fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)
    ? JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8')).bbox
    : '101.708993,3.141007,101.727007,3.158993';
  return parseBboxString(bboxStr);
}

function loadCollectionFromRaw(spec) {
  const rawPath = spec.raw_path;
  if (!fs.existsSync(rawPath)) {
    throw new Error(`missing_raw:${spec.drive_key}`);
  }
  const buf = fs.readFileSync(rawPath);
  const sha = sha256Hex(buf);
  const expected = EXPECTED_RAW_SHA256[spec.drive_key];
  if (expected && sha !== expected) {
    throw new Error(`raw_sha_mismatch:${spec.drive_key}`);
  }
  let collection;
  if (spec.raw_kind === 'active_preview') {
    collection = JSON.parse(buf.toString('utf8'));
  } else {
    collection = parseProbePageCollection(buf);
  }
  return { buf, sha, collection };
}

function buildDerivedFeatures(collection, driveNamespace) {
  const features = collection.features || [];
  return features.map((f, sourceFeatureIndex) => {
    const props = { ...(f.properties || {}) };
    props.drive_namespace = driveNamespace;
    props.source_feature_index = sourceFeatureIndex;
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: props,
    };
  });
}

/**
 * Derived copy only: NaN → null in JSON serialization path for probe raws when needed.
 */
export function buildDerivedPreviewForDrive(driveKey, baseDir) {
  const spec = driveSpec(driveKey);
  const { buf, sha, collection } = loadCollectionFromRaw(spec);
  if (!collection?.features?.length) {
    throw new Error(`empty_collection:${driveKey}`);
  }
  const derivedFeatures = buildDerivedFeatures(collection, spec.drive_namespace);
  const bbox = pilotBbox();
  const { inside_area_count, outside_area_count } = insideOutsideCounts(derivedFeatures, bbox);
  const layers = countByLayer(derivedFeatures);
  const derived = {
    type: 'FeatureCollection',
    name: collection.name,
    metadata: {
      ...(collection.metadata || {}),
      multi_drive_derived: true,
      drive_namespace: spec.drive_namespace,
      redacted_drive_ref: spec.redacted_drive_ref,
      source_raw_sha256: sha,
      derived_at: new Date().toISOString(),
    },
    features: derivedFeatures,
  };
  let text = JSON.stringify(derived);
  if (spec.raw_kind === 'probe_page_1' && /NaN/.test(buf.toString('utf8'))) {
    const { normalized } = normalizeBareNanInJson(text);
    text = normalized;
    derived.features = JSON.parse(text).features;
  }
  const outPath = driveDerivedPreviewPath(driveKey, baseDir);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${text}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  const derivedSha = createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
  return {
    drive_key: driveKey,
    redacted_drive_ref: spec.redacted_drive_ref,
    raw_sha256: sha,
    derived_sha256: derivedSha,
    feature_count: derivedFeatures.length,
    inside_area_count,
    outside_area_count,
    layer_counts: layers,
    derived_preview_path: outPath,
  };
}

export function writeDerivedManifest(records, baseDir) {
  const manifestPath = path.join(baseDir, 'private', 'derived-build-manifest.private.json');
  atomicWriteJson(manifestPath, {
    schema: 'pintaz.multi-drive.derived-build',
    version: 1,
    drives: records,
    generated_at: new Date().toISOString(),
  });
  return manifestPath;
}
