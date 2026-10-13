import { FEATURE_TYPE } from '../../../src/lib/lane-enrichment-algorithm-core/constants.js';
import { intersectLineWithCrossSection } from '../../../src/lib/lane-enrichment-algorithm-core/intersect-line-with-cross-section.js';
import { baseBundle, horizLine } from './helpers.js';

export function caseA() {
  return baseBundle({
    frames: [
      {
        frame_id: 1,
        pose_quality: 0.95,
        heading_aligned: true,
        lines: [horizLine(-2, 're_l', FEATURE_TYPE.ROAD_EDGE), horizLine(2, 're_r', FEATURE_TYPE.ROAD_EDGE)],
      },
      {
        frame_id: 2,
        pose_quality: 0.92,
        heading_aligned: true,
        lines: [horizLine(-2.05, 're_l', FEATURE_TYPE.ROAD_EDGE), horizLine(2.05, 're_r', FEATURE_TYPE.ROAD_EDGE)],
      },
    ],
  });
}

export function caseB() {
  const mk = (fid, dy = 0) => ({
    frame_id: fid,
    pose_quality: 0.93,
    heading_aligned: true,
    lines: [
      horizLine(-6 + dy, 're_l', FEATURE_TYPE.ROAD_EDGE),
      horizLine(-2 + dy, 'lb_1', FEATURE_TYPE.LANE_BOUNDARY),
      horizLine(2 + dy, 'lb_2', FEATURE_TYPE.LANE_BOUNDARY),
      horizLine(6 + dy, 're_r', FEATURE_TYPE.ROAD_EDGE),
    ],
  });
  return baseBundle({ frames: [mk(10), mk(11), mk(12)] });
}

export function caseC() {
  const b = caseB();
  b.frames.push({
    frame_id: 99,
    pose_quality: 0.9,
    heading_aligned: true,
    lines: [
      horizLine(-6, 're_l', FEATURE_TYPE.ROAD_EDGE),
      horizLine(-2, 'lb_1', FEATURE_TYPE.LANE_BOUNDARY),
      horizLine(0, 'lb_false', FEATURE_TYPE.LANE_BOUNDARY, 0.2),
      horizLine(2, 'lb_2', FEATURE_TYPE.LANE_BOUNDARY),
      horizLine(6, 're_r', FEATURE_TYPE.ROAD_EDGE),
      horizLine(4.5, 'lb_extra', FEATURE_TYPE.LANE_BOUNDARY, 0.9),
    ],
  });
  return b;
}

export function caseD() {
  return baseBundle({
    frames: [
      {
        frame_id: 1,
        pose_quality: 0.95,
        heading_aligned: true,
        lines: [horizLine(-3, 're_l', FEATURE_TYPE.ROAD_EDGE, 0.92)],
      },
    ],
  });
}

export function caseE() {
  return baseBundle({
    source_kind: 'point_only',
    point_only: true,
    frames: [
      {
        frame_id: 1,
        pose_quality: 0.9,
        heading_aligned: true,
        lines: [
          {
            line_id: 'p1',
            feature_type: FEATURE_TYPE.LANE_BOUNDARY,
            probability: 0.9,
            coordinates_local_m: [[50, 0]],
          },
        ],
      },
    ],
  });
}

export function caseF() {
  return baseBundle({
    frames: [
      {
        frame_id: 1,
        pose_quality: 0.95,
        heading_aligned: true,
        lines: [
          {
            line_id: 'ambiguous',
            feature_type: FEATURE_TYPE.LANE_BOUNDARY,
            probability: 0.9,
            coordinates_local_m: [[40, -2], [60, 2], [40, 2]],
          },
          horizLine(-6, 're_l', FEATURE_TYPE.ROAD_EDGE),
          horizLine(6, 're_r', FEATURE_TYPE.ROAD_EDGE),
        ],
      },
    ],
  });
}

export function caseG() {
  const oneLane = (fid) => ({
    frame_id: fid,
    pose_quality: 0.95,
    heading_aligned: true,
    lines: [horizLine(-1.5, 're_l', FEATURE_TYPE.ROAD_EDGE, 0.92), horizLine(1.5, 're_r', FEATURE_TYPE.ROAD_EDGE, 0.92)],
  });
  const threeLane = (fid) => ({
    frame_id: fid,
    pose_quality: 0.95,
    heading_aligned: true,
    lines: [
      horizLine(-4.5, 're_l', FEATURE_TYPE.ROAD_EDGE, 0.92),
      horizLine(-1.5, 'lb_1', FEATURE_TYPE.LANE_BOUNDARY, 0.9),
      horizLine(1.5, 'lb_2', FEATURE_TYPE.LANE_BOUNDARY, 0.9),
      horizLine(4.5, 're_r', FEATURE_TYPE.ROAD_EDGE, 0.92),
    ],
  });
  return baseBundle({
    frames: [oneLane(1), oneLane(2), threeLane(10), threeLane(11)],
  });
}

export function assertCaseFIntersection() {
  const cs = { anchor: [50, 0], tangent: [1, 0] };
  const bow = intersectLineWithCrossSection([[40, -2], [60, 2], [40, 2]], cs);
  return bow.ok === false && bow.reason === 'ambiguous_multiple_intersections';
}

export const ALL_CASES = {
  A: caseA,
  B: caseB,
  C: caseC,
  D: caseD,
  E: caseE,
  F: caseF,
  G: caseG,
};
