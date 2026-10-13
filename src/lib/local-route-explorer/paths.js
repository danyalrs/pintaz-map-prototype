import path from 'node:path';
import { mapsReadRootDir } from '../maps-read-root.js';
import { comparisonDir, comparisonSummaryPath, roadSectionsPath } from '../comparison-paths.js';
import { EXPLORER_VERSION } from './config.js';

export function explorerRootDir() {
  return path.join(mapsReadRootDir(), EXPLORER_VERSION);
}

export function derivedPreviewPath(routeKey) {
  return path.join(explorerRootDir(), 'derived-previews', `${routeKey}.geojson`);
}

export function routeComparisonDir(routeKey) {
  if (routeKey === 'active') return comparisonDir();
  return path.join(explorerRootDir(), 'comparison', routeKey, 'comparison-v1');
}

export function bundleManifestPath() {
  return path.join(explorerRootDir(), 'bundle-manifest.redacted.json');
}

export { comparisonSummaryPath, roadSectionsPath };
