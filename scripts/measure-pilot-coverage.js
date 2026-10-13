/**
 * Measure geographic extent of served road tiles near Bandar Kinrara / Puchong.
 * Reads tile directory only (no rebuild). Writes reports/pilot_area/coverage_audit.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { tilesRootDir } from '../src/lib/tile-files.js';
import { isGzipTile } from '../src/lib/tile-encoding.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'reports', 'pilot_area');

const SEED = {
  kinrara: { lon: 101.645, lat: 3.046, label: 'Bandar Kinrara' },
  puchong: { lon: 101.617, lat: 3.007, label: 'Puchong centre' },
};

/** Initial search window (degrees) around Kinrara–Puchong corridor. */
const SEARCH = { west: 101.52, south: 2.92, east: 101.78, north: 3.18 };

function tileBBox(z, x, y) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west, south, east, north };
}

function bboxIntersects(a, b) {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { z, x, y };
}

function walkTiles() {
  const root = tilesRootDir();
  const tiles = [];
  if (!fs.existsSync(root)) return tiles;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.pbf')) {
        const parts = p.split(path.sep);
        const y = Number(parts.at(-1).replace('.pbf', ''));
        const x = Number(parts.at(-2));
        const z = Number(parts.at(-3));
        if ([z, x, y].every((n) => Number.isInteger(n))) {
          tiles.push({ z, x, y, file: p, bytes: st.size });
        }
      }
    }
  };
  walk(root);
  return tiles;
}

async function decodeRoadCount(filePath) {
  const buf = fs.readFileSync(filePath);
  let raw = buf;
  if (isGzipTile(buf)) raw = zlib.gunzipSync(buf);
  let VectorTile;
  let Pbf;
  try {
    ({ VectorTile } = await import('@mapbox/vector-tile'));
    Pbf = (await import('pbf')).default;
  } catch {
    return { ok: false, reason: 'decode_deps_missing', roads: null };
  }
  try {
    const vt = new VectorTile(new Pbf(raw));
    const layer = vt.layers.roads;
    if (!layer) return { ok: false, reason: 'no_roads_layer', roads: 0 };
    return { ok: true, roads: layer.length, sample: layer.length ? layer.feature(0).properties : null };
  } catch (e) {
    return { ok: false, reason: String(e.message), roads: null };
  }
}

function aggregateBounds(tiles) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const t of tiles) {
    const b = tileBBox(t.z, t.x, t.y);
    west = Math.min(west, b.west);
    south = Math.min(south, b.south);
    east = Math.max(east, b.east);
    north = Math.max(north, b.north);
  }
  return { west, south, east, north };
}

function gridHolesAtZoom(tiles, z, bounds) {
  const set = new Set(tiles.filter((t) => t.z === z).map((t) => `${t.x},${t.y}`));
  const n = 2 ** z;
  const xMin = Math.floor(((bounds.west + 180) / 360) * n);
  const xMax = Math.floor(((bounds.east + 180) / 360) * n);
  const yFromLat = (lat) =>
    Math.floor(
      ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
        2) *
        n
    );
  const yMin = yFromLat(bounds.north);
  const yMax = yFromLat(bounds.south);
  const missing = [];
  let expected = 0;
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const b = tileBBox(z, x, y);
      if (!bboxIntersects(b, bounds)) continue;
      expected += 1;
      if (!set.has(`${x},${y}`)) missing.push({ z, x, y });
    }
  }
  return { expected, present: expected - missing.length, missingCount: missing.length, missingSample: missing.slice(0, 20) };
}

async function probePoint(label, lon, lat, tilesByZ) {
  const out = { label, lon, lat };
  for (const z of [10, 12, 14]) {
    const { x, y } = lonLatToTile(lon, lat, z);
    const key = `${z}/${x}/${y}`;
    const file = path.join(tilesRootDir(), String(z), String(x), `${y}.pbf`);
    const exists = fs.existsSync(file);
    out[`z${z}`] = { x, y, fileExists: exists };
    if (exists) {
      const dec = await decodeRoadCount(file);
      out[`z${z}`].decode = dec;
    }
  }
  return out;
}

async function main() {
  const allTiles = walkTiles();
  const inSearch = allTiles.filter((t) => bboxIntersects(tileBBox(t.z, t.x, t.y), SEARCH));

  const byZoom = {};
  for (const z of [10, 11, 12, 13, 14]) {
    byZoom[z] = inSearch.filter((t) => t.z === z);
  }

  const z10 = byZoom[10];
  const z14 = byZoom[14];
  const tileBounds = aggregateBounds(inSearch.length ? inSearch : allTiles.slice(0, 1));

  // Tighten pilot bounds from z14 tiles in search (finer footprint of verified files).
  const pilotBounds =
    z14.length > 0 ? aggregateBounds(z14) : z10.length > 0 ? aggregateBounds(z10) : null;

  const holesZ14 = pilotBounds ? gridHolesAtZoom(inSearch, 14, pilotBounds) : null;
  const holesZ10 = pilotBounds ? gridHolesAtZoom(inSearch, 10, pilotBounds) : null;

  const centre = pilotBounds
    ? {
        lon: (pilotBounds.west + pilotBounds.east) / 2,
        lat: (pilotBounds.south + pilotBounds.north) / 2,
      }
    : null;

  const corners = pilotBounds
    ? [
        { id: 'sw', lon: pilotBounds.west, lat: pilotBounds.south },
        { id: 'se', lon: pilotBounds.east, lat: pilotBounds.south },
        { id: 'nw', lon: pilotBounds.west, lat: pilotBounds.north },
        { id: 'ne', lon: pilotBounds.east, lat: pilotBounds.north },
      ]
    : [];

  const probes = [];
  probes.push(await probePoint(SEED.kinrara.label, SEED.kinrara.lon, SEED.kinrara.lat, byZoom));
  probes.push(await probePoint(SEED.puchong.label, SEED.puchong.lon, SEED.puchong.lat, byZoom));
  if (centre) {
    probes.push(await probePoint('pilot centre', centre.lon, centre.lat, byZoom));
    for (const c of corners) {
      probes.push(await probePoint(`corner ${c.id}`, c.lon, c.lat, byZoom));
    }
  }

  const globalBounds = aggregateBounds(allTiles);
  const mbtilesMeta = fs.existsSync(path.join(ROOT, 'data', 'processed', 'dataset-meta.json'))
    ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'processed', 'dataset-meta.json'), 'utf8'))
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    searchWindow: SEARCH,
    seeds: SEED,
    tileInventory: {
      totalFilesOnDisk: allTiles.length,
      inSearchWindow: inSearch.length,
      byZoomInSearch: Object.fromEntries(Object.entries(byZoom).map(([z, arr]) => [z, arr.length])),
      globalGeographicBoundsFromAllTiles: globalBounds,
    },
    proposedPilotBounds: pilotBounds,
    pilotCentre: centre,
    gridCompleteness: {
      z10: holesZ10,
      z14: holesZ14,
    },
    probes,
    datasetMeta: mbtilesMeta
      ? { minZoom: mbtilesMeta.minZoom, maxZoom: mbtilesMeta.maxZoom, tileCount: mbtilesMeta.tileCount }
      : null,
    contiguousAssessment:
      pilotBounds && holesZ14 && holesZ14.missingCount === 0
        ? 'full_z14_rect_in_search'
        : pilotBounds && holesZ14 && holesZ14.missingCount / holesZ14.expected < 0.05
          ? 'mostly_complete_z14_rect'
          : 'partial_or_holey',
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'coverage_audit.json'), JSON.stringify(report, null, 2));

  const md = [
    '# Pilot area coverage audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Search window',
    JSON.stringify(SEARCH, null, 2),
    '',
    '## Proposed pilot bounds (from z14 tiles in search)',
    pilotBounds ? JSON.stringify(pilotBounds, null, 2) : '_none_',
    '',
    '## Tile counts in search',
    JSON.stringify(report.tileInventory.byZoomInSearch, null, 2),
    '',
    '## Grid completeness (z14 within proposed bounds)',
    holesZ14 ? JSON.stringify(holesZ14, null, 2) : '_n/a_',
    '',
    '## Probe summary',
    ...probes.map(
      (p) =>
        `- **${p.label}** (${p.lon}, ${p.lat}): z14 exists=${p.z14?.fileExists} roads=${p.z14?.decode?.roads ?? 'n/a'}`
    ),
    '',
    `Assessment: **${report.contiguousAssessment}**`,
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'COVERAGE_AUDIT.md'), md);

  console.log(JSON.stringify({ pilotBounds, centre, contiguousAssessment: report.contiguousAssessment, holesZ14 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
