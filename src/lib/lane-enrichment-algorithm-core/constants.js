export const DECISION = {
  UNSUPPORTED_INPUT_GEOMETRY: 'unsupported_input_geometry',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  SINGLE_FRAME_REVIEW_CANDIDATE: 'single_frame_review_candidate',
  MULTI_FRAME_REVIEW_CANDIDATE: 'multi_frame_review_candidate',
};

export const HUMAN_REVIEW_REQUIRED = true;
export const NEVER_AUTO_APPLY = true;

export const LIMITS = {
  minPolylineVertices: 2,
  minLineConfidence: 0.45,
  minPoseQuality: 0.5,
  maxCentrelineTurnDeg: 12,
  clusterBinM: 0.35,
  minClusterSupportFrames: 2,
  singleFrameMinConfidence: 0.85,
  singleFrameMinPoseQuality: 0.85,
  multiFrameConsensusFraction: 0.65,
  /** Multi-frame candidates must exceed single-frame cap. */
  singleFrameReviewConfidence: 0.68,
  minStrongGroupFrames: 2,
  strongGroupMinLineProbability: 0.85,
  minRoadWidthM: 2.5,
  maxRoadWidthM: 24,
  minLaneWidthM: 2.2,
  maxLaneWidthM: 4.5,
  lateralAmbiguityToleranceM: 0.08,
};

export const FEATURE_TYPE = {
  LANE_BOUNDARY: 'lane_boundary',
  ROAD_EDGE: 'road_edge',
};
