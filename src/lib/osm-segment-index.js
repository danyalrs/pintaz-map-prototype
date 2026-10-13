import { haversineMetres } from './geo-square.js';
import { bearingDeg } from './geo-segment.js';

export function segmentPropsFromFeature(props) {
  return {
    osm_id: String(props.osm_id ?? ''),
    highway: props.highway ?? null,
    name: props.name ?? null,
    ref: props.ref ?? null,
    lanes: props.lanes ?? null,
    oneway: props.oneway ?? null,
    bridge: props.bridge ?? null,
    tunnel: props.tunnel ?? null,
  };
}

/**
 * @param {import('geojson').FeatureCollection} roads
 */
export function buildOsmSegmentIndex(roads) {
  const segments = [];
  let segGlobalId = 0;
  for (const feature of roads.features || []) {
    if (feature.geometry?.type !== 'LineString') continue;
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const base = segmentPropsFromFeature(feature.properties || {});
    let offsetAlongM = 0;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const [aLon, aLat] = coords[i];
      const [bLon, bLat] = coords[i + 1];
      const lenM = haversineMetres(aLon, aLat, bLon, bLat);
      const heading = bearingDeg(aLon, aLat, bLon, bLat);
      segments.push({
        id: segGlobalId++,
        ...base,
        featureCoordIndex: i,
        start: [aLon, aLat],
        end: [bLon, bLat],
        headingDeg: heading,
        lengthM: lenM,
        offsetAlongFeatureM: offsetAlongM,
      });
      offsetAlongM += lenM;
    }
  }

  const cellSize = 0.00025;
  const grid = new Map();
  for (const seg of segments) {
    for (const [lon, lat] of [seg.start, seg.end]) {
      const key = cellKey(lon, lat, cellSize);
      if (!grid.has(key)) grid.set(key, []);
      const arr = grid.get(key);
      if (!arr.includes(seg.id)) arr.push(seg.id);
    }
  }

  return { segments, grid, cellSize, segmentById: new Map(segments.map((s) => [s.id, s])) };
}

function cellKey(lon, lat, cellSize) {
  return `${Math.floor(lon / cellSize)},${Math.floor(lat / cellSize)}`;
}

export function querySegmentsNear(index, lon, lat, radiusM) {
  const { segments, grid, cellSize, segmentById } = index;
  const cellSizeDeg = cellSize;
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat =
    111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const dLon = radiusM / mPerDegLon;
  const dLat = radiusM / mPerDegLat;
  const minCx = Math.floor((lon - dLon) / cellSizeDeg);
  const maxCx = Math.floor((lon + dLon) / cellSizeDeg);
  const minCy = Math.floor((lat - dLat) / cellSizeDeg);
  const maxCy = Math.floor((lat + dLat) / cellSizeDeg);
  const seen = new Set();
  const out = [];
  for (let cx = minCx; cx <= maxCx; cx += 1) {
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      const ids = grid.get(`${cx},${cy}`);
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(segmentById.get(id));
      }
    }
  }
  return out;
}
