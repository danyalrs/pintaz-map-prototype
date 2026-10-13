/**
 * Deterministic greedy 50 m cell coverage selection (max 3 routes, max 2 per dongle group).
 */

function tieBreakScore(route, support) {
  return {
    spans_both_gates: support?.spans_meeting_both_gates ?? 0,
    lane_edge: (support?.inside_lane_observations ?? 0) + (support?.inside_edge_observations ?? 0),
    probe_ref: route.probe_ref,
    route_date: route.route_date_key ?? '',
    dongle_group: route.dongle_group ?? '',
  };
}

function compareTie(a, b) {
  if (a.spans_both_gates !== b.spans_both_gates) return b.spans_both_gates - a.spans_both_gates;
  if (a.lane_edge !== b.lane_edge) return b.lane_edge - a.lane_edge;
  if (a.dongle_group !== b.dongle_group) return a.dongle_group.localeCompare(b.dongle_group);
  if (a.route_date !== b.route_date) return a.route_date.localeCompare(b.route_date);
  return a.probe_ref.localeCompare(b.probe_ref);
}

export function greedyMarginalCoverageSelection({
  candidates,
  initialCoveredCells,
  routeCellsByRef,
  supportByRef,
  maxRoutes = 3,
  maxPerDongleGroup = 2,
}) {
  const baselineCovered = initialCoveredCells instanceof Set
    ? initialCoveredCells
    : new Set(initialCoveredCells);
  const covered = new Set(baselineCovered);
  const selected = [];
  const trace = [];
  const perGroup = new Map();
  const remaining = new Set(candidates.map((c) => c.probe_ref));

  for (let step = 1; step <= maxRoutes; step += 1) {
    let best = null;
    let bestMarginal = -1;
    let bestTie = null;

    for (const c of candidates) {
      if (!remaining.has(c.probe_ref)) continue;
      const gCount = perGroup.get(c.dongle_group) || 0;
      if (gCount >= maxPerDongleGroup) continue;
      const cells = routeCellsByRef.get(c.probe_ref) || new Set();
      const marginal = [...cells].filter((cell) => !covered.has(cell)).length;
      const tie = tieBreakScore(c, supportByRef.get(c.probe_ref));
      if (
        marginal > bestMarginal ||
        (marginal === bestMarginal && (bestTie === null || compareTie(tie, bestTie) < 0))
      ) {
        bestMarginal = marginal;
        best = c;
        bestTie = tie;
      }
    }

    if (!best || bestMarginal <= 0) {
      trace.push({ step, action: 'stop', reason: 'no_positive_marginal_cells' });
      break;
    }

    const cells = routeCellsByRef.get(best.probe_ref) || new Set();
    const added = [];
    for (const cell of cells) {
      if (!covered.has(cell)) {
        covered.add(cell);
        added.push(cell);
      }
    }

    selected.push(best.probe_ref);
    remaining.delete(best.probe_ref);
    perGroup.set(best.dongle_group, (perGroup.get(best.dongle_group) || 0) + 1);

    trace.push({
      step,
      action: 'select',
      probe_ref: best.probe_ref,
      dongle_group: best.dongle_group,
      marginal_new_cells: bestMarginal,
      cells_added_count: added.length,
      cumulative_covered_cells: covered.size,
      tie_break: bestTie,
    });
  }

  const excluded = candidates
    .filter((c) => !selected.includes(c.probe_ref))
    .map((c) => {
      const cells = routeCellsByRef.get(c.probe_ref) || new Set();
      const marginal = [...cells].filter((cell) => !baselineCovered.has(cell)).length;
      const reasons = [];
      if ((perGroup.get(c.dongle_group) || 0) >= maxPerDongleGroup && !selected.includes(c.probe_ref)) {
        reasons.push('dongle_group_cap_reached');
      }
      if (selected.length >= maxRoutes) reasons.push('selection_full');
      if (!reasons.length) reasons.push('lower_marginal_coverage_than_selected');
      return {
        probe_ref: c.probe_ref,
        dongle_group: c.dongle_group,
        total_novel_vs_active_only: marginal,
        marginal_after_greedy: [...cells].filter((cell) => !covered.has(cell)).length,
        exclusion_reasons: reasons,
      };
    });

  return { selected, trace, coveredCellCount: covered.size, excluded, perGroup };
}
