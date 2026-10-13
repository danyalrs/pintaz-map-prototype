import { haversineMetres } from './geo-square.js';
import { pointToSegmentMetres } from './geo-segment.js';

function poseKey(props) {
  if (props.frame_id != null && props.point_index != null) {
    return `f${props.frame_id}:p${props.point_index}`;
  }
  if (props.frame_id != null) return `f${props.frame_id}`;
  if (props.source_event_index != null) return `e${props.source_event_index}`;
  return null;
}

function signedLateralM(lon, lat, segStart, segEnd) {
  const [aLon, aLat] = segStart;
  const [bLon, bLat] = segEnd;
  const lat0 = lat;
  const latRad = (lat0 * Math.PI) / 180;
  const mPerDegLat =
    111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const ax = 0;
  const ay = 0;
  const bx = (bLon - aLon) * mPerDegLon;
  const by = (bLat - aLat) * mPerDegLat;
  const px = (lon - aLon) * mPerDegLon;
  const py = (lat - aLat) * mPerDegLat;
  const cross = bx * py - by * px;
  const { distanceM } = pointToSegmentMetres(lon, lat, aLon, aLat, bLon, bLat);
  return { signedM: cross >= 0 ? distanceM : -distanceM, distanceM };
}

export function buildPoseLookup(matchedPoses) {
  const byFrame = new Map();
  const list = [];
  for (const f of matchedPoses) {
    const p = f.properties || {};
    list.push(f);
    const fid = p.frame_id;
    if (fid != null) {
      if (!byFrame.has(fid)) byFrame.set(fid, []);
      byFrame.get(fid).push(f);
    }
  }
  return { list, byFrame };
}

export function attachObservationsToPoses(obsFeatures, poseLookup, osmSegmentByMatch) {
  const attached = [];
  const rejected = [];
  const MAX_POSE_DIST_M = 12;

  for (const obs of obsFeatures) {
    const layer = obs.properties?.layer;
    if (layer !== 'lane_point' && layer !== 'edge_point') continue;
    const [lon, lat] = obs.geometry.coordinates;
    const props = obs.properties || {};
    let pose = null;
    const fid = props.frame_id;
    if (fid != null && poseLookup.byFrame.has(fid)) {
      const candidates = poseLookup.byFrame.get(fid);
      pose = candidates.reduce((best, p) => {
        const d = haversineMetres(lon, lat, p.geometry.coordinates[0], p.geometry.coordinates[1]);
        if (!best || d < best.d) return { p, d };
        return best;
      }, null)?.p;
      if (pose) {
        const d = haversineMetres(lon, lat, pose.geometry.coordinates[0], pose.geometry.coordinates[1]);
        if (d > MAX_POSE_DIST_M) pose = null;
      }
    }
    if (!pose) {
      rejected.push({
        type: 'Feature',
        geometry: obs.geometry,
        properties: {
          layer,
          reason: 'no_vehicle_pose_for_frame',
          frame_id: fid,
        },
      });
      continue;
    }
    const matchProps = pose.properties || {};
    const seg = osmSegmentByMatch?.get(matchProps.pose_index);
    let lateral = null;
    let side = null;
    if (seg) {
      const latInfo = signedLateralM(lon, lat, seg.start, seg.end);
      lateral = latInfo.signedM;
      side = lateral >= 0 ? 'right' : 'left';
    }
    attached.push({
      type: 'Feature',
      geometry: obs.geometry,
      properties: {
        layer,
        pose_index: matchProps.pose_index,
        osm_id: matchProps.osm_id,
        frame_id: props.frame_id,
        segment_frame_index: props.segment_frame_index,
        lane_index: props.lane_index,
        edge_index: props.edge_index,
        lane_probability: props.lane_probability,
        edge_probability: props.edge_probability,
        lateral_offset_m: lateral,
        side,
        distance_to_pose_m: haversineMetres(
          lon,
          lat,
          pose.geometry.coordinates[0],
          pose.geometry.coordinates[1]
        ),
      },
    });
  }
  return { attached, rejected };
}

export { poseKey };
