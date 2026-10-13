import { SUPPORT_PARAMS } from './config.js';
import { median } from '../geo-segment.js';

export const SPAN_CLASSES = [
  'insufficient_independent_evidence',
  'disjoint_same_way_coverage',
  'directionally_incompatible',
  'ambiguous_projection',
  'dominant_single_drive',
  'conflicting_drive_evidence',
  'consistent_across_drives',
  'possible_centreline_offset_multi_drive',
  'possible_lane_count_mismatch_multi_drive',
  'possible_road_edge_mismatch_multi_drive',
];

export function classifyAccumulatedSpan(span, { neighbourhoodStable = true } = {}) {
  if (span.dongle_groups.length < 2) {
    return { classification: 'insufficient_independent_evidence', reasons: ['one_dongle'] };
  }
  if (!span.records.every((r) => r.projection?.ok)) {
    return { classification: 'ambiguous_projection', reasons: ['projection_reject'] };
  }
  const signs = new Set(span.records.map((r) => r.direction_sign).filter((s) => s !== 0));
  if (signs.size > 1) {
    return { classification: 'directionally_incompatible', reasons: ['opposite_travel'] };
  }
  if (span.overlap_length_m < SUPPORT_PARAMS.minSectionLengthM) {
    return { classification: 'disjoint_same_way_coverage', reasons: ['low_overlap'] };
  }
  if (span.dominant_drive_failure) {
    return { classification: 'dominant_single_drive', reasons: ['dominant_fraction'] };
  }
  if (!span.passes_support_gates) {
    return { classification: 'insufficient_independent_evidence', reasons: ['support_gates'] };
  }

  const shifts = Object.values(span.lateral_by_dongle || {}).filter((v) => v != null);
  const shiftSpread = shifts.length >= 2 ? Math.max(...shifts) - Math.min(...shifts) : 0;
  const conflict =
    shifts.length >= 2 &&
    Math.sign(shifts[0]) !== 0 &&
    shifts.some((s) => Math.sign(s) !== Math.sign(shifts[0]) && Math.abs(s) >= SUPPORT_PARAMS.minCenterlineShiftM);

  if (conflict) {
    return { classification: 'conflicting_drive_evidence', reasons: ['residual_sign_conflict'] };
  }

  if (shiftSpread >= SUPPORT_PARAMS.minCenterlineShiftM && neighbourhoodStable) {
    const sameSign = shifts.every((s) => Math.sign(s) === Math.sign(shifts[0]));
    if (sameSign) {
      return { classification: 'possible_centreline_offset_multi_drive', reasons: ['aligned_shift'] };
    }
  }

  const laneTotal = span.records.reduce((s, r) => s + r.lane_obs, 0);
  const edgeTotal = span.records.reduce((s, r) => s + r.edge_obs, 0);
  if (laneTotal >= 6 && edgeTotal >= 4 && neighbourhoodStable) {
    return { classification: 'possible_lane_count_mismatch_multi_drive', reasons: ['lane_edge_present'] };
  }
  if (edgeTotal >= 6 && neighbourhoodStable) {
    return { classification: 'possible_road_edge_mismatch_multi_drive', reasons: ['edge_obs'] };
  }

  return { classification: 'consistent_across_drives', reasons: ['residuals_compatible'] };
}

export function classifyAllSpans(spans, sweepNeighbourhood) {
  const out = [];
  for (const span of spans) {
    const stable = isNeighbourhoodStable(span, sweepNeighbourhood);
    const verdict = classifyAccumulatedSpan(span, { neighbourhoodStable: stable });
    out.push({
      osm_id: span.osm_id,
      min_s: span.min_s,
      max_s: span.max_s,
      dongle_groups: span.dongle_groups,
      combined_frames: span.combined_frames,
      overlap_length_m: span.overlap_length_m,
      supported_length_m: span.supported_length_m,
      dominant_fraction: span.dominant_fraction,
      classification: verdict.classification,
      reasons: verdict.reasons,
      parameter_neighbourhood_stable: stable,
    });
  }
  return out;
}

function isNeighbourhoodStable(span, sweepResults) {
  const hits = sweepResults.filter(
    (r) =>
      r.qualifying_span_count > 0 &&
      r.binSizeM <= 10 &&
      r.minDongles <= 2 &&
      r.minOverlapM <= 25
  );
  if (!hits.length) return false;
  const supportCounts = hits.map((h) => h.support_eligible_centreline_spans);
  const min = Math.min(...supportCounts);
  const max = Math.max(...supportCounts);
  return max - min <= 2;
}
