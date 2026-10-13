import { BIN_SIZE_GRID_M, MIN_OVERLAP_GRID_M, MAX_BIN_GAP_GRID_M, SUPPORT_MIN_FRAMES, SUPPORT_MIN_LENGTH_M } from './config.js';

function overlapInterval(a, b) {
  const lo = Math.max(a.min_s, b.min_s);
  const hi = Math.min(a.max_s, b.max_s);
  return hi > lo ? { lo, hi, length_m: hi - lo } : null;
}

function spanFromRecords(records, binSize) {
  const s = records.map((r) => r.chain_s).filter((v) => v != null);
  if (!s.length) return null;
  const bins = new Set(s.map((v) => Math.floor(v / binSize)));
  return {
    min_s: Math.min(...s),
    max_s: Math.max(...s),
    bins,
    frames: new Set(records.map((r) => r.frame_id)).size,
    lane_obs: records.reduce((a, r) => a + r.lane_obs, 0),
    edge_obs: records.reduce((a, r) => a + r.edge_obs, 0),
    direction_signs: [...new Set(records.map((r) => r.direction_sign).filter(Boolean))],
    laterals: records.map((r) => r.lateral_m).filter((v) => v != null),
  };
}

export function computePairwiseOverlap(routeA, routeB, metaA, metaB) {
  const pairs = [];
  const osmA = routeA.osm_records || {};
  const osmB = routeB.osm_records || {};
  const sharedIds = Object.keys(osmA).filter((id) => osmB[id]);
  const independent = metaA.dongle_group && metaB.dongle_group && metaA.dongle_group !== metaB.dongle_group;

  for (const osmId of sharedIds) {
    const sa = spanFromRecords(osmA[osmId], 5);
    const sb = spanFromRecords(osmB[osmId], 5);
    if (!sa || !sb) continue;
    const ov = overlapInterval(sa, sb);
    const dirOk =
      !sa.direction_signs.length ||
      !sb.direction_signs.length ||
      sa.direction_signs.some((d) => sb.direction_signs.includes(d));
    pairs.push({
      osm_id: osmId,
      overlap_m: ov?.length_m ?? 0,
      shared_bins: [...sa.bins].filter((b) => sb.bins.has(b)).length,
      frames_a: sa.frames,
      frames_b: sb.frames,
      lane_a: sa.lane_obs,
      lane_b: sb.lane_obs,
      edge_a: sa.edge_obs,
      edge_b: sb.edge_obs,
      direction_compatible: dirOk,
      independent_dongles: independent,
    });
  }
  const compat = pairs.filter((p) => p.direction_compatible && p.overlap_m > 0);
  const indepCompat = compat.filter((p) => p.independent_dongles);
  return {
    route_a: routeA.route_key,
    route_b: routeB.route_key,
    redacted_a: metaA.redacted_route_ref,
    redacted_b: metaB.redacted_route_ref,
    shared_osm_way_count: sharedIds.length,
    overlapping_osm_ways: compat.length,
    independent_compatible_overlaps: indepCompat.length,
    total_overlap_length_m: compat.reduce((s, p) => s + p.overlap_m, 0),
    independent_overlap_length_m: indepCompat.reduce((s, p) => s + p.overlap_m, 0),
    spans_ge_10m: compat.filter((p) => p.overlap_m >= 10).length,
    spans_ge_25m: compat.filter((p) => p.overlap_m >= 25).length,
    joint_frames: compat.reduce((s, p) => s + p.frames_a + p.frames_b, 0),
    pairs: compat,
  };
}

export function buildOverlapMatrices(routes, inventoryPublic) {
  const meta = new Map(inventoryPublic.map((r) => [r.route_key || inventoryPublic.find((x) => x.redacted_route_ref === r.redacted_route_ref)?.route_key, r]));
  const byKey = new Map(routes.map((r) => [r.route_key, r]));
  const keys = [...byKey.keys()];
  const matrix = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = byKey.get(keys[i]);
      const b = byKey.get(keys[j]);
      const invA = inventoryPublic.find((x) => x.route_key === keys[i] || (keys[i] === 'active' && x.redacted_route_ref === 'active'));
      const invB = inventoryPublic.find((x) => x.route_key === keys[j] || (keys[j].startsWith('drive') && x.redacted_route_ref === keys[j].replace('drive-', 'probe-')));
      const mA = invA || { redacted_route_ref: keys[i], dongle_group: null };
      const mB = invB || { redacted_route_ref: keys[j], dongle_group: null };
      matrix.push(computePairwiseOverlap(a, b, mA, mB));
    }
  }
  return matrix;
}

export function parameterSensitivitySweep(matrixPairs) {
  const results = [];
  for (const binSize of BIN_SIZE_GRID_M) {
    for (const minOv of MIN_OVERLAP_GRID_M) {
      for (const maxGap of MAX_BIN_GAP_GRID_M) {
        let indepPairs = 0;
        let spans = 0;
        let supportOk = 0;
        for (const row of matrixPairs) {
          if (row.independent_overlap_length_m <= 0) continue;
          const qualifying = row.pairs.filter(
            (p) => p.independent_dongles && p.direction_compatible && p.overlap_m >= minOv
          );
          if (qualifying.length) indepPairs += 1;
          spans += qualifying.length;
          supportOk += qualifying.filter(
            (p) => p.frames_a + p.frames_b >= SUPPORT_MIN_FRAMES && p.overlap_m >= SUPPORT_MIN_LENGTH_M
          ).length;
        }
        results.push({
          bin_size_m: binSize,
          min_overlap_m: minOv,
          max_bin_gap_m: maxGap,
          qualifying_independent_pairs: indepPairs,
          qualifying_spans: spans,
          spans_meeting_support: supportOk,
        });
      }
    }
  }
  return results;
}
