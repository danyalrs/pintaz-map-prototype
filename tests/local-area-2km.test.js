import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  squareFromCentreExact2km,
  validateSquare,
  isInsideMalaysia,
} from '../src/lib/geo-square.js';
import { lineIntersectsBounds } from '../src/lib/bbox-clip.js';
import { extractLocalAreaRoads } from '../src/lib/extract-local-area.js';
import { detailedRoadLayerDefinitions, DETAILED_SOURCE_ID } from '../src/public/detailed-road-layers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('2 km square width and height within tolerance', () => {
  const sq = squareFromCentreExact2km(101.645, 3.046);
  const v = validateSquare(sq);
  assert.equal(v.okSize, true);
  assert.ok(sq.widthM >= 1995 && sq.widthM <= 2005);
  assert.ok(sq.heightM >= 1995 && sq.heightM <= 2005);
  assert.ok(Math.abs(sq.areaKm2 - 4) < 0.02);
});

test('centre inside square and Malaysia', () => {
  const sq = squareFromCentreExact2km(101.645, 3.046);
  const { west, south, east, north } = sq.bounds;
  const { lon, lat } = sq.centre;
  assert.ok(lon >= west && lon <= east && lat >= south && lat <= north);
  assert.equal(isInsideMalaysia(lon, lat), true);
});

test('bounds ordering', () => {
  const sq = squareFromCentreExact2km(101.645, 3.046);
  assert.ok(sq.bounds.west < sq.bounds.east);
  assert.ok(sq.bounds.south < sq.bounds.north);
});

test('deterministic extraction hash', async () => {
  const sq = squareFromCentreExact2km(101.645, 3.046);
  const a = await extractLocalAreaRoads(sq.bounds);
  const b = await extractLocalAreaRoads(sq.bounds);
  assert.equal(a.contentHash, b.contentHash);
});

test('extracted geojson features have osm_id and highway', async () => {
  const metaPath = path.join(root, 'data', 'local-area', 'bandar-kinrara-2km-metadata.json');
  if (!fs.existsSync(metaPath)) return;
  const geoPath = path.join(root, 'data', 'local-area', 'bandar-kinrara-2km-roads.geojson');
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  assert.ok(geo.features.length > 0);
  for (const f of geo.features) {
    assert.ok(f.properties.osm_id);
    assert.ok(f.properties.highway);
    assert.equal(f.geometry.type, 'LineString');
    for (const [lon, lat] of f.geometry.coordinates) {
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
    }
    const b = squareFromCentreExact2km(101.645, 3.046).bounds;
    assert.equal(lineIntersectsBounds(f.geometry.coordinates, b), true);
  }
});

test('map layer definitions use pintaz-detailed-roads source', () => {
  const layers = detailedRoadLayerDefinitions();
  assert.ok(layers.length >= 40);
  for (const l of layers) {
    if (l.type === 'line' || l.type === 'symbol') {
      assert.equal(l.source, DETAILED_SOURCE_ID);
    }
  }
});

test('app has fit 2km and detailed layers', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'public', 'app.js'), 'utf8');
  assert.match(app, /fit-2km/);
  assert.match(app, /DETAILED_SOURCE_ID/);
  assert.match(app, /detailedRoadLayerDefinitions/);
  assert.match(app, /fitMapToBounds/);
  const selection = fs.readFileSync(path.join(root, 'src', 'public', 'map-selection.js'), 'utf8');
  assert.match(selection, /formatRoadInfo/);
  assert.match(selection, /road-click-info/);
});

test('local area endpoint smoke', async () => {
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const http = await import('node:http');
  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      const meta = await fetch(`http://127.0.0.1:${port}/api/local-area/bandar-kinrara/meta.json`);
      const geo = await fetch(`http://127.0.0.1:${port}/api/local-area/bandar-kinrara/roads.geojson`);
      server.close();
      if (fs.existsSync(path.join(root, 'data', 'local-area', 'bandar-kinrara-2km-metadata.json'))) {
        assert.equal(meta.status, 200);
        assert.equal(geo.status, 200);
      } else {
        assert.equal(meta.status, 404);
      }
      resolve();
    });
    server.on('error', reject);
  });
});
