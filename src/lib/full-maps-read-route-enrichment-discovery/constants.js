import path from 'node:path';
import { ROOT_DIR } from '../../config.js';

export const DISCOVERY_VERSION = 'full-maps-read-route-enrichment-discovery-v1';

export const DATA_DIR = path.join(ROOT_DIR, 'data', 'maps-read', 'full-route-enrichment-discovery-v1');

export const REPORT_DIR_NAME = 'full_maps_read_route_enrichment_discovery_v1';

export const CHECKPOINT_DIR = path.join(
  ROOT_DIR,
  '.checkpoint_test_backup',
  'pre_full_maps_read_route_enrichment_discovery_v1'
);

export const TARGET_WAYS = {
  JALAN_KAMUNING: '39914067',
  LORONG_KUDA: '706737045',
};

export const WAY_COVERAGE_CLASS = {
  NONE: 'no_server_route_coverage',
  LOW: 'server_route_coverage_low_quality',
  CANDIDATE: 'server_route_coverage_candidate',
  RANKED: 'server_route_coverage_ranked',
};

export const POSE_FETCH = {
  minDelayMs: 200,
  maxPagesPerRoute: 80,
  layers: 'vehicle_pose',
  maxFeatures: '80000',
  searchRadiusM: 15,
};

export const QUALIFICATION = {
  maxRoutesToQualify: 12,
  minPosesOnWay: 3,
  minMedianDistanceM: 12,
  maxMedianHeadingDiffDeg: 35,
};
