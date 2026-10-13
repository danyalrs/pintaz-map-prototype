import fs from 'node:fs';
import path from 'node:path';
import { routeSortKey } from '../bukit-route-redaction.js';
import { poseCheckpointPath } from './fetch-vehicle-poses.js';
import { DATA_DIR } from './constants.js';

const POSE_RAW_DIR = path.join(DATA_DIR, 'vehicle-pose-raw');

/**
 * Canonical Phase 2 / Phase 3 route key: catalogue `route_ref` (e.g. drive-1261).
 * Pose index paths: pose-index/{route_ref}.json, vehicle-pose-raw/{route_ref}/
 * Catalogue server identity: dongle (16-hex) + route (datetime id) → routeSortKey → route_ref.
 * Local explorer labels (e.g. drive-005) are NOT catalogue refs; map via drive-ref-map only.
 */
export function catalogueRouteRefFromRecord(record, refMap) {
  return refMap.get(routeSortKey(record));
}

export function phase2PoseRawDir(routeRef) {
  return path.join(POSE_RAW_DIR, routeRef);
}

export function phase2PoseCheckpointSummary(routeRef) {
  const ck = poseCheckpointPath(routeRef);
  if (!fs.existsSync(ck)) return { route_ref: routeRef, checkpoint_exists: false, pose_count: 0 };
  const summary = JSON.parse(fs.readFileSync(ck, 'utf8'));
  const rawDir = phase2PoseRawDir(routeRef);
  const rawPages = fs.existsSync(rawDir)
    ? fs.readdirSync(rawDir).filter((n) => n.endsWith('.geojson'))
    : [];
  return {
    route_ref: routeRef,
    checkpoint_exists: true,
    pose_count: summary.pose_count ?? summary.vehicle_pose_count ?? 0,
    pose_fetch_stop_reason: summary.pose_fetch_stop_reason ?? null,
    raw_geojson_pages: rawPages.length,
    local_preview_import: summary.local_preview_import ?? null,
  };
}

export function phase2HasPoseEvidence(routeRef, { minPoses = 1 } = {}) {
  const summary = phase2PoseCheckpointSummary(routeRef);
  if (summary.pose_count >= minPoses) return true;
  const rawDir = phase2PoseRawDir(routeRef);
  if (!fs.existsSync(rawDir)) return false;
  return fs.readdirSync(rawDir).some((n) => n.endsWith('.geojson'));
}

export function describeRouteIdentity(record, refMap) {
  const routeRef = catalogueRouteRefFromRecord(record, refMap);
  return {
    canonical_pose_index_key: routeRef,
    catalogue_dongle_16: record?.dongle ?? null,
    catalogue_route_datetime_id: record?.route ?? null,
    route_sort_key: record ? routeSortKey(record) : null,
    note: 'Phase 2 pose-index and Phase 3 qualification must both use canonical_pose_index_key (route_ref).',
  };
}
