import { interpretOsmRoadProperties } from '../lane-interpret.js';
import {
  lineStringToRoadSurface,
  laneDividerOffsets,
  offsetLineFromCentre,
  lineLengthM,
  dedupeCoordinates,
  validateRoadSurface,
  validateDividerLine,
  MIN_SOURCE_SEGMENT_M,
} from '../lane-geometry.js';
import { CATEGORY_WIDTH, VEHICLE_HIGHWAY_TYPES } from './constants.js';

function bump(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

export function simulateFeaturePipeline(f) {
  const stages = [];
  const p = f.properties || {};
  const osmId = String(p.osm_id ?? '');
  const hw = p.highway;

  stages.push({ stage: 'raw_loaded', accepted: 1, rejected: 0 });

  if (f.geometry?.type !== 'LineString') {
    stages.push({ stage: 'geometry_type', accepted: 0, rejected: 1, reason: 'not_linestring' });
    return { osm_id: osmId, stages, terminal: 'rejected_not_linestring' };
  }

  const coords = dedupeCoordinates(f.geometry.coordinates);
  const len = lineLengthM(coords);
  const vehicleEligible = VEHICLE_HIGHWAY_TYPES.has(hw);
  stages.push({
    stage: 'highway_eligibility',
    accepted: vehicleEligible ? 1 : 0,
    rejected: vehicleEligible ? 0 : 1,
    highway: hw,
    vehicle_eligible: vehicleEligible,
  });

  const catW = CATEGORY_WIDTH[hw] ?? 6;
  const interp = interpretOsmRoadProperties(p, catW);
  stages.push({
    stage: 'lane_tag_parsing',
    lane_count_source: interp.lane_count_source,
    explicit_lanes: interp.lane_count_total != null,
  });

  stages.push({
    stage: 'lane_count_resolution',
    lane_count_total: interp.lane_count_total,
    lane_count_forward: interp.lane_count_forward,
    lane_count_backward: interp.lane_count_backward,
    lane_count_both_ways: interp.lane_count_both_ways,
    direction_confidence: interp.direction_confidence,
    road_width_m: interp.road_width_m,
    road_width_source: interp.road_width_source,
    geometry_confidence: interp.geometry_confidence,
    disagreement: interp.disagreement,
  });

  if (len < MIN_SOURCE_SEGMENT_M || coords.length < 2) {
    stages.push({ stage: 'source_length_gate', accepted: 0, rejected: 1, reason: 'source_too_short', length_m: len });
    return { osm_id: osmId, interp, stages, terminal: 'rejected_too_short' };
  }

  const halfW = interp.road_width_m / 2;
  const poly = lineStringToRoadSurface(coords, halfW);
  if (!poly) {
    stages.push({ stage: 'surface_build', accepted: 0, rejected: 1, reason: 'surface_build_failed' });
    return { osm_id: osmId, interp, stages, terminal: 'rejected_surface_build' };
  }

  const validation = validateRoadSurface(poly, coords, halfW, len);
  if (!validation.ok) {
    stages.push({
      stage: 'surface_validation',
      accepted: 0,
      rejected: 1,
      reason: validation.reason,
      analysis: validation.analysis,
    });
    return { osm_id: osmId, interp, stages, terminal: `rejected_${validation.reason}` };
  }

  const surfaceRole =
    interp.geometry_confidence === 'line_only_unknown_lanes' ? 'unknown_lane_outline' : 'osm_derived';
  stages.push({
    stage: 'surface_accepted',
    accepted: 1,
    surface_role: surfaceRole,
    half_width_m: halfW,
  });

  let dividerCount = 0;
  let dividerRejected = 0;
  if (surfaceRole === 'osm_derived' && interp.lane_count_total && interp.lane_count_total >= 2) {
    const offsets = laneDividerOffsets(interp.lane_count_total, interp.road_width_m, interp.direction_confidence);
    const expectedDividers = offsets.length;
    for (const off of offsets) {
      const divCoords = offsetLineFromCentre(coords, off);
      if (!divCoords) {
        dividerRejected += 1;
        continue;
      }
      const divVal = validateDividerLine(divCoords, coords, halfW);
      if (!divVal.ok) {
        dividerRejected += 1;
        continue;
      }
      dividerCount += 1;
    }
    stages.push({
      stage: 'divider_generation',
      expected_offsets: expectedDividers,
      dividers_accepted: dividerCount,
      dividers_rejected: dividerRejected,
    });
  } else {
    stages.push({
      stage: 'divider_generation',
      skipped: true,
      reason:
        surfaceRole !== 'osm_derived'
          ? 'unknown_lane_outline'
          : !interp.lane_count_total || interp.lane_count_total < 2
            ? 'lane_count_lt_2'
            : 'other',
    });
  }

  return {
    osm_id: osmId,
    interp,
    stages,
    terminal: 'accepted',
    surface_role: surfaceRole,
    divider_count: dividerCount,
    length_m: Math.round(len * 100) / 100,
  };
}

export function aggregatePipelineStages(results) {
  const stageLoss = {
    raw_linestrings: 0,
    vehicle_eligible: 0,
    explicit_lane_count: 0,
    surfaces_accepted: 0,
    osm_derived_surfaces: 0,
    unknown_lane_surfaces: 0,
    with_dividers: 0,
    rejection_reasons: {},
  };

  for (const r of results) {
    if (r.terminal?.startsWith('rejected_not_linestring')) continue;
    stageLoss.raw_linestrings += 1;
    const elig = r.stages.find((s) => s.stage === 'highway_eligibility');
    if (elig?.vehicle_eligible) stageLoss.vehicle_eligible += 1;
    if (r.interp?.lane_count_total) stageLoss.explicit_lane_count += 1;
    if (r.terminal === 'accepted') {
      stageLoss.surfaces_accepted += 1;
      if (r.surface_role === 'osm_derived') stageLoss.osm_derived_surfaces += 1;
      if (r.surface_role === 'unknown_lane_outline') stageLoss.unknown_lane_surfaces += 1;
      if (r.divider_count > 0) stageLoss.with_dividers += 1;
    } else if (r.terminal?.startsWith('rejected_')) {
      const reason = r.terminal.replace('rejected_', '');
      bump(stageLoss.rejection_reasons, reason);
    }
  }
  return stageLoss;
}
