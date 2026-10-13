import { DECISION, HUMAN_REVIEW_REQUIRED, NEVER_AUTO_APPLY } from './constants.js';

export const CONFIDENCE_BAND = {
  PROVISIONAL_SINGLE_FRAME: 'provisional_single_frame',
  SUPPORTED_MULTI_FRAME: 'supported_multi_frame',
  INSUFFICIENT_OR_CONFLICTING: 'insufficient_or_conflicting',
  UNSUPPORTED_INPUT_GEOMETRY: 'unsupported_input_geometry',
};

export const SUPPORT_TYPE = {
  SINGLE_FRAME: 'single_frame',
  MULTI_FRAME: 'multi_frame',
  NONE: 'none',
};

export const DECISION_SCORE_DISCLAIMER =
  '`decision_score` is an uncalibrated internal ranking signal from synthetic geometry tests. It is not an estimated probability that the lane count is correct. Real confidence calibration requires future Maps Read polyline data and labelled evaluation.';

export function insufficientSemantics(extra = {}) {
  return {
    selected_lane_count: null,
    decision_score: extra.decision_score ?? 0,
    confidence_band: CONFIDENCE_BAND.INSUFFICIENT_OR_CONFLICTING,
    support_type: SUPPORT_TYPE.NONE,
    decision: DECISION.INSUFFICIENT_EVIDENCE,
    human_review_required: HUMAN_REVIEW_REQUIRED,
    never_auto_apply: NEVER_AUTO_APPLY,
    temporal_stability: false,
    ...extra,
  };
}

export function unsupportedSemantics(extra = {}) {
  return {
    selected_lane_count: null,
    decision_score: extra.decision_score ?? 0,
    confidence_band: CONFIDENCE_BAND.UNSUPPORTED_INPUT_GEOMETRY,
    support_type: SUPPORT_TYPE.NONE,
    decision: DECISION.UNSUPPORTED_INPUT_GEOMETRY,
    human_review_required: HUMAN_REVIEW_REQUIRED,
    never_auto_apply: NEVER_AUTO_APPLY,
    temporal_stability: false,
    ...extra,
  };
}
