import { FUTURE_EXPORT_SCHEMA } from './constants.js';
import { OSM_CONTEXT_SCHEMA } from './osm-enrichment-context.js';
import { buildSyntheticContract } from '../lane-enrichment-robustness-experiment/synth-contract.js';
import { pointOnlyMapsReadShaped } from '../lane-enrichment-robustness-experiment/synth-contract.js';

const COORD_FRAME = {
  schema: 'ego_vehicle_m',
  forward_axis: '+x_along_heading',
  lateral_axis: '+y_left',
  units: 'metres',
};

export function pintazContextFromContract(contract) {
  const pose_match_by_frame_id = {};
  for (const vf of contract.vehicle_frames) {
    pose_match_by_frame_id[vf.frame_id] = vf.pose_match;
  }
  return {
    schema: OSM_CONTEXT_SCHEMA,
    osm_way_id: contract.osm_road.osm_way_id,
    osm_road: contract.osm_road,
    cross_section: contract.cross_section,
    pose_match_by_frame_id,
  };
}

/** Maps Read observation export only — no OSM or cross-section. */
export function contractToServerExport(contract, { routeKey, spoofOsmWayId = null } = {}) {
  const features = [];
  for (const vf of contract.vehicle_frames) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [vf.pose.forward_m, vf.pose.lateral_m] },
      properties: {
        feature_type: 'vehicle_pose',
        role: 'vehicle_pose',
        frame_id: vf.frame_id,
        timestamp: vf.timestamp,
        pose: vf.pose,
      },
    });
  }
  for (const line of contract.line_features) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: line.coordinates_local_m,
      },
      properties: {
        frame_id: line.frame_id,
        timestamp: String(60000000000 + line.frame_id),
        feature_type: line.feature_type,
        line_id: line.line_id,
        probability: line.probability,
        uncertainty: line.uncertainty,
        coordinates_local_m: line.coordinates_local_m,
      },
    });
  }
  const metadata = {
    schema: FUTURE_EXPORT_SCHEMA,
    schema_version: 1,
    route_key: routeKey,
    coordinate_frame: contract.coordinate_frame || COORD_FRAME,
  };
  if (spoofOsmWayId) {
    metadata.osm_road = {
      osm_way_id: spoofOsmWayId,
      one_way: true,
      centreline_local_m: [[0, 0], [1, 0]],
    };
    metadata.cross_section = { cross_section_id: 'server-should-be-ignored' };
  }
  return {
    type: 'FeatureCollection',
    metadata,
    features,
  };
}

function pairFromContract(contract, routeKey, options = {}) {
  return {
    server: contractToServerExport(contract, { routeKey, ...options }),
    context: pintazContextFromContract(contract),
  };
}

export function fixtureA_oneLane() {
  const contract = buildSyntheticContract(1, [{ frame_id: 1, poseQuality: 0.92, boundaryProbability: 0.92, edgeProbability: 0.92 }], {
    routeKey: 'future-maps-read-one-lane',
  });
  return pairFromContract(contract, 'future-maps-read-one-lane');
}

export function fixtureB_threeLane() {
  const contract = buildSyntheticContract(
    3,
    [{ frame_id: 10 }, { frame_id: 11 }, { frame_id: 12 }],
    { routeKey: 'future-maps-read-three-lane' }
  );
  return pairFromContract(contract, 'future-maps-read-three-lane');
}

export function fixtureC_pointOnly() {
  return { server: pointOnlyMapsReadShaped(), context: null };
}

export function fixtureD_missingVertices() {
  const base = fixtureA_oneLane();
  const bad = base.server.features.find(
    (f) => f.properties?.feature_type === 'lane_boundary' || f.properties?.feature_type === 'road_edge'
  );
  if (bad) {
    bad.geometry = { type: 'LineString', coordinates: [[50, 0]] };
    bad.properties.coordinates_local_m = [[50, 0]];
  }
  return base;
}

export function fixtureE_conflicting() {
  const contract = buildSyntheticContract(
    3,
    [
      ...[50, 51, 52].map((id) => ({ frame_id: id })),
      ...[60, 61, 62].map((id) => ({ frame_id: id, forcedLaneCount: 1 })),
    ],
    { routeKey: 'future-maps-read-conflict' }
  );
  return pairFromContract(contract, 'future-maps-read-conflict');
}

/** Server export with spoof OSM id; local context remains authoritative. */
export function fixtureServerOsmOverrideTest() {
  const contract = buildSyntheticContract(1, [{ frame_id: 1 }], { routeKey: 'future-maps-read-override-test' });
  return {
    server: contractToServerExport(contract, {
      routeKey: 'future-maps-read-override-test',
      spoofOsmWayId: 'server-export-fake-way-999',
    }),
    context: pintazContextFromContract(contract),
    expected_local_osm_way_id: contract.osm_road.osm_way_id,
  };
}

export const FIXTURE_CASES = {
  A: fixtureA_oneLane,
  B: fixtureB_threeLane,
  C: fixtureC_pointOnly,
  D: fixtureD_missingVertices,
  E: fixtureE_conflicting,
};
