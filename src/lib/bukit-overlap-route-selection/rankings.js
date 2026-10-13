import { SUPPORT_MIN_FRAMES, SUPPORT_MIN_LENGTH_M } from './config.js';

function scorePair(row) {
  if (!row.independent_compatible_overlaps) return -1;
  return (
    row.independent_overlap_length_m * 10 +
    row.spans_ge_25m * 100 +
    row.spans_ge_10m * 20 +
    row.joint_frames
  );
}

export function activeAnchoredRanking(matrix, activeKey = 'active') {
  return matrix
    .filter((r) => r.route_a === activeKey || r.route_b === activeKey)
    .map((r) => ({
      ...r,
      candidate: r.route_a === activeKey ? r.route_b : r.route_a,
      score: scorePair(r),
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || String(a.candidate).localeCompare(b.candidate));
}

export function globalOverlapRanking(matrix) {
  return [...matrix]
    .map((r) => ({ ...r, score: scorePair(r) }))
    .filter((r) => r.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score || `${a.route_a}-${a.route_b}`.localeCompare(`${b.route_a}-${b.route_b}`)
    );
}

export function selectProposedRoutes(activeRanked, globalRanked, inventory, maxAdditional = 3) {
  const byKey = new Map(inventory.map((i) => [i.route_key, i]));
  const chosen = new Set(['active']);
  const chosenDongles = new Set([byKey.get('active')?.dongle_group].filter(Boolean));
  const proposed = [];
  const tryAdd = (routeKey, reason) => {
    if (!routeKey || routeKey === 'active' || chosen.has(routeKey) || proposed.length >= maxAdditional) return;
    const dg = byKey.get(routeKey)?.dongle_group;
    if (dg && chosenDongles.has(dg)) return;
    chosen.add(routeKey);
    if (dg) chosenDongles.add(dg);
    proposed.push({ route_key: routeKey, dongle_group: dg, reason });
  };
  for (const r of activeRanked) {
    tryAdd(r.candidate, 'active_anchored_overlap');
  }
  for (const r of globalRanked) {
    tryAdd(r.route_a, 'global_pair_overlap');
    tryAdd(r.route_b, 'global_pair_overlap');
  }
  return {
    anchor: 'active',
    proposed_additional_routes: proposed,
    distinct_dongles_in_set: [...new Set(
      ['active', ...proposed.map((p) => p.route_key)].map((k) => inventory.find((i) => i.route_key === k || (k === 'active' && i.redacted_route_ref === 'active'))?.dongle_group)
    )].filter(Boolean).length,
  };
}

export function noveltySetComparison() {
  return {
    novelty_oriented_set: ['active', 'drive-001', 'drive-008', 'drive-010'],
    shared_matched_osm_ways: 0,
    note: 'From accepted same-osm-way cross-drive accumulation diagnosis',
  };
}
