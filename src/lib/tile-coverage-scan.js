import fs from 'node:fs';
import path from 'node:path';
import { tilesRootDir, readTileFile } from './tile-files.js';
import { readMbtilesTile, mbtilesExists } from './mbtiles-reader.js';
import { xyzYToTmsRow } from './tile-encoding.js';
import { analyzeRoadMvtTile, TILE_COVERAGE_CLASS } from './mvt-roads.js';
import {
  findConnectedComponents,
  componentMetrics,
  rankComponents,
  tilesToGeoJson,
  missingInternalGeoJson,
  tileKey,
} from './coverage-components.js';
import { countryFromLonLat, tileBBox } from './tile-slippy.js';

export function listServedTilePaths() {
  const root = tilesRootDir();
  const tiles = [];
  if (!fs.existsSync(root)) return tiles;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.pbf')) {
        const y = Number(name.replace('.pbf', ''));
        const x = Number(path.basename(path.dirname(p)));
        const z = Number(path.basename(path.dirname(path.dirname(p))));
        if ([z, x, y].every((n) => Number.isInteger(n))) {
          tiles.push({ z, x, y, file: p, bytes: st.size });
        }
      }
    }
  };
  walk(root);
  return tiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}

export async function scanTileRecord({ z, x, y, file, bytes }, options = {}) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (e) {
    return { z, x, y, bytes, class: TILE_COVERAGE_CLASS.DECODE_FAIL, roadCount: 0, error: e.message };
  }
  const analysis = await analyzeRoadMvtTile(buffer, options);
  return { z, x, y, bytes, ...analysis };
}

export async function verifyTmsSample(tiles, sampleSize = 5) {
  if (!mbtilesExists()) return { checked: 0, mismatches: [] };
  const sample = tiles.filter((t) => t.z >= 10).slice(0, sampleSize);
  const mismatches = [];
  for (const t of sample) {
    const fromDir = readTileFile(t.z, t.x, t.y);
    const fromMb = await readMbtilesTile(t.z, t.x, t.y);
    const tmsY = xyzYToTmsRow(t.z, t.y);
    if (fromDir && fromMb && fromDir.length !== fromMb.length) {
      mismatches.push({ z: t.z, x: t.x, y: t.y, tmsY, dirLen: fromDir.length, mbLen: fromMb.length });
    }
  }
  return { checked: sample.length, tmsYFormula: 'y_tms = (2^z - 1) - y_xyz', mismatches };
}

export async function runFullCoverageScan(options = {}) {
  const onProgress = options.onProgress || (() => {});
  const sparseThreshold = options.sparseThreshold ?? 3;
  const zoomLevels = options.zoomLevels || [10, 11, 12, 13, 14];
  const inventory = listServedTilePaths();
  const results = [];
  let i = 0;
  for (const rec of inventory) {
    if (!zoomLevels.includes(rec.z)) continue;
    const row = await scanTileRecord(rec, { sparseThreshold });
    results.push(row);
    i += 1;
    if (i % 2000 === 0) onProgress({ scanned: i, total: inventory.length });
  }
  onProgress({ scanned: i, total: inventory.length, done: true });

  const summaryByZoom = {};
  for (const z of zoomLevels) {
    const atZ = results.filter((t) => t.z === z);
    summaryByZoom[z] = summarizeTiles(atZ);
  }

  const componentsByZoom = {};
  const rankedByZoom = {};
  const componentByKeyMaps = {};
  for (const z of [10, 12, 14]) {
    const atZ = results.filter((t) => t.z === z);
    const comps = findConnectedComponents(atZ, z);
    const componentByKey = new Map();
    const metricsList = comps.map((members) => {
      const c0 = members[0];
      const b = tileBBox(c0.z, c0.x, c0.y);
      const country = countryFromLonLat((b.west + b.east) / 2, (b.south + b.north) / 2);
      return componentMetrics(members, z, country, atZ);
    });
    const ranked = rankComponents(metricsList, z);
    ranked.forEach((c, i) => {
      for (const m of comps[i]) componentByKey.set(tileKey(z, m.x, m.y), c.componentId);
    });
    componentsByZoom[z] = ranked;
    rankedByZoom[z] = {
      all: ranked,
      malaysia: ranked.filter((c) => c.country === 'MY'),
      singapore: ranked.filter((c) => c.country === 'SG'),
      brunei: ranked.filter((c) => c.country === 'BN'),
    };
    componentByKeyMaps[z] = componentByKey;
  }

  const geojsonByZoom = {};
  for (const z of [10, 12, 14]) {
    geojsonByZoom[z] = tilesToGeoJson(results, z, componentByKeyMaps[z]);
  }

  const tmsCheck = await verifyTmsSample(inventory);

  return {
    scannedAt: new Date().toISOString(),
    inventoryFileCount: inventory.length,
    scannedRecords: results.length,
    results,
    summaryByZoom,
    componentsByZoom,
    rankedByZoom,
    geojsonByZoom,
    tmsCheck,
    sparseThreshold,
  };
}

function summarizeTiles(tiles) {
  const counts = {
    total: tiles.length,
    roads: 0,
    sparse: 0,
    no_roads: 0,
    decode_fail: 0,
    roadFeatures: 0,
  };
  for (const t of tiles) {
    if (t.class === TILE_COVERAGE_CLASS.ROADS) counts.roads += 1;
    else if (t.class === TILE_COVERAGE_CLASS.SPARSE) counts.sparse += 1;
    else if (t.class === TILE_COVERAGE_CLASS.NO_ROADS) counts.no_roads += 1;
    else if (t.class === TILE_COVERAGE_CLASS.DECODE_FAIL) counts.decode_fail += 1;
    counts.roadFeatures += t.roadCount || 0;
  }
  counts.renderable = counts.roads + counts.sparse;
  return counts;
}

function smallPilotScore(c) {
  const compactness = 1 / Math.log10(10 + c.areaKm2);
  return c.completenessPct * Math.log10(1 + c.density) * compactness;
}

export function pickRecommendations(rankedByZoom) {
  const z14my = rankedByZoom[14]?.malaysia || [];
  const z12my = rankedByZoom[12]?.malaysia || [];
  const z10my = rankedByZoom[10]?.malaysia || [];

  const kinrara = { lon: 101.645, lat: 3.046 };
  const kinraraComponent = z14my.find(
    (c) =>
      kinrara.lon >= c.bounds.west &&
      kinrara.lon <= c.bounds.east &&
      kinrara.lat >= c.bounds.south &&
      kinrara.lat <= c.bounds.north
  );
  const bestSmall =
    [...z14my]
      .filter((c) => c.tileCount >= 20 && c.tileCount <= 2500)
      .sort((a, b) => smallPilotScore(b) - smallPilotScore(a))[0] ||
    kinraraComponent ||
    null;

  const bestMedium =
    [...z12my]
      .filter((c) => c.tileCount >= 100)
      .sort(
        (a, b) =>
          b.completenessPct * Math.log10(1 + b.roadFeatureCount) -
          a.completenessPct * Math.log10(1 + a.roadFeatureCount)
      )[0] || null;

  const largest =
    [...z14my].sort((a, b) => b.tileCount - a.tileCount)[0] ||
    [...z10my].sort((a, b) => b.tileCount - a.tileCount)[0] ||
    null;

  return {
    bestSmallDetailedPilot: bestSmall,
    bestMediumCityPilot: bestMedium,
    largestContinuousMalaysia: largest,
    scoringNotes: {
      bestSmall: 'z14 MY components with 20–2500 tiles and completeness≥65%, maximize completeness×density÷log(area)',
      bestMedium: 'z12 MY components with ≥100 tiles, maximize completeness×log(road features)',
      largest: 'z14 MY component with greatest road-tile count (4-neighbour connectivity)',
    },
  };
}
