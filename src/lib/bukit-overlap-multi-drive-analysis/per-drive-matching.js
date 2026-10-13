import fs from 'node:fs';
import path from 'node:path';
import { runMatcherForRoute } from '../bukit-overlap-route-selection/matching-audit.js';
import { ensureDerivedTransportPreview } from './derive-transport.js';
import { matchedPosesPath } from '../comparison-paths.js';
import { projectAlongCentreline } from '../mismatch-projection.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';

function travelSign(headingDiff) {
  const h = Number(headingDiff);
  if (!Number.isFinite(h)) return 0;
  return h <= 90 ? 1 : -1;
}

export function runPerDriveMatching(routeKey, probeRef, dataDir) {
  ensureDerivedTransportPreview(routeKey, probeRef, dataDir);
  const audit = runMatcherForRoute(routeKey, probeRef, dataDir);
  const compDir = path.join(dataDir, 'matching', routeKey, 'comparison-v1');
  const matches = JSON.parse(fs.readFileSync(matchedPosesPath(compDir), 'utf8')).features || [];
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const roadById = new Map(roads.features.map((f) => [String(f.properties?.osm_id), f]));
  const osm_records = { ...(audit.osm_records || {}) };
  for (const [osmId, recs] of Object.entries(osm_records)) {
    const road = roadById.get(osmId);
    const coords = road?.geometry?.coordinates || [];
    for (let i = 0; i < recs.length; i += 1) {
      const m = matches.find((x) => x.properties?.frame_id === recs[i].frame_id);
      if (m) {
        recs[i].heading_diff_deg = m.properties.heading_diff_deg;
        recs[i].centreline_residual_m = m.properties.distance_m;
        recs[i].ambiguous_parallel = false;
      }
    }
  }
  return {
    ...audit,
    osm_records,
    matcher_input_pose_count: audit.summary?.matcher_input_pose_count,
    total_vehicle_poses: audit.summary?.total_route_vehicle_pose_count,
    inside_pilot_poses: audit.summary?.matcher_input_pose_count,
    outside_pilot_poses: audit.summary?.excluded_outside_pilot_pose_count,
    matched_poses: audit.summary?.matched_pose_count,
    rejected_poses: audit.summary?.rejected_pose_count,
    ambiguity_rejections: audit.summary?.ambiguity_rejections,
  };
}
