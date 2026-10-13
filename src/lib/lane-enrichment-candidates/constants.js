/** Output decision states for lane enrichment candidate builder V1. */
export const DECISION = {
  OSM_BASELINE_PRESENT: 'osm_baseline_present',
  REVIEW_CANDIDATE_MISSING_OSM_LANES: 'review_candidate_missing_osm_lanes',
  OSM_SERVER_DISAGREEMENT_REVIEW: 'osm_server_disagreement_review',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  UNSUPPORTED_SOURCE_SEMANTICS: 'unsupported_source_semantics',
};

export const SOURCE_SEMANTICS_STATUS = {
  DOCUMENTED: 'documented_preview_layers',
  INSUFFICIENT_FOR_PHYSICAL_LANE_COUNT: 'insufficient_for_physical_lane_count',
};

/** Conservative frame gates (aligned with comparison matcher, not production proposal gates). */
export const FRAME_LIMITS = {
  maxPoseToOsmDistanceM: 8,
  maxHeadingDiffDeg: 25,
  minLaneProbabilityForModelLine: 0.35,
  minFramesForConsensus: 3,
  maxAlongGapM: 35,
};

export const HUMAN_REVIEW_REQUIRED = true;
export const NEVER_AUTO_APPLY = true;
