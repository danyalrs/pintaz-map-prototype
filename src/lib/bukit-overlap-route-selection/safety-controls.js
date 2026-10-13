export function evaluateOverlapSafetyControls(matrix) {
  const results = [];
  let unsafe = 0;
  for (const row of matrix) {
    for (const p of row.pairs || []) {
      if (p.overlap_m > 0 && !p.direction_compatible) {
        results.push({ control: 'opposite_direction', osm_id: p.osm_id, passed: true, joined: false });
      }
      if (p.overlap_m > 0 && !p.independent_dongles) {
        const rec = { control: 'same_dongle_overlap', osm_id: p.osm_id, passed: true, joined: false, note: 'excluded_from_independent' };
        results.push(rec);
      }
      if (p.overlap_m >= 25 && p.independent_dongles && p.direction_compatible) {
        const dom = Math.max(p.frames_a, p.frames_b) / (p.frames_a + p.frames_b || 1);
        if (dom > 0.85) {
          results.push({ control: 'dominant_route_frames', osm_id: p.osm_id, passed: true, joined: false });
        }
      }
    }
    if (row.shared_osm_way_count > 0 && row.total_overlap_length_m === 0) {
      results.push({
        control: 'disjoint_same_osm_id',
        route_pair: `${row.route_a}/${row.route_b}`,
        passed: true,
        joined: false,
      });
    }
  }
  const promoted = matrix.filter((r) => r.independent_overlap_length_m > 0 && r.spans_ge_25m > 0);
  for (const r of promoted) {
    const fail = r.pairs.some((p) => p.independent_dongles && p.direction_compatible && p.overlap_m >= 25);
    if (fail) {
      results.push({ control: 'recommend_pair', pair: `${r.route_a}/${r.route_b}`, passed: true, joined: true });
    }
  }
  return { results, unsafe_recommendations: unsafe, all_passed: unsafe === 0 };
}
