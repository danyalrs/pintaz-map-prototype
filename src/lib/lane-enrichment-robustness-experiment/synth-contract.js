import { createRng, EXPERIMENT_SEED } from './seeded-rng.js';

const COORD_FRAME = {
  schema: 'ego_vehicle_m',
  forward_axis: '+x_along_heading',
  lateral_axis: '+y_left',
  units: 'metres',
};

/** Lane width ~3 m; road width = laneCount * 3. */
export function laneLayout(laneCount) {
  const halfWidth = (laneCount * 3) / 2;
  const edges = [-halfWidth, halfWidth];
  const boundaries = [];
  for (let i = 1; i < laneCount; i++) {
    const t = i / laneCount;
    boundaries.push(-halfWidth + t * 2 * halfWidth);
  }
  return { edges, boundaries, halfWidth };
}

function horizLine(fid, lineId, type, lateral, probability, uncertainty = 0.08) {
  return {
    frame_id: fid,
    feature_type: type,
    line_id: lineId,
    probability,
    uncertainty,
    coordinates_local_m: [[35, lateral], [65, lateral]],
  };
}

function vehicleFrame(fid, { poseQuality = 0.92, headingDiff = 2, distanceM = 0.35 }) {
  return {
    frame_id: fid,
    timestamp: String(70000000000 + fid),
    pose: { forward_m: 50, lateral_m: 0, heading_deg: 90 },
    pose_match: {
      distance_m: distanceM,
      heading_diff_deg: headingDiff,
      quality: poseQuality,
    },
  };
}

/**
 * @param {number} laneCount
 * @param {Array<{ frame_id: number, poseQuality?: number, headingDiff?: number, distanceM?: number, lateralJitter?: number, skipEdges?: 'left'|'right'|null, extraBoundaries?: Array<{ lateral: number, probability: number }>, omitBoundaries?: boolean, forcedLaneCount?: number }>} frameSpecs
 */
export function buildSyntheticContract(laneCount, frameSpecs, { routeKey = 'synthetic-robustness' } = {}) {
  const defaultLayout = laneLayout(laneCount);
  const rng = createRng(EXPERIMENT_SEED + laneCount * 17);
  const vehicle_frames = [];
  const line_features = [];

  for (const spec of frameSpecs) {
    const jitter = spec.lateralJitter ?? 0;
    const jq = () => (jitter ? (rng() - 0.5) * 2 * jitter : 0);
    const layout = spec.forcedLaneCount != null ? laneLayout(spec.forcedLaneCount) : defaultLayout;
    const edgeScale = spec.edgeScale ?? 1;
    const leftEdge = layout.edges[0] * edgeScale;
    const rightEdge = layout.edges[1] * edgeScale;
    vehicle_frames.push(
      vehicleFrame(spec.frame_id, {
        poseQuality: spec.poseQuality ?? 0.92,
        headingDiff: spec.headingDiff ?? 2,
        distanceM: spec.distanceM ?? 0.35,
      })
    );
    const fid = spec.frame_id;
    if (spec.skipEdges !== 'left') {
      line_features.push(
        horizLine(fid, 're_l', 'road_edge', leftEdge + jq(), spec.edgeProbability ?? 0.92)
      );
    }
    if (spec.skipEdges !== 'right') {
      line_features.push(
        horizLine(fid, 're_r', 'road_edge', rightEdge + jq(), spec.edgeProbability ?? 0.92)
      );
    }
    if (!spec.omitBoundaries) {
      layout.boundaries.forEach((y, i) => {
        line_features.push(
          horizLine(fid, `lb_${i}`, 'lane_boundary', y + jq(), spec.boundaryProbability ?? 0.9)
        );
      });
    }
    for (const extra of spec.extraBoundaries || []) {
      line_features.push(
        horizLine(fid, `lb_x_${extra.lateral}`, 'lane_boundary', extra.lateral, extra.probability)
      );
    }
  }

  return {
    schema: 'pintaz.lane-enrichment-input.v1',
    route_key: routeKey,
    coordinate_frame: COORD_FRAME,
    osm_road: {
      osm_way_id: `synthetic-${laneCount}lane`,
      one_way: true,
      centreline_local_m: [[0, 0], [50, 0], [100, 0]],
      junction_nearby: false,
    },
    cross_section: {
      cross_section_id: `cs-${laneCount}lane`,
      anchor_forward_m: 50,
      anchor_lateral_m: 0,
      tangent_forward: [1, 0],
    },
    vehicle_frames,
    line_features,
  };
}

export function pointOnlyMapsReadShaped() {
  return {
    type: 'FeatureCollection',
    metadata: { schema: 'kommu.maps.visualization-point-cloud', schema_version: 1 },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [101.71, 3.15] },
        properties: { layer: 'lane_point', frame_id: 1, lane_index: 0 },
      },
    ],
  };
}
