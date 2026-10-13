export const OUTCOME = {
  GEOMETRY_CANDIDATE_MISSING_OSM_LANES: 'geometry_candidate_missing_osm_lanes',
  GEOMETRY_AGREES_WITH_OSM_BASELINE: 'geometry_agrees_with_osm_baseline',
  GEOMETRY_DISAGREES_WITH_OSM_REVIEW: 'geometry_disagrees_with_osm_review',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  NOT_ELIGIBLE_TWO_WAY: 'not_eligible_two_way',
  NOT_ELIGIBLE_GEOMETRY: 'not_eligible_geometry',
};

export const LIMITS = {
  maxPoseDistanceM: 8,
  maxHeadingDiffDeg: 25,
  maxSharpestTurnDeg: 15,
  minStraightSegmentM: 12,
  crossSectionAlongToleranceM: 18,
  clusterBinM: 0.45,
  minClusterSupportFrames: 3,
  minLaneWidthM: 2.2,
  maxLaneWidthM: 4.5,
  minRoadWidthM: 3,
  maxRoadWidthM: 22,
  consensusFrameFraction: 0.6,
};

export const HUMAN_REVIEW_REQUIRED = true;
export const NEVER_AUTO_APPLY = true;
