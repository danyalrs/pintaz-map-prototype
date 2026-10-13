import path from 'node:path';
import { DATA_DIR } from './constants.js';

export const PHASE3_VERSION = 'full-maps-read-phase3-unknown-lane-shortlist-v1';

export const PHASE3_CHECKPOINT_PATH = path.join(DATA_DIR, 'phase3-route-qualification.json');

export function resolvePhase3CheckpointPath() {
  const override = process.env.PHASE3_CHECKPOINT_PATH;
  if (override) return path.resolve(override);
  return PHASE3_CHECKPOINT_PATH;
}

export const PAIR_SHORTLIST_STATUS = {
  FUTURE_GEOMETRY: 'future_geometry_candidate',
  NOT_QUALIFIED: 'route_not_qualified',
  NOT_EVALUABLE: 'route_not_evaluable',
  INSUFFICIENT_COVERAGE: 'insufficient_route_coverage',
  NOT_GEOMETRY_ELIGIBLE: 'not_geometry_eligible',
  QUALIFICATION_PENDING: 'qualification_pending',
};

export const PHASE3_GEOMETRY_GATES = {
  minPosesOnUnknownWay: 3,
  minContinuousCoveredLengthM: 20,
  minDirectionCompatibleFraction: 0.55,
  maxMedianDistanceM: 12,
  maxMedianHeadingDiffDeg: 35,
};

export const PHASE3_BATCH = {
  routesPerRun: Number(process.env.PHASE3_ROUTES_PER_RUN || '0') || null,
  defaultRoutesPerRun: 120,
  interRouteDelayMs: 120,
};

export const SHORTLIST_NOT_OSM_ENRICHMENT =
  'This shortlist identifies unknown-lane OSM ways × Maps Read routes that may warrant future geometry-based enrichment only. It is not an OSM lane-count enrichment result and does not assign selected_lane_count to any unknown way.';
