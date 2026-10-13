import { createHash } from 'node:crypto';

/** Fields excluded from lane-baseline summary integrity (volatile at build time). */
export const LANE_BASELINE_SUMMARY_VOLATILE_FIELDS = ['generated_at'];

export function stripVolatileLaneBaselineSummaryFields(summary) {
  const out = { ...summary };
  for (const key of LANE_BASELINE_SUMMARY_VOLATILE_FIELDS) {
    delete out[key];
  }
  return out;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function laneBaselineSummarySemanticDigest(summary) {
  const stable = stripVolatileLaneBaselineSummaryFields(summary);
  return createHash('sha256').update(stableStringify(stable), 'utf8').digest('hex');
}

export function laneBaselineSummarySemanticDigestFromJsonText(jsonText) {
  const summary = JSON.parse(jsonText);
  return laneBaselineSummarySemanticDigest(summary);
}
