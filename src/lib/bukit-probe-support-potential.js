import { pointInsideBukitPilot } from './bukit-pilot-bounds.js';
import { haversineMeters } from './bukit-page1-coverage.js';
import { coordinateBounds } from './selected-route-page-validate.js';

const MIN_FRAMES = 8;
const MIN_LENGTH_M = 25;

function insideVehiclePoseSequence(features) {
  const seq = [];
  for (const f of features) {
    if (f?.properties?.layer !== 'vehicle_pose') continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const inside = pointInsideBukitPilot(lon, lat);
    const frameId = f.properties?.frame_id ?? f.properties?.frame_index;
    seq.push({ lon, lat, inside, frameId });
  }
  return seq;
}

function analyzeInsideRuns(seq) {
  const runs = [];
  let cur = [];
  for (const p of seq) {
    if (p.inside) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function runLengthM(run) {
  let m = 0;
  for (let i = 1; i < run.length; i += 1) {
    m += haversineMeters(run[i - 1].lon, run[i - 1].lat, run[i].lon, run[i].lat);
  }
  return m;
}

function uniqueFramesInRun(run) {
  const s = new Set();
  for (const p of run) {
    if (p.frameId != null) s.add(String(p.frameId));
  }
  return s.size || run.length;
}

export function supportPotentialFromFeatures(features) {
  const layers = { vehicle_pose: 0, lane_point: 0, edge_point: 0, gps_point: 0 };
  const insideFrames = new Set();
  for (const f of features) {
    const layer = f?.properties?.layer;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !pointInsideBukitPilot(lon, lat)) continue;
    if (layers[layer] !== undefined) layers[layer] += 1;
    const fid = f.properties?.frame_id ?? f.properties?.frame_index;
    if (fid != null) insideFrames.add(String(fid));
  }

  const seq = insideVehiclePoseSequence(features);
  const runs = analyzeInsideRuns(seq);
  let spansMinFrames = 0;
  let spansMinLength = 0;
  let spansBothGates = 0;
  let maxContinuousInsidePoses = 0;
  for (const run of runs) {
    const frames = uniqueFramesInRun(run);
    const len = runLengthM(run);
    maxContinuousInsidePoses = Math.max(maxContinuousInsidePoses, run.length);
    if (frames >= MIN_FRAMES) spansMinFrames += 1;
    if (len >= MIN_LENGTH_M) spansMinLength += 1;
    if (frames >= MIN_FRAMES && len >= MIN_LENGTH_M) spansBothGates += 1;
  }

  const insideOnly = features.filter((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    return Number.isFinite(lon) && Number.isFinite(lat) && pointInsideBukitPilot(lon, lat);
  });

  return {
    inside_vehicle_poses: layers.vehicle_pose,
    unique_inside_frames: insideFrames.size,
    inside_lane_observations: layers.lane_point,
    inside_edge_observations: layers.edge_point,
    inside_gps_observations: layers.gps_point,
    continuous_inside_pose_spans: runs.length,
    spans_meeting_min_frames: spansMinFrames,
    spans_meeting_min_length_m: spansMinLength,
    spans_meeting_both_gates: spansBothGates,
    max_continuous_inside_vehicle_poses: maxContinuousInsidePoses,
    osm_ways_touched: { measurable: false, reason: 'requires_pose_to_osm_matcher' },
    coordinate_coverage_bounds: coordinateBounds(insideOnly),
    support_note: 'potential_only_not_mismatch_eligible',
  };
}
