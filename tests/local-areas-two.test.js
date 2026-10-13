import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LOCAL_AREA_ID,
  FALLBACK_LOCAL_AREA_ID,
  loadLocalAreaConfig,
  listConfiguredAreaIds,
  listPublicLocalAreas,
  localAreaGeojsonPath,
  localAreaMetaPath,
  normalizeAreaId,
  resolveAreaId,
} from '../src/lib/local-areas.js';
import { squareFromCentreExact2km, validateSquare } from '../src/lib/geo-square.js';
import { lineIntersectsBounds } from '../src/lib/bbox-clip.js';
import { extractLocalAreaRoads } from '../src/lib/extract-local-area.js';
import {
  parseAreaFromLocation,
  sanitizeAreaId,
  DEFAULT_AREA_ID,
  FALLBACK_AREA_ID,
} from '../src/public/area-selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KINRARA_GEO_HASH =
  '14280508680f9c0ad56928fe4dc91eacdd8c1c146e5738a70eb9e3af2e1ea945';
const KINRARA_META_HASH =
  'db2d1a5d82057e90a5538ce3478e8fba6fb1c3cd89da458f17a71381f52fab47';
const BUKIT_GEO_HASH =
  'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111';
const BUKIT_CONTENT_HASH =
  'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111';

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('two valid area configurations exist', () => {
  const ids = listConfiguredAreaIds();
  assert.deepEqual(ids, ['bandar-kinrara', 'bukit-bintang-imbi']);
});

test('default area is bukit-bintang-imbi with kinrara fallback', () => {
  assert.equal(DEFAULT_LOCAL_AREA_ID, 'bukit-bintang-imbi');
  assert.equal(FALLBACK_LOCAL_AREA_ID, 'bandar-kinrara');
  assert.equal(DEFAULT_AREA_ID, 'bukit-bintang-imbi');
  assert.equal(FALLBACK_AREA_ID, 'bandar-kinrara');
  assert.equal(resolveAreaId(''), 'bukit-bintang-imbi');
  assert.equal(resolveAreaId('invalid-area'), 'bukit-bintang-imbi');
  assert.equal(parseAreaFromLocation(''), 'bukit-bintang-imbi');
  assert.equal(parseAreaFromLocation('?area='), 'bukit-bintang-imbi');
  assert.equal(resolveAreaId('bandar-kinrara'), 'bandar-kinrara');
});

test('bukit bintang centre is exactly 3.150, 101.718', () => {
  const cfg = loadLocalAreaConfig('bukit-bintang-imbi');
  assert.equal(cfg.centre.lat, 3.15);
  assert.equal(cfg.centre.lon, 101.718);
});

test('each configured square is approximately 2 km', () => {
  for (const id of listConfiguredAreaIds()) {
    const cfg = loadLocalAreaConfig(id);
    const v = validateSquare({
      bounds: cfg.bounds,
      centre: { lon: cfg.centre.lon, lat: cfg.centre.lat },
      widthM: cfg.dimensions.widthM,
      heightM: cfg.dimensions.heightM,
    });
    assert.equal(v.okSize, true);
    assert.ok(cfg.dimensions.widthM >= 1995 && cfg.dimensions.widthM <= 2005);
    assert.ok(cfg.dimensions.heightM >= 1995 && cfg.dimensions.heightM <= 2005);
  }
});

test('kinrara geojson and metadata hashes unchanged', () => {
  const geo = localAreaGeojsonPath('bandar-kinrara');
  const meta = localAreaMetaPath('bandar-kinrara');
  assert.ok(fs.existsSync(geo));
  assert.ok(fs.existsSync(meta));
  assert.equal(sha256File(geo), KINRARA_GEO_HASH);
  assert.equal(sha256File(meta), KINRARA_META_HASH);
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  assert.equal(m.extraction.emitted, 921);
});

test('bukit bintang extraction output when present', async () => {
  const geoPath = localAreaGeojsonPath('bukit-bintang-imbi');
  const metaPath = localAreaMetaPath('bukit-bintang-imbi');
  if (!fs.existsSync(geoPath)) return;
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const sq = loadLocalAreaConfig('bukit-bintang-imbi');
  for (const f of geo.features) {
    assert.ok(f.properties.osm_id);
    assert.ok(f.properties.highway);
    assert.equal(lineIntersectsBounds(f.geometry.coordinates, sq.bounds), true);
  }
  assert.equal(meta.contentHash, sha256File(geoPath));
  const a = await extractLocalAreaRoads(sq.bounds);
  const b = await extractLocalAreaRoads(sq.bounds);
  assert.equal(a.contentHash, b.contentHash);
});

test('unknown area id normalization rejects traversal', () => {
  assert.equal(normalizeAreaId('../bandar-kinrara'), null);
  assert.equal(normalizeAreaId('bandar/kinrara'), null);
  assert.equal(sanitizeAreaId('..'), null);
  assert.equal(resolveAreaId('../etc/passwd'), 'bukit-bintang-imbi');
});

test('area list and endpoints smoke', async () => {
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const http = await import('node:http');
  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const list = await fetch(`${base}/api/local-areas`);
      assert.equal(list.status, 200);
      const body = await list.json();
      assert.equal(body.defaultAreaId, 'bukit-bintang-imbi');
      assert.equal(body.areas.length, 2);

      const bad = await fetch(`${base}/api/local-area/not-a-real-area/meta.json`);
      assert.equal(bad.status, 404);

      const trav = await fetch(`${base}/api/local-area/..%2F..%2Fetc/meta.json`);
      assert.equal(trav.status, 404);

      if (fs.existsSync(localAreaMetaPath('bandar-kinrara'))) {
        const meta = await fetch(`${base}/api/local-area/bandar-kinrara/meta.json`);
        const geo = await fetch(`${base}/api/local-area/bandar-kinrara/roads.geojson`);
        assert.equal(meta.status, 200);
        assert.equal(geo.status, 200);
        const geoBody = await geo.text();
        assert.doesNotMatch(geoBody, /pk\.ey/);
      }

      if (fs.existsSync(localAreaMetaPath('bukit-bintang-imbi'))) {
        const meta2 = await fetch(`${base}/api/local-area/bukit-bintang-imbi/meta.json`);
        const geo2 = await fetch(`${base}/api/local-area/bukit-bintang-imbi/roads.geojson`);
        assert.equal(meta2.status, 200);
        assert.equal(geo2.status, 200);
        const g1 = await fetch(`${base}/api/local-area/bandar-kinrara/roads.geojson`).then((r) => r.json());
        const g2 = await geo2.json();
        if (g1.features[0] && g2.features[0]) {
          assert.notEqual(g1.features[0].properties.osm_id, g2.features[0].properties.osm_id);
        }
      }

      server.close();
      resolve();
    });
    server.on('error', reject);
  });
});

test('selector and url parsing in markup and app', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'public', 'app.js'), 'utf8');
  assert.match(html, /id="area-selector"/);
  assert.match(app, /switchLocalArea/);
  assert.match(app, /setAreaInUrl/);
  assert.match(app, /bindAreaHistory/);
  assert.match(app, /\.setData\(roads\)/);
  assert.match(app, /getSource\(DETAILED_SOURCE_ID\)/);
  assert.doesNotMatch(app, /addSource\(DETAILED_SOURCE_ID[\s\S]*addSource\(DETAILED_SOURCE_ID/);
});

test('parseAreaFromLocation respects known ids', () => {
  const known = ['bandar-kinrara', 'bukit-bintang-imbi'];
  assert.equal(parseAreaFromLocation('?area=bukit-bintang-imbi', known), 'bukit-bintang-imbi');
  assert.equal(parseAreaFromLocation('?area=bandar-kinrara', known), 'bandar-kinrara');
  assert.equal(parseAreaFromLocation('?area=unknown', known), 'bukit-bintang-imbi');
});

test('bukit dataset file hashes unchanged when present', () => {
  const geo = localAreaGeojsonPath('bukit-bintang-imbi');
  const meta = localAreaMetaPath('bukit-bintang-imbi');
  if (!fs.existsSync(geo)) return;
  assert.equal(sha256File(geo), BUKIT_GEO_HASH);
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  assert.equal(m.extraction.emitted, 3259);
  assert.equal(m.contentHash, BUKIT_CONTENT_HASH);
});

test('public area list exposes bounds availability only', () => {
  const areas = listPublicLocalAreas();
  assert.equal(areas.length, 2);
  for (const a of areas) {
    assert.ok(a.id);
    assert.ok(a.displayName);
    assert.ok(a.centre);
    assert.ok(a.dimensions);
    assert.equal(typeof a.boundsAvailable, 'boolean');
  }
});

test('kommu viewer head unchanged', async () => {
  const { execSync } = await import('node:child_process');
  const head = execSync('git -C "C:\\Kommu AI Project" rev-parse HEAD', { encoding: 'utf8' }).trim();
  assert.equal(head, '3ada0b7e4f9a01b077b9dbdeaa1f2c3c8a662527');
});
