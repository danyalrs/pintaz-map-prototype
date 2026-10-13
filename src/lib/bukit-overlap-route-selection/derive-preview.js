import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveUpdatePreviewPaths } from '../update-preview-paths.js';
import { probeRawPath } from '../bukit-page1-probe-paths.js';
import { parseProbePageCollection } from '../bukit-page1-parse.js';

export function derivedPreviewPathForRoute(routeKey, probeRef, dataDir) {
  const dir = path.join(dataDir, 'private', 'derived-previews');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${routeKey}.geojson`);
}

export function ensureDerivedPreview(routeKey, probeRef, dataDir) {
  const out = derivedPreviewPathForRoute(routeKey, probeRef, dataDir);
  if (routeKey === 'active') {
    return { previewPath: resolveUpdatePreviewPaths().previewPath, derived: false };
  }
  if (fs.existsSync(out)) {
    return { previewPath: out, derived: true };
  }
  const rawPath = probeRawPath(probeRef);
  const collection = parseProbePageCollection(fs.readFileSync(rawPath));
  const features = (collection.features || []).map((f, i) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: { ...(f.properties || {}), source_feature_index: i, drive_namespace: routeKey },
  }));
  const geo = { type: 'FeatureCollection', features, metadata: { overlap_selection_derived: true } };
  fs.writeFileSync(out, `${JSON.stringify(geo)}\n`, 'utf8');
  return { previewPath: out, derived: true, sha256: createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex') };
}
