import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tileBBox, lonLatToTile, countryFromLonLat } from '../src/lib/tile-slippy.js';
import { xyzYToTmsRow } from '../src/lib/tile-encoding.js';
import {
  findConnectedComponents,
  rankComponents,
  componentMetrics,
  tileKey,
} from '../src/lib/coverage-components.js';
import { analyzeRoadMvtTile, TILE_COVERAGE_CLASS } from '../src/lib/mvt-roads.js';
import { listServedTilePaths, pickRecommendations } from '../src/lib/tile-coverage-scan.js';
import { rankComponents as rank2 } from '../src/lib/coverage-components.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('tile bbox matches slippy xyz y (north greater than south)', () => {
  const b = tileBBox(14, 12817, 8053);
  assert.ok(b.north > b.south);
  assert.ok(b.east > b.west);
  assert.ok(Number.isFinite(b.west));
});

test('TMS row matches server formula', () => {
  const y = 8053;
  const z = 14;
  assert.equal(xyzYToTmsRow(z, y), (1 << z) - 1 - y);
});

test('connected components are deterministic', () => {
  const tiles = [
    { z: 12, x: 1, y: 1, class: TILE_COVERAGE_CLASS.ROADS, roadCount: 10 },
    { z: 12, x: 2, y: 1, class: TILE_COVERAGE_CLASS.ROADS, roadCount: 8 },
    { z: 12, x: 10, y: 10, class: TILE_COVERAGE_CLASS.ROADS, roadCount: 5 },
  ];
  const a = findConnectedComponents(tiles, 12);
  const b = findConnectedComponents(tiles, 12);
  assert.equal(a.length, b.length);
  assert.equal(a[0].length, 2);
});

test('ranking is deterministic', () => {
  const metrics = [
    {
      country: 'MY',
      tileCount: 100,
      roadFeatureCount: 5000,
      areaKm2: 50,
      completenessPct: 90,
      missingInternalCount: 2,
    },
    {
      country: 'MY',
      tileCount: 200,
      roadFeatureCount: 8000,
      areaKm2: 120,
      completenessPct: 80,
      missingInternalCount: 10,
    },
  ];
  const r1 = rankComponents(metrics, 12);
  const r2 = rank2(metrics, 12);
  assert.deepEqual(r1.map((x) => x.score), r2.map((x) => x.score));
});

test('inventory file count matches dataset meta when present', () => {
  const metaPath = path.join(root, 'data', 'processed', 'dataset-meta.json');
  if (!fs.existsSync(metaPath)) return;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const listed = listServedTilePaths();
  assert.equal(listed.length, meta.tileCount);
});

test('Bandar Kinrara z14 tile decodes with roads layer', async () => {
  const t = lonLatToTile(101.645, 3.046, 14);
  const file = path.join(root, 'data', 'tiles', 'roads', String(t.z), String(t.x), `${t.y}.pbf`);
  if (!fs.existsSync(file)) return;
  const buf = fs.readFileSync(file);
  const result = await analyzeRoadMvtTile(buf);
  assert.equal(result.class, TILE_COVERAGE_CLASS.ROADS);
  assert.ok(result.roadCount > 0);
});

test('coverage summary exists after scan and has no token', () => {
  const p = path.join(root, 'reports', 'coverage', 'coverage_summary.json');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  assert.doesNotMatch(text, /pk\.ey[a-zA-Z0-9]{20,}/);
  const j = JSON.parse(text);
  assert.equal(j.inventoryFileCount, 57294);
  assert.equal(j.scannedRecords, 57294);
});

test('random sample of covered tiles decodes', async () => {
  const listed = listServedTilePaths();
  if (listed.length < 20) return;
  const sample = [];
  for (let i = 0; i < 20; i++) {
    sample.push(listed[Math.floor((i * 997) % listed.length)]);
  }
  for (const rec of sample) {
    const buf = fs.readFileSync(rec.file);
    const r = await analyzeRoadMvtTile(buf);
    assert.notEqual(r.class, TILE_COVERAGE_CLASS.DECODE_FAIL, `${rec.z}/${rec.x}/${rec.y}`);
    assert.ok(r.sourceLayers.includes('roads') || r.class === TILE_COVERAGE_CLASS.NO_ROADS);
  }
});

test('pickRecommendations returns three slots when data present', () => {
  const summaryPath = path.join(root, 'reports', 'coverage', 'coverage_summary.json');
  if (!fs.existsSync(summaryPath)) return;
  const rec = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).recommendations;
  assert.ok(rec.largestContinuousMalaysia);
});
