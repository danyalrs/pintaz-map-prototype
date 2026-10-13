import { median } from '../geo-segment.js';

function recordsInDirection(records, sign) {
  return records.filter((r) => r.direction_sign === sign && r.chain_s != null);
}

function sCoverage(records) {
  const s = records.map((r) => r.chain_s);
  if (!s.length) return null;
  return { min_s: Math.min(...s), max_s: Math.max(...s), length_m: Math.max(...s) - Math.min(...s) };
}

function connectedComponents(sValues, maxGapM) {
  const sorted = [...new Set(sValues)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const groups = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur - prev <= maxGapM) groups[groups.length - 1].push(cur);
    else groups.push([cur]);
  }
  return groups.map((g) => ({ min_s: g[0], max_s: g[g.length - 1], length_m: g[g.length - 1] - g[0] }));
}

function overlapInterval(a, b) {
  const lo = Math.max(a.min_s, b.min_s);
  const hi = Math.min(a.max_s, b.max_s);
  return hi > lo ? { min_s: lo, max_s: hi, length_m: hi - lo } : null;
}

function routeContribution(records, lo, hi) {
  const inSpan = records.filter((r) => r.chain_s >= lo && r.chain_s <= hi);
  const s = inSpan.map((r) => r.chain_s);
  const comp = connectedComponents(s, 15);
  const longest = comp.sort((a, b) => b.length_m - a.length_m)[0] || { length_m: 0 };
  return {
    frames: new Set(inSpan.map((r) => r.frame_id)).size,
    poses: inSpan.length,
    covered_length_m: longest.length_m,
    lane_obs: inSpan.reduce((a, r) => a + (r.lane_obs || 0), 0),
    edge_obs: inSpan.reduce((r, x) => r + (x.edge_obs || 0), 0),
    median_centreline_residual_m: median(inSpan.map((r) => r.centreline_residual_m).filter((v) => v != null)),
    median_heading_diff_deg: median(inSpan.map((r) => r.heading_diff_deg).filter((v) => v != null)),
    records: inSpan,
  };
}

export function reconstructPairSpans(routeA, routeB, metaA, metaB, { maxBinGapM = 10 } = {}) {
  const spans = [];
  const osmA = routeA.osm_records || {};
  const osmB = routeB.osm_records || {};
  const sharedIds = Object.keys(osmA).filter((id) => osmB[id]);
  const independent =
    metaA.dongle_group && metaB.dongle_group && metaA.dongle_group !== metaB.dongle_group;

  for (const osmId of sharedIds) {
    const signs = new Set([
      ...recordsInDirection(osmA[osmId], 1).length ? [1] : [],
      ...recordsInDirection(osmA[osmId], -1).length ? [-1] : [],
      ...recordsInDirection(osmB[osmId], 1).length ? [1] : [],
      ...recordsInDirection(osmB[osmId], -1).length ? [-1] : [],
    ]);
    for (const sign of signs) {
      const ra = recordsInDirection(osmA[osmId], sign);
      const rb = recordsInDirection(osmB[osmId], sign);
      if (!ra.length || !rb.length) continue;
      const covA = sCoverage(ra);
      const covB = sCoverage(rb);
      const ov = overlapInterval(covA, covB);
      if (!ov || ov.length_m <= 0) {
        spans.push({
          osm_id: osmId,
          direction_sign: sign,
          classification_hint: 'disjoint_coverage',
          shared_length_m: 0,
          route_a: routeA.route_key,
          route_b: routeB.route_key,
          independent_dongles: independent,
        });
        continue;
      }
      const jointS = [...ra, ...rb].map((r) => r.chain_s).filter((v) => v >= ov.min_s && v <= ov.max_s);
      const components = connectedComponents(jointS, maxBinGapM);
      for (const comp of components) {
        const contribA = routeContribution(ra, comp.min_s, comp.max_s);
        const contribB = routeContribution(rb, comp.min_s, comp.max_s);
        const disjoint =
          contribA.covered_length_m < 1 || contribB.covered_length_m < 1 || comp.length_m < 1;
        spans.push({
          osm_id: osmId,
          direction_sign: sign,
          span_start_s: comp.min_s,
          span_end_s: comp.max_s,
          shared_length_m: comp.length_m,
          route_keys: [routeA.route_key, routeB.route_key],
          redacted_routes: [metaA.redacted_route_ref, metaB.redacted_route_ref],
          dongle_groups: [metaA.dongle_group, metaB.dongle_group],
          independent_dongle_count: independent ? 2 : 1,
          disjoint_coverage: disjoint,
          per_route: {
            [routeA.route_key]: contribA,
            [routeB.route_key]: contribB,
          },
        });
      }
    }
  }
  return spans;
}

export function reconstructSetSpans(routes, metaByKey, { maxBinGapM = 10 } = {}) {
  const routeKeys = routes.map((r) => r.route_key);
  const osmIds = new Set();
  for (const r of routes) Object.keys(r.osm_records || {}).forEach((id) => osmIds.add(id));
  const spans = [];
  for (const osmId of osmIds) {
    const present = routes.filter((r) => r.osm_records?.[osmId]);
    if (present.length < 2) continue;
    const signs = new Set();
    for (const r of present) {
      for (const rec of r.osm_records[osmId]) {
        if (rec.direction_sign) signs.add(rec.direction_sign);
      }
    }
    for (const sign of signs) {
      const perRoute = {};
      for (const r of present) {
        perRoute[r.route_key] = recordsInDirection(r.osm_records[osmId], sign);
      }
      const activeRoutes = Object.entries(perRoute).filter(([, recs]) => recs.length);
      if (activeRoutes.length < 2) continue;
      let lo = -Infinity;
      let hi = Infinity;
      for (const [, recs] of activeRoutes) {
        const c = sCoverage(recs);
        lo = Math.max(lo, c.min_s);
        hi = Math.min(hi, c.max_s);
      }
      if (hi <= lo) continue;
      const jointS = [];
      for (const [, recs] of activeRoutes) {
        jointS.push(...recs.filter((r) => r.chain_s >= lo && r.chain_s <= hi).map((r) => r.chain_s));
      }
      const components = connectedComponents(jointS, maxBinGapM);
      for (const comp of components) {
        const per_route = {};
        const groups = new Set();
        for (const r of present) {
          const meta = metaByKey.get(r.route_key);
          per_route[r.route_key] = routeContribution(perRoute[r.route_key] || [], comp.min_s, comp.max_s);
          if (meta?.dongle_group) groups.add(meta.dongle_group);
        }
        spans.push({
          osm_id: osmId,
          direction_sign: sign,
          span_start_s: comp.min_s,
          span_end_s: comp.max_s,
          shared_length_m: comp.length_m,
          route_keys: present.map((r) => r.route_key),
          independent_dongle_count: groups.size,
          per_route,
        });
      }
    }
  }
  return spans;
}

export function auditWay39914067(spans) {
  return spans.filter((s) => String(s.osm_id) === '39914067');
}
