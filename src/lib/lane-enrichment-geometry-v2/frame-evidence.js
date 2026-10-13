import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import { signedLateralM } from './local-project.js';
import { LIMITS } from './constants.js';

export function collectFrameEvidence({
  routeKey,
  osmWayId,
  crossSection,
  posesOnWay,
  previewFeatures,
}) {
  const seg = crossSection.segment_endpoints;
  const laneEdge = (previewFeatures || []).filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const sectionPoses = crossSection.pose_samples.map((s) => s.pose);
  const poseLookup = buildPoseLookup(sectionPoses);
  const { attached } = attachObservationsToPoses(laneEdge, poseLookup, new Map());

  const frameIds = [...new Set(sectionPoses.map((p) => p.properties.frame_id))];
  const records = [];

  for (const frameId of frameIds) {
    const pose = sectionPoses.find((p) => p.properties.frame_id === frameId);
    const rejection = [];
    if (!pose) {
      rejection.push('missing_vehicle_pose');
    } else {
      const hd = pose.properties.heading_diff_deg;
      if (hd != null && hd > LIMITS.maxHeadingDiffDeg) rejection.push('wrong_travel_direction');
      const dm = pose.properties.distance_m;
      if (dm != null && dm > LIMITS.maxPoseDistanceM) rejection.push('poor_pose_alignment');
    }

    const frameLane = attached.filter(
      (a) => a.properties.frame_id === frameId && a.properties.layer === 'lane_point'
    );
    const frameEdge = attached.filter(
      (a) => a.properties.frame_id === frameId && a.properties.layer === 'edge_point'
    );

    const laneLaterals = [];
    for (const o of frameLane) {
      const [lon, lat] = o.geometry.coordinates;
      laneLaterals.push({
        lateral_m: signedLateralM(lon, lat, seg.a[0], seg.a[1], seg.b[0], seg.b[1]),
        trace_lane_index: o.properties.lane_index,
        lane_probability: o.properties.lane_probability,
      });
    }
    const edgeLaterals = [];
    for (const o of frameEdge) {
      const [lon, lat] = o.geometry.coordinates;
      edgeLaterals.push({
        lateral_m: signedLateralM(lon, lat, seg.a[0], seg.a[1], seg.b[0], seg.b[1]),
        trace_edge_index: o.properties.edge_index,
        edge_probability: o.properties.edge_probability,
      });
    }

    if (!laneLaterals.length && !edgeLaterals.length) {
      rejection.push('missing_lane_and_edge_geometry');
    }
    if (laneLaterals.length && laneLaterals.length < 2 && !edgeLaterals.length) {
      rejection.push('partial_unstable_lane_geometry');
    }

    const accepted = rejection.length === 0;
    records.push({
      osm_way_id: osmWayId,
      route_key: routeKey,
      frame_id: frameId,
      cross_section_id: crossSection.cross_section_id,
      lane_point_lateral_m: laneLaterals,
      edge_point_lateral_m: edgeLaterals,
      accepted,
      rejection_reasons: rejection,
    });
  }
  return records;
}
