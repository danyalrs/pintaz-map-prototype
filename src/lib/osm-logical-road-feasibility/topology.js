import { bearingDeg, coordKey, lineLengthM } from './geo-utils.js';

function wayProps(f) {
  const p = f.properties || {};
  return {
    osm_id: String(p.osm_id),
    name: p.name ?? null,
    ref: p.ref ?? null,
    highway: p.highway ?? null,
    lanes: p.lanes ?? null,
    oneway: p.oneway ?? null,
    bridge: p.bridge ?? null,
    tunnel: p.tunnel ?? null,
    layer: p.layer ?? null,
    junction: p.junction ?? null,
    access: p.access ?? null,
    service: p.service ?? null,
  };
}

function endpointRecord(f, end) {
  const coords = f.geometry?.coordinates || [];
  if (coords.length < 2) return null;
  const props = wayProps(f);
  const idx = end === 'start' ? 0 : coords.length - 1;
  const neighbor = end === 'start' ? 1 : coords.length - 2;
  const c = coords[idx];
  const n = coords[neighbor];
  const outward = bearingDeg(c[0], c[1], n[0], n[1]);
  const inward = bearingDeg(n[0], n[1], c[0], c[1]);
  return {
    ...props,
    endpoint: end,
    lon: c[0],
    lat: c[1],
    coord_key: coordKey(c[0], c[1]),
    outward_bearing_deg: outward,
    inward_bearing_deg: inward,
    length_m: lineLengthM(coords),
  };
}

/**
 * Read-only Bukit OSM endpoint topology index (does not mutate GeoJSON).
 */
export function buildOsmEndpointTopology(roadsGeojson) {
  const ways = new Map();
  const endpoints = [];
  for (const f of roadsGeojson.features || []) {
    if (f.geometry?.type !== 'LineString') continue;
    const id = String(f.properties?.osm_id);
    ways.set(id, { feature: f, props: wayProps(f), coords: f.geometry.coordinates });
    const s = endpointRecord(f, 'start');
    const e = endpointRecord(f, 'end');
    if (s) endpoints.push(s);
    if (e) endpoints.push(e);
  }

  const byExactKey = new Map();
  for (const ep of endpoints) {
    if (!byExactKey.has(ep.coord_key)) byExactKey.set(ep.coord_key, []);
    byExactKey.get(ep.coord_key).push(ep);
  }

  const index = {
    schema: 'pintaz.osm-endpoint-topology.v1',
    way_count: ways.size,
    endpoint_count: endpoints.length,
    ways: Object.fromEntries(
      [...ways.entries()].map(([id, w]) => [
        id,
        {
          osm_id: id,
          ...w.props,
          length_m: lineLengthM(w.coords),
          coord_count: w.coords.length,
        },
      ])
    ),
    endpoints,
    exact_node_groups: [...byExactKey.entries()].map(([k, eps]) => ({
      coord_key: k,
      degree: eps.length,
      osm_endpoints: eps.map((e) => ({ osm_id: e.osm_id, endpoint: e.endpoint })),
    })),
  };
  return index;
}

export function endpointsWithinTolerance(endpoints, toleranceM) {
  const groups = [];
  if (toleranceM <= 0) {
    const byKey = new Map();
    for (const ep of endpoints) {
      if (!byKey.has(ep.coord_key)) byKey.set(ep.coord_key, []);
      byKey.get(ep.coord_key).push(ep);
    }
    for (const [key, eps] of byKey) {
      if (eps.length >= 2) groups.push({ kind: 'exact', coord_key: key, members: eps });
    }
    return groups;
  }
  const used = new Set();
  for (let i = 0; i < endpoints.length; i++) {
    if (used.has(i)) continue;
    const cluster = [endpoints[i]];
    used.add(i);
    for (let j = i + 1; j < endpoints.length; j++) {
      if (used.has(j)) continue;
      const d =
        haversineApprox(endpoints[i].lon, endpoints[i].lat, endpoints[j].lon, endpoints[j].lat);
      if (d <= toleranceM) {
        cluster.push(endpoints[j]);
        used.add(j);
      }
    }
    if (cluster.length >= 2) groups.push({ kind: 'near', tolerance_m: toleranceM, members: cluster });
  }
  return groups;
}

function haversineApprox(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const φ1 = lat1 * (Math.PI / 180);
  const φ2 = lat2 * (Math.PI / 180);
  const dφ = (lat2 - lat1) * (Math.PI / 180);
  const dλ = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
