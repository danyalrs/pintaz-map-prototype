import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../../config.js';
import { mapsReadRootDir } from '../maps-read-root.js';
import {
  RAW_SAMPLE_PATH,
  previewGeojsonPath,
  updateEnvelopePath,
  resolveUpdatePreviewPaths,
} from '../update-preview-paths.js';
import {
  activeSourceManifestPath,
  loadActiveSourceManifest,
  validateActiveSourceManifest,
} from '../active-source-manifest.js';
import { probeRawPath, PROBE_RAW_DIR } from '../bukit-page1-probe-paths.js';
import { derivedPreviewPath, explorerRootDir } from '../local-route-explorer/paths.js';
import { OBSERVATION_ROUTES } from '../local-route-explorer/config.js';

export const SOURCE_LEVELS = [
  'active_source_manifest',
  'complete_route_derived',
  'update_preview_bundle',
  'page1_probe_raw',
  'local_route_explorer_derived',
  'comparison_matched_poses',
];

export function relFromRoot(abs) {
  if (!abs) return null;
  return path.relative(ROOT_DIR, abs).replace(/\\/g, '/');
}

export function resolveActivePreviewAbs() {
  const v = validateActiveSourceManifest();
  if (v.ok) return v.previewAbs;
  return previewGeojsonPath();
}

export function resolveCompleteRoutePreview() {
  return path.join(mapsReadRootDir(), 'selected-route-v1', 'derived', 'complete-route-preview.geojson');
}

export function resolveCompleteRouteRawPages() {
  const rawDir = path.join(mapsReadRootDir(), 'selected-route-v1', 'raw');
  if (!fs.existsSync(rawDir)) return [];
  return fs
    .readdirSync(rawDir)
    .filter((n) => n.endsWith('.geojson'))
    .map((n) => path.join(rawDir, n));
}

export function listInventoryPaths() {
  const manifest = loadActiveSourceManifest();
  const paths = {
    active_source_manifest: relFromRoot(activeSourceManifestPath()),
    complete_route_preview: relFromRoot(resolveCompleteRoutePreview()),
    complete_route_envelope: relFromRoot(
      path.join(mapsReadRootDir(), 'selected-route-v1', 'derived', 'complete-route-envelope.json')
    ),
    update_preview_preview: relFromRoot(previewGeojsonPath()),
    update_preview_envelope: relFromRoot(updateEnvelopePath()),
    raw_sample_page1: relFromRoot(RAW_SAMPLE_PATH),
    probe_raw_dir: relFromRoot(PROBE_RAW_DIR),
    local_route_explorer_root: relFromRoot(explorerRootDir()),
    derived_previews: OBSERVATION_ROUTES.map((r) => ({
      route_key: r.route_key,
      path: relFromRoot(derivedPreviewPath(r.route_key)),
      probe_raw: relFromRoot(probeRawPath(r.probe_ref)),
    })),
    code_prepare: 'src/lib/update-preview-prepare.js',
    code_bootstrap: 'src/lib/update-preview-bootstrap.js',
    code_explorer_derive: 'src/lib/local-route-explorer/bootstrap.js',
    code_page_parse: 'src/lib/bukit-page1-parse.js',
  };
  if (manifest?.preview_relative_path) {
    paths.manifest_preview_relative = manifest.preview_relative_path;
    paths.manifest_envelope_relative = manifest.envelope_relative_path;
  }
  return paths;
}
