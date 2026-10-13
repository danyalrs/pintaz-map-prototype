import { buildSyntheticContract, pointOnlyMapsReadShaped } from './synth-contract.js';

function cleanFrames(ids, overrides = {}) {
  return ids.map((id) => ({ frame_id: id, ...overrides }));
}

export function buildAllScenarios(laneCount) {
  const scenarios = {};

  scenarios.A_one_clean_frame = buildSyntheticContract(laneCount, cleanFrames([1], { poseQuality: 0.9, boundaryProbability: 0.92, edgeProbability: 0.92 }));

  scenarios.B_three_clean_frames = buildSyntheticContract(laneCount, cleanFrames([10, 11, 12]));

  scenarios.C_low_confidence_false_boundary = buildSyntheticContract(laneCount, [
    ...cleanFrames([20, 21, 22]),
    {
      frame_id: 23,
      extraBoundaries: [{ lateral: 0.5, probability: 0.15 }],
    },
  ]);

  scenarios.D_isolated_extra_boundary = buildSyntheticContract(laneCount, [
    ...cleanFrames([30, 31, 32]),
    {
      frame_id: 33,
      extraBoundaries: [{ lateral: laneCount === 1 ? 0 : laneCount * 0.4, probability: 0.88 }],
    },
  ]);

  scenarios.E_missing_road_edge_frames = buildSyntheticContract(laneCount, [
    { frame_id: 40 },
    { frame_id: 41 },
    { frame_id: 42, skipEdges: 'right' },
    { frame_id: 43, skipEdges: 'left' },
  ]);

  const competingLaneCount = laneCount === 1 ? 3 : laneCount === 3 ? 1 : 3;
  scenarios.F_conflicting_frame_groups = buildSyntheticContract(laneCount, [
    ...cleanFrames([50, 51, 52]),
    ...cleanFrames([60, 61, 62], { forcedLaneCount: competingLaneCount }),
  ]);

  scenarios.G_high_noise = buildSyntheticContract(
    laneCount,
    cleanFrames([70, 71, 72, 73, 74], {
      lateralJitter: 1.8,
      poseQuality: 0.55,
      headingDiff: 18,
      distanceM: 6,
    })
  );

  scenarios.H_point_only = pointOnlyMapsReadShaped();

  const outlierTypes = {
    A_one_clean_frame: 'none',
    B_three_clean_frames: 'none',
    C_low_confidence_false_boundary: 'low_confidence_false_boundary',
    D_isolated_extra_boundary: 'isolated_extra_boundary',
    E_missing_road_edge_frames: 'missing_road_edge',
    F_conflicting_frame_groups: 'conflicting_groups',
    G_high_noise: 'high_pose_and_lateral_noise',
    H_point_only: 'point_only_source',
  };

  return { scenarios, outlierTypes };
}

export function runFullExperiment(runPipeline) {
  const laneCounts = [1, 2, 3];
  const rows = [];
  let anyIncorrect = false;

  for (const laneCount of laneCounts) {
    const { scenarios, outlierTypes } = buildAllScenarios(laneCount);
    for (const [scenarioId, contract] of Object.entries(scenarios)) {
      const record = runPipeline(contract, laneCount);
      const row = {
        lane_configuration: laneCount,
        scenario_id: scenarioId,
        outlier_type: outlierTypes[scenarioId],
        ...record,
      };
      if (row.classification === 'incorrect') anyIncorrect = true;
      rows.push(row);
    }
  }
  return { rows, anyIncorrect };
}
