import { createHash } from 'node:crypto';
import { classifyOsmWayTransition } from './continuation.js';

export function logicalRoadId(memberOsmIds) {
  const ordered = [...new Set(memberOsmIds.map(String))].sort();
  return createHash('sha256').update(`logical-road|${ordered.join(',')}`).digest('hex').slice(0, 16);
}

export function buildSafeTransitionGraph(pairs, wayStore, params) {
  const edges = [];
  const byPair = new Map();
  for (const { from_osm_id, to_osm_id } of pairs) {
    const key = `${from_osm_id}->${to_osm_id}`;
    if (byPair.has(key)) continue;
    const verdict = classifyOsmWayTransition(from_osm_id, to_osm_id, wayStore, params);
    byPair.set(key, verdict);
    if (verdict.classification === 'safe_unique_continuation') {
      edges.push({
        from_osm_id: String(from_osm_id),
        to_osm_id: String(to_osm_id),
        ...verdict,
      });
    }
  }
  return { edges, byPair };
}

export function connectedComponentsFromEdges(edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const e of edges) {
    unite(e.from_osm_id, e.to_osm_id);
  }
  const groups = new Map();
  for (const e of edges) {
    for (const id of [e.from_osm_id, e.to_osm_id]) {
      const root = find(id);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root).add(id);
    }
  }
  return groups;
}

export function osmToLogicalRoadMap(edges) {
  const components = connectedComponentsFromEdges(edges);
  const map = new Map();
  for (const members of components.values()) {
    const ids = [...members];
    const lid = logicalRoadId(ids);
    for (const id of ids) map.set(id, { logical_road_id: lid, member_osm_ids: ids.sort() });
  }
  return map;
}

export function chainStats(edges, osmMap) {
  const sizes = [...osmMap.values()].map((v) => v.member_osm_ids.length);
  return {
    logical_chain_count: sizes.length,
    max_chain_member_count: sizes.length ? Math.max(...sizes) : 0,
    multi_member_chains: sizes.filter((s) => s > 1).length,
  };
}
