import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT_DIR } from '../../src/config.js';
import { resolveUpdatePreviewPaths } from '../../src/lib/update-preview-paths.js';
import { comparisonDir } from '../../src/lib/comparison-paths.js';
import { mismatchDir } from '../../src/lib/mismatch-paths.js';

const PROD_SAMPLES = path.join(ROOT_DIR, 'data', 'maps-read', 'samples', 'bukit_sample_drive.geojson');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export function createIsolatedMapsReadFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pintaz-maps-read-'));
  const samplesDir = path.join(root, 'samples');
  fs.mkdirSync(samplesDir, { recursive: true });
  if (fs.existsSync(PROD_SAMPLES)) {
    fs.copyFileSync(PROD_SAMPLES, path.join(samplesDir, 'bukit_sample_drive.geojson'));
  }
  const previewPaths = resolveUpdatePreviewPaths({ mapsReadRoot: root });
  fs.mkdirSync(previewPaths.bundleDir, { recursive: true });
  fs.mkdirSync(comparisonDir(root), { recursive: true });
  fs.mkdirSync(mismatchDir(root), { recursive: true });
  return {
    root,
    previewPaths,
    comparisonOutputDir: comparisonDir(root),
    mismatchOutputDir: mismatchDir(root),
  };
}

export function withIsolatedMapsReadRoot(fixture, fn) {
  const prev = process.env.PINTAZ_MAPS_READ_ROOT;
  process.env.PINTAZ_MAPS_READ_ROOT = fixture.root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PINTAZ_MAPS_READ_ROOT;
    else process.env.PINTAZ_MAPS_READ_ROOT = prev;
  }
}

export function cleanupIsolatedMapsReadFixture(fixture) {
  if (fixture?.root && fs.existsSync(fixture.root)) {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

export function liveCompleteRouteSnapshot() {
  const envelopePath = path.join(
    ROOT_DIR,
    'data',
    'maps-read',
    'updates',
    'bukit-sample-page-1',
    'update-envelope.json'
  );
  const previewPath = path.join(
    ROOT_DIR,
    'data',
    'maps-read',
    'updates',
    'bukit-sample-page-1',
    'preview.geojson'
  );
  const manifestPath = path.join(ROOT_DIR, 'data', 'maps-read', 'active-source.manifest.private.json');
  if (!fs.existsSync(envelopePath) || !fs.existsSync(previewPath)) return null;
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  return {
    envelopePath,
    previewPath,
    manifestPath,
    envelopeSha256: sha256File(envelopePath),
    previewSha256: sha256File(previewPath),
    manifestSha256: fs.existsSync(manifestPath) ? sha256File(manifestPath) : null,
    route_status: envelope.route_status,
    total_features: envelope.total_feature_count,
    raw_preview_sha: envelope.source_response_sha256,
  };
}
