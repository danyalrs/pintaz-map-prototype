import { GLOBAL_SUPPORT, SELECTED_SWEEP_DEFAULT } from './config.js';
import { dominanceFlags } from './bin-evidence.js';

export function perDonglePassesGates(span, gates) {
  const ok = [];
  for (const [routeKey, contrib] of Object.entries(span.per_route || {})) {
    if (
      contrib.frames >= gates.minFramesPerDongle &&
      contrib.covered_length_m >= gates.minLengthPerDongleM
    ) {
      ok.push(routeKey);
    }
  }
  return ok;
}

export function combinedSupport(span, params = GLOBAL_SUPPORT) {
  let frames = 0;
  let length = 0;
  for (const contrib of Object.values(span.per_route || {})) {
    frames += contrib.frames || 0;
    length = Math.max(length, span.shared_length_m || 0);
  }
  const headingVals = [];
  for (const contrib of Object.values(span.per_route || {})) {
    if (contrib.median_heading_diff_deg != null) headingVals.push(contrib.median_heading_diff_deg);
  }
  const medHeading = headingVals.length
    ? headingVals.reduce((a, b) => a + b, 0) / headingVals.length
    : 999;
  const fails = [];
  if (frames < params.minFrames) fails.push('min_frames');
  if (length < params.minSectionLengthM) fails.push('min_section_length');
  if (medHeading > params.maxHeadingDiffDeg) fails.push('heading_disagreement');
  return { combined_frames: frames, support_length_m: length, median_heading_diff_deg: medHeading, gate_failures: fails };
}

export function classifySpan(span, evidence, osmBaseline, gates = SELECTED_SWEEP_DEFAULT, sweepStable = true) {
  if (span.disjoint_coverage || span.classification_hint === 'disjoint_coverage') {
    return 'disjoint_coverage';
  }
  const contributors = perDonglePassesGates(span, gates);
  const indep = span.independent_dongle_count ?? contributors.length;
  if (indep < gates.minIndependentDongles) return 'insufficient_independent_support';
  if (contributors.length < gates.minIndependentDongles) return 'insufficient_independent_support';
  const support = combinedSupport(span);
  if (support.gate_failures.length) return 'insufficient_independent_support';
  const dom = dominanceFlags(evidence);
  if (dom.single_drive_dominates || dom.one_drive_touches_one_bin) return 'drive_evidence_conflict';
  if (!osmBaseline.osm_confirmed?.centreline_geometry) return 'osm_geometry_unsupported';

  const laterals = [];
  for (const contrib of Object.values(span.per_route || {})) {
    if (contrib.median_centreline_residual_m != null) laterals.push(contrib.median_centreline_residual_m);
  }
  const spread =
    laterals.length >= 2 ? Math.max(...laterals) - Math.min(...laterals) : 0;
  const allWithinTol = laterals.every((v) => v <= GLOBAL_SUPPORT.residualToleranceM);
  if (allWithinTol && spread < GLOBAL_SUPPORT.minCenterlineShiftM) {
    return sweepStable ? 'consistent_with_osm_centreline' : 'insufficient_independent_support';
  }
  if (spread >= GLOBAL_SUPPORT.minCenterlineShiftM && contributors.length >= 2 && sweepStable) {
    return 'possible_centreline_offset_multi_drive';
  }
  if (!sweepStable) return 'insufficient_independent_support';
  return 'consistent_with_osm_lanes';
}

export function stabilityAcrossSweep(classifications) {
  const uniq = [...new Set(classifications)];
  return uniq.length === 1 ? { stable: true, label: uniq[0] } : { stable: false, labels: uniq };
}
