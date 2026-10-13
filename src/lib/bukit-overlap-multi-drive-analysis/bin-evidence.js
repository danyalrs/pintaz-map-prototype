import { median, percentile } from '../geo-segment.js';

export function binIndex(s, binSizeM) {
  return Math.floor(s / binSizeM);
}

export function perDriveBinSummaries(span, binSizeM) {
  const summaries = {};
  const rawCounts = {};
  let totalRaw = 0;
  for (const [routeKey, contrib] of Object.entries(span.per_route || {})) {
    const recs = contrib.records || [];
    totalRaw += recs.length;
    rawCounts[routeKey] = recs.length;
    const byBin = new Map();
    for (const r of recs) {
      const b = binIndex(r.chain_s, binSizeM);
      if (!byBin.has(b)) byBin.set(b, []);
      byBin.get(b).push(r);
    }
    const bins = [];
    for (const [b, rows] of byBin) {
      bins.push({
        bin: b,
        s_lo: b * binSizeM,
        s_hi: (b + 1) * binSizeM,
        matched_frames: new Set(rows.map((x) => x.frame_id)).size,
        median_centreline_residual_m: median(rows.map((x) => x.centreline_residual_m).filter((v) => v != null)),
        median_heading_diff_deg: median(rows.map((x) => x.heading_diff_deg).filter((v) => v != null)),
        lane_obs: rows.reduce((a, x) => a + (x.lane_obs || 0), 0),
        edge_obs: rows.reduce((a, x) => a + (x.edge_obs || 0), 0),
      });
    }
    summaries[routeKey] = bins;
  }
  const allBins = new Set();
  for (const bins of Object.values(summaries)) bins.forEach((b) => allBins.add(b.bin));
  const equalWeight = [];
  for (const b of allBins) {
    const driveRows = [];
    for (const [routeKey, bins] of Object.entries(summaries)) {
      const row = bins.find((x) => x.bin === b);
      if (row) driveRows.push({ route_key: routeKey, ...row });
    }
    if (!driveRows.length) continue;
    const n = driveRows.length;
    equalWeight.push({
      bin: b,
      contributing_drives: driveRows.map((d) => d.route_key),
      equal_weight_frame_count: driveRows.reduce((s, d) => s + d.matched_frames, 0) / n,
      equal_weight_median_centreline_residual_m:
        driveRows.reduce((s, d) => s + (d.median_centreline_residual_m ?? 0), 0) / n,
      equal_weight_median_heading_diff_deg:
        driveRows.reduce((s, d) => s + (d.median_heading_diff_deg ?? 0), 0) / n,
    });
  }
  const occupiedShare = {};
  const routeKeys = Object.keys(summaries);
  for (const rk of routeKeys) {
    occupiedShare[rk] = allBins.size ? summaries[rk].length / allBins.size : 0;
  }
  const rawShare = {};
  for (const rk of routeKeys) rawShare[rk] = totalRaw ? (rawCounts[rk] || 0) / totalRaw : 0;
  return {
    bin_size_m: binSizeM,
    raw_observation_share: rawShare,
    occupied_bin_share: occupiedShare,
    equal_weight_bins: equalWeight,
    per_drive_bins: summaries,
    bins_supported_by_each_drive: Object.fromEntries(
      routeKeys.map((rk) => [rk, summaries[rk].map((b) => b.bin)])
    ),
  };
}

export function dominanceFlags(evidence) {
  const shares = Object.values(evidence.raw_observation_share || {});
  const max = shares.length ? Math.max(...shares) : 0;
  const singleDriveDominates = max > 0.7;
  const oneBinOnly = Object.values(evidence.occupied_bin_share || {}).some((s) => s > 0 && s < 0.15);
  return { single_drive_dominates: singleDriveDominates, one_drive_touches_one_bin: oneBinOnly };
}
