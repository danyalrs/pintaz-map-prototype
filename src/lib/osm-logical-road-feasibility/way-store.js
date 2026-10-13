import { bearingDeg, coordKey, lineLengthM } from './geo-utils.js';

export function readWayMeta(props = {}) {
  return {
    osm_id: String(props.osm_id),
    name: props.name ?? null,
    ref: props.ref ?? null,
    highway: props.highway ?? null,
    lanes: props.lanes ?? null,
    oneway: props.oneway ?? null,
    bridge: props.bridge ?? null,
    tunnel: props.tunnel ?? null,
    layer: props.layer ?? null,
    junction: props.junction ?? null,
    access: props.access ?? null,
    service: props.service ?? null,
  };
}

export function buildWayStore(roadsGeojson) {
  const ways = new Map();
  const endpoints = [];
  for (const f of roadsGeojson.features || []) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    const meta = readWayMeta(f.properties);
    const start = coords[0];
    const end = coords[coords.length - 1];
    const record = {
      ...meta,
      coords,
      length_m: lineLengthM(coords),
      start: {
        lon: start[0],
        lat: start[1],
        coord_key: coordKey(start[0], start[1]),
        outward_bearing_deg: bearingDeg(start[0], start[1], coords[1][0], coords[1][1]),
        inward_bearing_deg: bearingDeg(coords[1][0], coords[1][1], start[0], start[1]),
      },
      end: {
        lon: end[0],
        lat: end[1],
        coord_key: coordKey(end[0], end[1]),
        outward_bearing_deg: bearingDeg(end[0], end[1], coords[coords.length - 2][0], coords[coords.length - 2][1]),
        inward_bearing_deg: bearingDeg(coords[coords.length - 2][0], coords[coords.length - 2][1], end[0], end[1]),
      },
    };
    ways.set(meta.osm_id, record);
    endpoints.push({ ...meta, which: 'start', ...record.start });
    endpoints.push({ ...meta, which: 'end', ...record.end });
  }
  const degreeByKey = new Map();
  for (const ep of endpoints) {
    degreeByKey.set(ep.coord_key, (degreeByKey.get(ep.coord_key) || 0) + 1);
  }
  return { ways, endpoints, degreeByKey };
}

export function wayEndpoint(way, which) {
  return which === 'start' ? way.start : way.end;
}

export function exitEndpointForTransition(fromWay, toWay) {
  const pairs = [
    ['end', 'start'],
    ['end', 'end'],
    ['start', 'start'],
    ['start', 'end'],
  ];
  let best = null;
  for (const [a, b] of pairs) {
    const ea = wayEndpoint(fromWay, a);
    const eb = wayEndpoint(toWay, b);
    const d = haversine(ea, eb);
    if (!best || d < best.distance_m) {
      best = { from_end: a, to_end: b, distance_m: d, from_coord: ea, to_coord: eb };
    }
  }
  return best;
}

function haversine(a, b) {
  const R = 6371000;
  const φ1 = a.lat * (Math.PI / 180);
  const φ2 = b.lat * (Math.PI / 180);
  const dφ = (b.lat - a.lat) * (Math.PI / 180);
  const dλ = (b.lon - a.lon) * (Math.PI / 180);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
