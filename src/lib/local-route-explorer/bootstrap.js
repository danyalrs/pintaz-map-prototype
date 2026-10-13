import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveUpdatePreviewPaths } from '../update-preview-paths.js';
import { probeRawPath } from '../bukit-page1-probe-paths.js';
import { parseProbePageCollection } from '../bukit-page1-parse.js';
import { buildObservationOsmComparison } from '../comparison-build.js';
import { comparisonSummaryPath } from '../comparison-paths.js';
import { loadBukitPilotBbox } from '../bukit-pilot-bounds.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { EXPLORER_VERSION, OBSERVATION_ROUTES, observationRouteSpec } from './config.js';
import {
  explorerRootDir,
  derivedPreviewPath,
  routeComparisonDir,
  bundleManifestPath,
} from './paths.js';

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

export function ensureDerivedPreviewGeojson(routeKey) {
  const spec = observationRouteSpec(routeKey);
  if (!spec) return { ok: false, error: 'unknown_route' };
  if (routeKey === 'active') {
    const previewPath = resolveUpdatePreviewPaths().previewPath;
    if (!fs.existsSync(previewPath)) return { ok: false, error: 'active_preview_missing' };
    return { ok: true, previewPath, derived: false, source_kind: 'production_active_preview' };
  }
  const out = derivedPreviewPath(routeKey);
  const rawPath = probeRawPath(spec.probe_ref);
  if (!fs.existsSync(rawPath)) return { ok: false, error: 'raw_missing', rawPath };
  const rawSha = sha256File(rawPath);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const collection = parseProbePageCollection(fs.readFileSync(rawPath));
    const features = (collection.features || []).map((f, i) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { ...(f.properties || {}), source_feature_index: i, observation_route: routeKey },
    }));
    const geo = {
      type: 'FeatureCollection',
      features,
      metadata: { local_route_explorer_derived: true, schema: 'pintaz.local-route-explorer.derived-preview' },
    };
    fs.writeFileSync(out, `${JSON.stringify(geo)}\n`, 'utf8');
  }
  return {
    ok: true,
    previewPath: out,
    derived: true,
    source_kind: 'page1_probe_raw_transport_copy',
    raw_sha256: rawSha,
  };
}

export function ensureRouteComparisonBuilt(routeKey) {
  const preview = ensureDerivedPreviewGeojson(routeKey);
  if (!preview.ok) return preview;
  const outDir = routeComparisonDir(routeKey);
  const summaryPath = comparisonSummaryPath(outDir);
  if (fs.existsSync(summaryPath)) {
    return { ok: true, skipped: true, outputDir: outDir, previewPath: preview.previewPath };
  }
  const pilotBbox = loadBukitPilotBbox(DEFAULT_LOCAL_AREA_ID);
  const roadsPath = localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID);
  const result = buildObservationOsmComparison({
    previewPath: preview.previewPath,
    outputDir: outDir,
    roadsPath,
    pilotBbox,
  });
  return { ...result, outputDir: outDir, previewPath: preview.previewPath };
}

export function bootstrapLocalRouteExplorer() {
  fs.mkdirSync(path.join(explorerRootDir(), 'derived-previews'), { recursive: true });
  const bundles = [];
  for (const spec of OBSERVATION_ROUTES) {
    const preview = ensureDerivedPreviewGeojson(spec.route_key);
    const comparison = preview.ok ? ensureRouteComparisonBuilt(spec.route_key) : { ok: false };
    bundles.push({
      route_key: spec.route_key,
      preview_ok: preview.ok,
      comparison_ok: comparison.ok,
      derived_preview: preview.derived ?? false,
      raw_sha256_prefix: preview.raw_sha256 ? `${preview.raw_sha256.slice(0, 12)}…` : null,
      derived_preview_sha256_prefix:
        preview.previewPath && fs.existsSync(preview.previewPath)
          ? `${sha256File(preview.previewPath).slice(0, 12)}…`
          : null,
    });
  }
  const manifest = {
    schema: 'pintaz.local-route-explorer.bundle-manifest.redacted',
    version: 1,
    explorer_version: EXPLORER_VERSION,
    routes: bundles,
    note: 'Derived previews are transport-normalized copies; raw probe bytes are never modified.',
  };
  atomicWriteJson(bundleManifestPath(), manifest);
  return { ok: bundles.every((b) => b.preview_ok && b.comparison_ok), bundles };
}
