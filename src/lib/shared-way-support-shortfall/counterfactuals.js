import { reconstructPairSpans } from '../bukit-overlap-multi-drive-analysis/shared-spans.js';
import { TARGET_OSM_WAY_ID, PRODUCTION_SUPPORT } from './config.js';

const BIN_GRID = [2, 5, 10];
const GAP_GRID = [5, 10, 15];
const CONTRIBUTION_GRID = [
  { minFramesPerDongle: 4, minLengthPerDongleM: 10, label: 'selected_4_10' },
  { minFramesPerDongle: 2, minLengthPerDongleM: 5, label: 'diagnostic_2_5' },
  { minFramesPerDongle: 8, minLengthPerDongleM: 15, label: 'stricter_8_15' },
];

function evaluateSpan(span, contrib) {
  const active = span.per_route?.active;
  const d005 = span.per_route?.['drive-005'];
  const okActive = active && active.frames >= contrib.minFramesPerDongle && active.covered_length_m >= contrib.minLengthPerDongleM;
  const okD005 = d005 && d005.frames >= contrib.minFramesPerDongle && d005.covered_length_m >= contrib.minLengthPerDongleM;
  const combinedFrames = (active?.frames || 0) + (d005?.frames || 0);
  const lengthM = span.continuous_length_m || span.shared_length_m || 0;
  const support =
    okActive &&
    okD005 &&
    !span.disjoint_coverage &&
    combinedFrames >= PRODUCTION_SUPPORT.minFrames &&
    lengthM >= PRODUCTION_SUPPORT.minContinuousLengthM;
  return {
    continuous_length_m: lengthM,
    active_frames: active?.frames || 0,
    drive_005_frames: d005?.frames || 0,
    per_dongle_gates: okActive && okD005,
    production_support: support,
    safety_flags: {
      bridges_real_data_gap: span.disjoint_coverage || !okActive || !okD005,
    },
    recommendation: false,
  };
}

export function runCounterfactuals(active, d005, metaA, metaB) {
  const results = [];
  for (const binSize of BIN_GRID) {
    for (const maxGap of GAP_GRID) {
      for (const contrib of CONTRIBUTION_GRID) {
        const spans = reconstructPairSpans(active, d005, metaA, metaB, { maxBinGapM: maxGap }).filter(
          (s) => String(s.osm_id) === TARGET_OSM_WAY_ID && !s.classification_hint
        );
        const enriched = spans.map((s) => ({
          ...s,
          continuous_length_m: s.shared_length_m,
        }));
        const longest = enriched.length ? Math.max(...enriched.map((s) => s.shared_length_m || 0)) : 0;
        const evals = enriched.map((s) => evaluateSpan({ ...s, continuous_length_m: s.shared_length_m }, contrib));
        const anySupport = evals.some((e) => e.production_support);
        results.push({
          bin_size_m: binSize,
          max_bin_gap_m: maxGap,
          contribution: contrib.label,
          span_count: spans.length,
          longest_continuous_m: longest,
          production_support_any_span: anySupport,
          spans: evals,
          counterfactual_is_recommendation: false,
          note: anySupport ? 'would_bridge_data_gap_if_disjoint' : 'no_safe_support',
        });
      }
    }
  }
  const selectedDefault = results.find(
    (r) => r.bin_size_m === 5 && r.max_bin_gap_m === 10 && r.contribution === 'selected_4_10'
  );
  const safeLengths = results
    .filter(
      (r) =>
        r.max_bin_gap_m <= 10 &&
        r.production_support_any_span &&
        !r.spans.some((s) => s.safety_flags.bridges_real_data_gap)
    )
    .map((r) => r.longest_continuous_m);
  const safeMax = safeLengths.length ? Math.max(...safeLengths) : selectedDefault?.longest_continuous_m ?? 0;
  return {
    grid: results,
    counterfactual_max_safe_continuous_overlap_m: safeMax,
    selected_default_longest_continuous_m: selectedDefault?.longest_continuous_m ?? 0,
    note:
      'Larger max_bin_gap can merge disjoint spans; values above selected-default length are not safe recommendations.',
  };
}
