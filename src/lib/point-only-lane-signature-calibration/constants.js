/** Fixed V1 thresholds — not tuned on drive-005. */
export const CALIBRATION_VERSION = 'point-only-lane-signature-calibration-v1';

export const EXCLUDED_TRAINING_ROUTE_KEYS = new Set(['drive-005']);

export const LIMITS = {
  minFramesPerWay: 3,
  minLaneCount: 1,
  maxLaneCount: 6,
  maxLaneSlots: 4,
  maxEdgeSlots: 2,
  qualityMaxDistanceM: 8,
  qualityMaxHeadingDeg: 28,
  minLaneProbability: 0.35,
  minEdgeProbability: 0.5,
  multiFrameMinFrames: 2,
  multiFrameAgreementFraction: 0.6,
  /** Normalized L2 space — abstain when best-vs-second margin below this. */
  abstainMargin: 0.1,
  abstainMaxBestDistance: 1.75,
  outOfDomainMinDistance: 2.1,
  signatureSentinel: -999,
};

export const CANDIDATE_TYPE = {
  SINGLE_POINT: 'single-point',
  MULTI_FRAME: 'multi-frame',
  INSUFFICIENT: 'insufficient',
};

export const DRIVE005_OUTCOME = {
  REVIEW_CANDIDATE: 'review_candidate',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  OUT_OF_CALIBRATION_DOMAIN: 'out_of_calibration_domain',
};

export const CLASSIFICATION = {
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  ABSTAINED: 'abstained',
};
