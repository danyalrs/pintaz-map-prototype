import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';

export const UPDATE_PREVIEW_AREA_ID = 'bukit-bintang-imbi';
export const UPDATE_BUNDLE_ID = 'bukit-sample-page-1';

function mapsReadDir() {
  return mapsReadRootDir();
}

export const RAW_SAMPLE_PATH = path.join(mapsReadDir(), 'samples', 'bukit_sample_drive.geojson');
export const ROUTE_SELECTION_PRIVATE_PATH = path.join(mapsReadDir(), 'samples', 'route_selection.private.json');

export function resolveUpdatePreviewPaths({
  mapsReadRoot = mapsReadDir(),
  bundleId = UPDATE_BUNDLE_ID,
  rawSamplePath = null,
} = {}) {
  const bundleDir = path.join(mapsReadRoot, 'updates', bundleId);
  return {
    mapsReadRoot,
    bundleId,
    bundleDir,
    rawSamplePath: rawSamplePath || path.join(mapsReadRoot, 'samples', 'bukit_sample_drive.geojson'),
    previewPath: path.join(bundleDir, 'preview.geojson'),
    envelopePath: path.join(bundleDir, 'update-envelope.json'),
  };
}

export function updateBundleDir(bundleId = UPDATE_BUNDLE_ID) {
  const safe = sanitizeBundleId(bundleId);
  if (!safe) throw new Error('Invalid update bundle id');
  return path.join(mapsReadDir(), 'updates', safe);
}

export function previewGeojsonPath(bundleId = UPDATE_BUNDLE_ID) {
  return path.join(updateBundleDir(bundleId), 'preview.geojson');
}

export function updateEnvelopePath(bundleId = UPDATE_BUNDLE_ID) {
  return path.join(updateBundleDir(bundleId), 'update-envelope.json');
}

export function sanitizeBundleId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;
  return id;
}

export function resolveUnderUpdates(relativePath) {
  const base = path.join(mapsReadDir(), 'updates');
  const resolved = path.resolve(base, relativePath);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}
