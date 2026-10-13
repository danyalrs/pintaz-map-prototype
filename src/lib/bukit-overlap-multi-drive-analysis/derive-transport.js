import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveUpdatePreviewPaths } from '../update-preview-paths.js';
import { probeRawPath } from '../bukit-page1-probe-paths.js';
import { parseProbePageCollection } from '../bukit-page1-parse.js';
import { normalizeBareNanInJson } from '../json-nan-normalize.js';

export function derivedPreviewPathForRoute(routeKey, dataDir) {
  const dir = path.join(dataDir, 'private', 'derived-previews');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${routeKey}.geojson`);
}

export function ensureDerivedTransportPreview(routeKey, probeRef, dataDir) {
  if (routeKey === 'active') {
    return {
      previewPath: resolveUpdatePreviewPaths().previewPath,
      derived_transport_copy: false,
      raw_sha256: null,
      nan_normalized: false,
    };
  }
  const out = derivedPreviewPathForRoute(routeKey, dataDir);
  const rawPath = probeRawPath(probeRef);
  const rawBuf = fs.readFileSync(rawPath);
  const raw_sha256 = createHash('sha256').update(rawBuf).digest('hex');
  if (fs.existsSync(out)) {
    return {
      previewPath: out,
      derived_transport_copy: true,
      raw_sha256,
      nan_normalized: /NaN/.test(rawBuf.toString('utf8')),
    };
  }
  const collection = parseProbePageCollection(rawBuf);
  const features = (collection.features || []).map((f, i) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: { ...(f.properties || {}), source_feature_index: i, drive_namespace: routeKey },
  }));
  const geo = {
    type: 'FeatureCollection',
    features,
    metadata: { overlap_multi_drive_derived: true, route_key: routeKey },
  };
  let text = JSON.stringify(geo);
  let nan_normalized = false;
  if (/NaN/.test(rawBuf.toString('utf8'))) {
    const { normalized } = normalizeBareNanInJson(text);
    text = normalized;
    nan_normalized = true;
  }
  fs.writeFileSync(out, `${text}\n`, 'utf8');
  return { previewPath: out, derived_transport_copy: true, raw_sha256, nan_normalized };
}
