import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const BUKIT_GEO = path.join(root, 'data', 'local-area', 'bukit-bintang-imbi-2km-roads.geojson');
const BUKIT_META = path.join(root, 'data', 'local-area', 'bukit-bintang-imbi-2km-metadata.json');
const KINRARA_GEO = path.join(root, 'data', 'local-area', 'bandar-kinrara-2km-roads.geojson');
const KINRARA_META = path.join(root, 'data', 'local-area', 'bandar-kinrara-2km-metadata.json');

const EXPECTED = {
  bukitGeoHash: 'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111',
  bukitMetaHash: 'd8636c794d33746a209f2341aeac78d797f1bf47c2ab4a2b65ca8d1c6d7bb57f',
  bukitFeatures: 3259,
  kinraraFeatures: 921,
  kinraraGeoPrefix: '14280508680f9c0a',
  kinraraMetaPrefix: 'db2d1a5d82057e90',
};

test('local area GeoJSON and metadata unchanged', () => {
  if (!fs.existsSync(BUKIT_GEO)) return;
  assert.equal(sha256File(BUKIT_GEO), EXPECTED.bukitGeoHash);
  assert.equal(JSON.parse(fs.readFileSync(BUKIT_GEO, 'utf8')).features.length, EXPECTED.bukitFeatures);
  if (fs.existsSync(BUKIT_META)) {
    assert.equal(sha256File(BUKIT_META), EXPECTED.bukitMetaHash);
  }
  if (fs.existsSync(KINRARA_GEO)) {
    assert.equal(JSON.parse(fs.readFileSync(KINRARA_GEO, 'utf8')).features.length, EXPECTED.kinraraFeatures);
    assert.ok(sha256File(KINRARA_GEO).startsWith(EXPECTED.kinraraGeoPrefix));
  }
  if (fs.existsSync(KINRARA_META)) {
    assert.ok(sha256File(KINRARA_META).startsWith(EXPECTED.kinraraMetaPrefix));
  }
});

test('.env and data/local-area remain gitignored', () => {
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gi, /\.env/);
  assert.match(gi, /data\/local-area/);
});
