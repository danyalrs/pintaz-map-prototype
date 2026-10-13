/** Deterministic recommendation (max 3 routes, max 2 per dongle). No single opaque score. */

const USEFUL_STATUSES = new Set(['promising_page1_coverage', 'some_page1_coverage']);

export function rankKeysForRecommendation() {
  return [
    'inside_vehicle_pose',
    'inside_lane_point',
    'inside_edge_point',
    'unique_inside_frame_count',
    'inside_vehicle_path_length_m',
    'grid_cells_novel_vs_active',
    'grid_cells_overlap_active',
  ];
}

function compareCandidates(a, b) {
  const keys = [
    ['probe_status', (x) => (x.probe_status === 'promising_page1_coverage' ? 1 : 0)],
    ['inside_vehicle_pose', (x) => x.metrics.inside_vehicle_pose],
    ['inside_lane_point', (x) => x.metrics.inside_lane_point],
    ['inside_edge_point', (x) => x.metrics.inside_edge_point],
    ['unique_inside_frame_count', (x) => x.metrics.unique_inside_frame_count],
    ['inside_vehicle_path_length_m', (x) => x.metrics.inside_vehicle_path_length_m],
    ['grid_cells_novel_vs_active', (x) => x.metrics.grid_cells_novel_vs_active],
    ['grid_cells_overlap_active', (x) => -x.metrics.grid_cells_overlap_active],
    ['probe_ref', (x) => x.probe_ref],
  ];
  for (const [, fn] of keys) {
    const av = fn(a);
    const bv = fn(b);
    if (av !== bv) return bv > av ? 1 : -1;
  }
  return 0;
}

export function buildRankings(routeResults) {
  const valid = routeResults.filter((r) => r.probe_status !== 'request_failed' && r.probe_status !== 'invalid_page');
  const mk = (key, desc = true) =>
    [...valid].sort((a, b) => {
      const av = a.metrics[key] ?? 0;
      const bv = b.metrics[key] ?? 0;
      if (av !== bv) return desc ? bv - av : av - bv;
      return a.probe_ref.localeCompare(b.probe_ref);
    });

  return {
    inside_vehicle_poses: mk('inside_vehicle_pose'),
    inside_lane_observations: mk('inside_lane_point'),
    inside_edge_observations: mk('inside_edge_point'),
    unique_inside_frames: mk('unique_inside_frame_count'),
    continuous_inside_path_length: mk('inside_vehicle_path_length_m'),
    new_50m_coverage_cells: mk('grid_cells_novel_vs_active'),
    lowest_overlap_with_active: mk('grid_cells_overlap_active', false),
    combined_evidence_table: [...valid].sort(compareCandidates),
  };
}

function recommendationReason(entry) {
  const m = entry.metrics;
  const parts = [];
  if (entry.probe_status === 'promising_page1_coverage') {
    parts.push('page-1 meets 8-frame and 25 m vehicle-path evidence thresholds');
  } else if (entry.probe_status === 'some_page1_coverage') {
    parts.push('page-1 has pilot-area observations');
  }
  if (m.inside_lane_point >= 20) parts.push('adequate inside lane_point observations');
  if (m.inside_edge_point >= 10) parts.push('adequate inside edge_point observations');
  if (m.grid_cells_novel_vs_active > m.grid_cells_overlap_active) {
    parts.push('more novel 50 m cells than overlap with active route');
  } else if (m.grid_cells_novel_vs_active > 0) {
    parts.push('adds some spatial novelty vs active route');
  }
  if (!parts.length) parts.push('best available page-1 pilot evidence among eligible routes');
  return parts.join('; ');
}

export function recommendRoutesForFullPagination(routeResults, { maxRoutes = 3, maxPerDongle = 2 } = {}) {
  const eligible = routeResults
    .filter((r) => USEFUL_STATUSES.has(r.probe_status))
    .filter((r) => r.metrics.inside_vehicle_pose > 0 || r.metrics.unique_inside_frame_count > 0)
    .sort(compareCandidates);

  const later = routeResults
    .filter((r) => r.probe_status === 'no_pilot_points_on_page1')
    .map((r) => ({
      probe_ref: r.probe_ref,
      note: 'Pilot intersection may occur on a later page; not rejected.',
    }));

  const picked = [];
  const perDongle = new Map();
  const dates = new Set();

  for (const r of eligible) {
    if (picked.length >= maxRoutes) break;
    const d = perDongle.get(r.dongle) || 0;
    if (d >= maxPerDongle) continue;
    picked.push({
      ...r,
      recommendation_reason: recommendationReason(r),
    });
    perDongle.set(r.dongle, d + 1);
    const dk = String(r.route).slice(0, 10);
    dates.add(dk);
  }

  // Dongle diversity fill
  if (picked.length < maxRoutes) {
    const pickedRefs = new Set(picked.map((p) => p.probe_ref));
    const usedDongles = new Set(picked.map((p) => p.dongle));
    for (const r of eligible) {
      if (picked.length >= maxRoutes) break;
      if (pickedRefs.has(r.probe_ref)) continue;
      if (usedDongles.has(r.dongle)) continue;
      if ((perDongle.get(r.dongle) || 0) >= maxPerDongle) continue;
      picked.push({ ...r, recommendation_reason: recommendationReason(r) });
      perDongle.set(r.dongle, 1);
      pickedRefs.add(r.probe_ref);
    }
  }

  return {
    recommended: picked,
    later_page_scan_needed: later,
  };
}
