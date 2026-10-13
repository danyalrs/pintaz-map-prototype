import { tileBBox, bboxAreaKm2, countryFromLonLat, aggregateBounds } from './tile-slippy.js';
import { TILE_COVERAGE_CLASS } from './mvt-roads.js';

const ROAD_CLASSES = new Set([TILE_COVERAGE_CLASS.ROADS, TILE_COVERAGE_CLASS.SPARSE]);

export function tileKey(z, x, y) {
  return `${z}:${x}:${y}`;
}

/** Four-direction adjacency (N,S,E,W) in XYZ grid. */
export function adjacentKeys(z, x, y) {
  const max = (1 << z) - 1;
  const out = [];
  if (y > 0) out.push(tileKey(z, x, y - 1));
  if (y < max) out.push(tileKey(z, x, y + 1));
  if (x > 0) out.push(tileKey(z, x - 1, y));
  if (x < max) out.push(tileKey(z, x + 1, y));
  return out;
}

/**
 * @param {Array<{z:number,x:number,y:number,class:string,roadCount:number}>} tiles
 */
export function findConnectedComponents(tiles, zoom) {
  const roadTiles = tiles.filter((t) => t.z === zoom && ROAD_CLASSES.has(t.class));
  const keySet = new Set(roadTiles.map((t) => tileKey(t.z, t.x, t.y)));
  const byKey = new Map(roadTiles.map((t) => [tileKey(t.z, t.x, t.y), t]));
  const visited = new Set();
  const components = [];

  for (const t of roadTiles) {
    const start = tileKey(t.z, t.x, t.y);
    if (visited.has(start)) continue;
    const queue = [start];
    const members = [];
    visited.add(start);
    while (queue.length) {
      const k = queue.shift();
      const cur = byKey.get(k);
      if (cur) members.push(cur);
      const [z, x, y] = k.split(':').map(Number);
      for (const nk of adjacentKeys(z, x, y)) {
        if (!keySet.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        queue.push(nk);
      }
    }
    components.push(members);
  }
  return components.sort((a, b) => b.length - a.length);
}

export function componentMetrics(members, zoom, country, allTilesAtZoom) {
  const bounds = aggregateBounds(members);
  const centre = { lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 };
  const roadFeatureCount = members.reduce((s, t) => s + (t.roadCount || 0), 0);
  const xs = members.map((m) => m.x);
  const ys = members.map((m) => m.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const roadKeySet = new Set(members.map((m) => tileKey(zoom, m.x, m.y)));
  const fileKeySet = new Set(
    allTilesAtZoom.filter((t) => t.class !== TILE_COVERAGE_CLASS.MISSING).map((t) => tileKey(zoom, t.x, t.y))
  );
  let expected = 0;
  let presentRoad = 0;
  const missingInternal = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      expected += 1;
      const k = tileKey(zoom, x, y);
      if (roadKeySet.has(k)) {
        presentRoad += 1;
        continue;
      }
      if (!fileKeySet.has(k)) {
        missingInternal.push({ z: zoom, x, y });
      }
    }
  }
  const completenessPct = expected ? (presentRoad / expected) * 100 : 0;
  return {
    zoom,
    country,
    bounds,
    centre,
    tileCount: members.length,
    roadFeatureCount,
    areaKm2: bboxAreaKm2(bounds),
    rectTileExpected: expected,
    rectTileWithRoads: presentRoad,
    completenessPct,
    missingInternalCount: missingInternal.length,
    missingInternalSample: missingInternal.slice(0, 50),
    placeName: null,
  };
}

export function rankComponents(components, zoom) {
  return components
    .map((c, idx) => {
      const holePenalty = c.missingInternalCount;
      const density = c.tileCount ? c.roadFeatureCount / c.tileCount : 0;
      const score =
        c.areaKm2 * (c.completenessPct / 100) * Math.log10(1 + c.roadFeatureCount) -
        holePenalty * 2 +
        density * 0.1;
      return {
        ...c,
        componentId: `${(c.country || 'xx').toLowerCase()}-z${zoom}-c${String(idx + 1).padStart(3, '0')}`,
        score,
        holePenalty,
        density,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function coverageFillColor(className) {
  switch (className) {
    case TILE_COVERAGE_CLASS.ROADS:
      return '#22c55e';
    case TILE_COVERAGE_CLASS.SPARSE:
      return '#eab308';
    case TILE_COVERAGE_CLASS.NO_ROADS:
      return '#94a3b8';
    case TILE_COVERAGE_CLASS.DECODE_FAIL:
      return '#f97316';
    default:
      return '#e2e8f0';
  }
}

export function tilesToGeoJson(tiles, zoom, componentByKey) {
  const features = [];
  for (const t of tiles.filter((x) => x.z === zoom)) {
    if (t.class === TILE_COVERAGE_CLASS.MISSING) continue;
    const b = tileBBox(t.z, t.x, t.y);
    const centreLon = (b.west + b.east) / 2;
    const centreLat = (b.south + b.north) / 2;
    const country = countryFromLonLat(centreLon, centreLat);
    const compId = componentByKey?.get(tileKey(t.z, t.x, t.y)) || null;
    features.push({
      type: 'Feature',
      properties: {
        z: t.z,
        x: t.x,
        y: t.y,
        status: t.class,
        roadCount: t.roadCount,
        country,
        componentId: compId,
        fill: coverageFillColor(t.class),
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [b.west, b.south],
            [b.east, b.south],
            [b.east, b.north],
            [b.west, b.north],
            [b.west, b.south],
          ],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function missingInternalGeoJson(missingTiles, componentId) {
  const features = missingTiles.map((t) => {
    const b = tileBBox(t.z, t.x, t.y);
    return {
      type: 'Feature',
      properties: {
        z: t.z,
        x: t.x,
        y: t.y,
        status: 'missing_internal',
        componentId,
        fill: '#ef4444',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [b.west, b.south],
            [b.east, b.south],
            [b.east, b.north],
            [b.west, b.north],
            [b.west, b.south],
          ],
        ],
      },
    };
  });
  return { type: 'FeatureCollection', features };
}
