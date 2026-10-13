import fs from 'node:fs';
import { ensureDerivedTransportPreview } from '../bukit-overlap-multi-drive-analysis/derive-transport.js';
import { loadBukitPilotBbox, pointInsideBukitPilot } from '../bukit-pilot-bounds.js';
import { buildOsmSegmentIndex, querySegmentsNear } from '../osm-segment-index.js';
import { matchVehiclePoses, sortPoses } from '../vehicle-osm-matcher.js';
import { projectAlongCentreline } from '../mismatch-projection.js';
import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { haversineMetres } from '../geo-square.js';
import { TARGET_OSM_WAY_ID, NEAR_WAY_BUFFER_M } from './config.js';

function minDistToWayM(lon, lat, coords) {
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const d = haversineMetres(lon, lat, coords[i][0], coords[i][1]);
    best = Math.min(best, d);
    const d2 = haversineMetres(lon, lat, coords[i + 1][0], coords[i + 1][1]);
    best = Math.min(best, d2);
  }
  return best;
}

function travelSign(headingDiff) {
  const h = Number(headingDiff);
  if (!Number.isFinite(h)) return 0;
  return h <= 90 ? 1 : -1;
}

export function auditRawAvailability(routeKey, probeRef, dataDir, wayCoords) {
  const { previewPath } = ensureDerivedTransportPreview(routeKey, probeRef, dataDir);
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
  const pilotBbox = loadBukitPilotBbox();
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const index = buildOsmSegmentIndex(roads);
  const allPoses = sortPoses(preview.features.filter((f) => f.properties?.layer === 'vehicle_pose'));
  const laneEdge = preview.features.filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const insidePoses = [];
  const outsidePoses = [];
  for (const p of allPoses) {
    const [lon, lat] = p.geometry.coordinates;
    if (pointInsideBukitPilot(lon, lat, pilotBbox)) insidePoses.push(p);
    else outsidePoses.push(p);
  }
  const { matches, rejected } = matchVehiclePoses(insidePoses, index, { searchRadiusM: 15 });
  const poseLookup = buildPoseLookup(matches);
  const { attached } = attachObservationsToPoses(laneEdge, poseLookup, null);

  const nearPoses = [];
  for (let i = 0; i < allPoses.length; i += 1) {
    const pose = allPoses[i];
    const [lon, lat] = pose.geometry.coordinates;
    const distWay = minDistToWayM(lon, lat, wayCoords);
    if (distWay > NEAR_WAY_BUFFER_M) continue;
    const inside = pointInsideBukitPilot(lon, lat, pilotBbox);
    const nearby = querySegmentsNear(index, lon, lat, 15);
    const targetSeg = nearby.find((s) => String(s.osm_id) === TARGET_OSM_WAY_ID);
    const matchFeat = matches.find((m) => m.properties?.frame_id === pose.properties?.frame_id);
    const rejectFeat = rejected.find((r) => r.properties?.frame_id === pose.properties?.frame_id);
    let matcherDecision = 'not_in_pilot_matcher_input';
    let rejectionReason = null;
    let matchedOsm = null;
    if (!inside) {
      matcherDecision = 'excluded_outside_pilot';
    } else if (matchFeat) {
      matcherDecision = 'matched';
      matchedOsm = String(matchFeat.properties.osm_id);
    } else if (rejectFeat) {
      matcherDecision = 'rejected';
      rejectionReason = rejectFeat.properties?.reason || 'unknown';
      matchedOsm = rejectFeat.properties?.best_osm_id ? String(rejectFeat.properties.best_osm_id) : null;
    }
    const proj =
      targetSeg || matchedOsm === TARGET_OSM_WAY_ID
        ? projectAlongCentreline(lon, lat, wayCoords)
        : null;
    const lane = attached.filter(
      (a) => a.properties.frame_id === pose.properties?.frame_id && a.properties.layer === 'lane_point'
    ).length;
    const edge = attached.filter(
      (a) => a.properties.frame_id === pose.properties?.frame_id && a.properties.layer === 'edge_point'
    ).length;
    nearPoses.push({
      redacted_route_ref: routeKey === 'active' ? 'active' : 'probe-005',
      frame_id: pose.properties?.frame_id,
      log_mono_time: pose.properties?.log_mono_time,
      coordinate: pose.geometry.coordinates,
      heading_deg: pose.properties?.heading_deg,
      inside_pilot: inside,
      distance_to_target_way_m: distWay,
      nearest_target_way_segment: targetSeg ? true : false,
      matcher_decision: matcherDecision,
      matcher_rejection_reason: rejectionReason,
      matched_osm_id: matchedOsm,
      projected_chain_s: proj?.chainS ?? null,
      centreline_residual_m: matchFeat?.properties?.distance_m ?? proj?.distanceM ?? null,
      heading_diff_deg: matchFeat?.properties?.heading_diff_deg ?? null,
      travel_direction_sign: travelSign(matchFeat?.properties?.heading_diff_deg),
      lane_observations: lane,
      edge_observations: edge,
    });
  }

  const buckets = {
    matched_target: nearPoses.filter((p) => p.matched_osm_id === TARGET_OSM_WAY_ID),
    matched_other: nearPoses.filter((p) => p.matched_osm_id && p.matched_osm_id !== TARGET_OSM_WAY_ID),
    rejected: nearPoses.filter((p) => p.matcher_decision === 'rejected'),
    outside_pilot: nearPoses.filter((p) => !p.inside_pilot),
    missing_lane_edge: nearPoses.filter((p) => p.lane_observations === 0 && p.edge_observations === 0),
  };

  return {
    route_key: routeKey,
    redacted_route_ref: routeKey === 'active' ? 'active' : 'probe-005',
    near_way_pose_count: nearPoses.length,
    inside_pilot_near_way: nearPoses.filter((p) => p.inside_pilot).length,
    buckets_summary: {
      matched_target: buckets.matched_target.length,
      matched_other: buckets.matched_other.length,
      rejected: buckets.rejected.length,
      outside_pilot: buckets.outside_pilot.length,
      missing_lane_edge: buckets.missing_lane_edge.length,
    },
    poses: nearPoses,
  };
}
