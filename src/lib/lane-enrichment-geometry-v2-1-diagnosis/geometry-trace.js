import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import { buildGeometryWayRow } from '../lane-enrichment-geometry-v2/build-way.js';
import { selectCrossSections } from '../lane-enrichment-geometry-v2/cross-section.js';
import { signedLateralM, lonLatToLocalM } from '../lane-enrichment-geometry-v2/local-project.js';
import { LIMITS } from '../lane-enrichment-geometry-v2/constants.js';
import { pointToSegmentMetres } from '../geo-segment.js';

const CROSS_ALONG_TOLERANCE_M = 2.5;

export function lineIdentity(props) {
  if (props.layer === 'lane_point') {
    return `lane_line:lane_index=${props.lane_index}:source_feature_index=${props.source_feature_index ?? 'na'}`;
  }
  if (props.layer === 'edge_point') {
    return `road_edge_line:edge_index=${props.edge_index}:source_feature_index=${props.source_feature_index ?? 'na'}`;
  }
  return `unknown:${props.layer}`;
}

export function clusterBinKey(lateralM) {
  return Math.round(lateralM / LIMITS.clusterBinM);
}

export function assignCluster(lateralM, clusters, kind) {
  const key = clusterBinKey(lateralM);
  const list = kind === 'road_edge' ? clusters.road_edges : clusters.lane_boundaries;
  const hit = list.find((c) => clusterBinKey(c.center_lateral_m) === key);
  return hit ? `${kind}:${hit.center_lateral_m}` : null;
}

function alongDeltaFromPose(lon, lat, poseLon, poseLat, seg) {
  const pt = pointToSegmentMetres(lon, lat, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
  const pp = pointToSegmentMetres(poseLon, poseLat, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
  return {
    along_m_on_centreline: pt.alongM,
    pose_along_m: pp.alongM,
    longitudinal_delta_m: pt.alongM - pp.alongM,
    centreline_distance_m: pt.distanceM,
    segment_t: pt.t,
  };
}

export function reproduceV2Row({ routeKey, osmWayId, roadFeature, roadIndexEntry, matchedPoses, previewFeatures }) {
  return buildGeometryWayRow({
    routeKey,
    osmWayId,
    roadFeature,
    roadIndexEntry,
    matchedPoses,
    previewFeatures,
    evalLabelOsmLanes: roadIndexEntry?.lane_count_total ?? null,
  });
}

export function buildFrameTrace({
  routeKey,
  osmWayId,
  roadFeature,
  roadIndexEntry,
  matchedPoses,
  previewFeatures,
}) {
  const row = reproduceV2Row({
    routeKey,
    osmWayId,
    roadFeature,
    roadIndexEntry,
    matchedPoses,
    previewFeatures,
  });
  const coords = roadFeature.geometry.coordinates;
  const posesOnWay = matchedPoses.filter(
    (f) => String(f.properties?.osm_id) === String(osmWayId)
  );
  const { sections } = selectCrossSections(osmWayId, coords, posesOnWay);
  const best = sections.sort((a, b) => b.matched_pose_count - a.matched_pose_count)[0];
  const seg = best.segment_endpoints;
  const originLon = best.anchor[0];
  const originLat = best.anchor[1];

  const laneEdge = (previewFeatures || []).filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const sectionPoses = best.pose_samples.map((s) => s.pose);
  const poseLookup = buildPoseLookup(sectionPoses);
  const { attached } = attachObservationsToPoses(laneEdge, poseLookup, new Map());

  const acceptedFrames = (row.frame_evidence || []).filter((f) => f.accepted);
  const clusters = row.boundary_clusters;

  const traces = [];
  for (const fr of acceptedFrames) {
    const frameId = fr.frame_id;
    const pose = sectionPoses.find((p) => p.properties.frame_id === frameId);
    const [poseLon, poseLat] = pose.geometry.coordinates;
    const rawObs = previewFeatures.filter(
      (f) =>
        f.properties?.frame_id === frameId &&
        (f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point')
    );

    for (const raw of rawObs) {
      const p = raw.properties;
      const [lon, lat] = raw.geometry.coordinates;
      const lateral_m = signedLateralM(lon, lat, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
      const local = lonLatToLocalM(lon, lat, originLon, originLat);
      const poseLocal = lonLatToLocalM(poseLon, poseLat, originLon, originLat);
      const along = alongDeltaFromPose(lon, lat, poseLon, poseLat, seg);
      const kind = p.layer === 'edge_point' ? 'road_edge' : 'lane_boundary';
      const clusterLabel = assignCluster(lateral_m, clusters, kind);
      const reasons = [];
      if (Math.abs(along.longitudinal_delta_m) > CROSS_ALONG_TOLERANCE_M) {
        reasons.push('longitudinal_offset_from_pose_exceeds_cross_section_band');
      }
      if (along.segment_t < 0 || along.segment_t > 1) {
        reasons.push('projection_outside_osm_segment_span');
      }
      const usedByV2 = fr.lane_point_lateral_m.some(
        (x) => x.trace_lane_index === p.lane_index && p.layer === 'lane_point'
      ) ||
        fr.edge_point_lateral_m.some(
          (x) => x.trace_edge_index === p.edge_index && p.layer === 'edge_point'
        );
      if (!usedByV2) reasons.push('not_in_v2_accepted_frame_lateral_list');
      if (usedByV2 && reasons.length === 0) reasons.push('v2_counts_as_independent_lateral_sample');
      if (usedByV2 && reasons.some((r) => r.startsWith('longitudinal'))) {
        reasons.push('v2_counts_despite_longitudinal_offset');
      }

      traces.push({
        frame_id: frameId,
        cross_section_id: row.cross_section_ids[0],
        line_identity: lineIdentity(p),
        layer: p.layer,
        lane_index: p.lane_index ?? null,
        edge_index: p.edge_index ?? null,
        point_index: p.point_index ?? null,
        source_feature_index: p.source_feature_index ?? null,
        wgs84: [lon, lat],
        local_m: { x: Math.round(local.x * 1000) / 1000, y: Math.round(local.y * 1000) / 1000 },
        pose_local_m: { x: Math.round(poseLocal.x * 1000) / 1000, y: Math.round(poseLocal.y * 1000) / 1000 },
        longitudinal: {
          ...along,
          longitudinal_delta_m: Math.round(along.longitudinal_delta_m * 1000) / 1000,
        },
        signed_lateral_m: Math.round(lateral_m * 1000) / 1000,
        lateral_cluster_bin: clusterBinKey(lateral_m),
        cluster_assignment: clusterLabel,
        v2_included_in_hypothesis: usedByV2,
        inclusion_exclusion_reasons: reasons,
      });
    }
  }

  const perFrameSummary = acceptedFrames.map((fr) => {
    const interiorBins = new Set(
      fr.lane_point_lateral_m.map((p) => clusterBinKey(p.lateral_m))
    );
    return {
      frame_id: fr.frame_id,
      lane_point_count: fr.lane_point_lateral_m.length,
      edge_point_count: fr.edge_point_lateral_m.length,
      unique_lateral_bins_from_lane_points: interiorBins.size,
      v2_implied_lane_count_interior_bins_plus_one: interiorBins.size + 1,
      lane_indices: fr.lane_point_lateral_m.map((p) => p.trace_lane_index),
    };
  });

  const vehicle_poses = sectionPoses.map((p) => {
    const [lon, lat] = p.geometry.coordinates;
    const local = lonLatToLocalM(lon, lat, originLon, originLat);
    return {
      frame_id: p.properties.frame_id,
      wgs84: [lon, lat],
      local_m: { x: Math.round(local.x * 1000) / 1000, y: Math.round(local.y * 1000) / 1000 },
      heading_diff_deg: p.properties.heading_diff_deg,
      distance_m: p.properties.distance_m,
    };
  });

  return {
    reproduction: {
      route_key: routeKey,
      osm_way_id: osmWayId,
      cross_section_id: row.cross_section_ids[0],
      selected_lane_count: row.selected_lane_count,
      decision: row.decision,
      confidence: row.confidence,
      accepted_frame_count: row.accepted_frame_count,
      hypothesis_detail: row.hypothesis_detail,
      boundary_clusters: clusters,
    },
    cross_section: {
      cross_section_id: best.cross_section_id,
      anchor_wgs84: best.anchor,
      segment_endpoints: seg,
      bearing_deg: best.bearing_deg,
    },
    per_frame_lane_count_logic: perFrameSummary,
    vehicle_poses,
    point_traces: traces,
  };
}

/** Invariant: one source line identity + one cross-section → at most one valid crossing observation. */
export function maxCrossingsPerLinePerFrame(pointTraces) {
  const byFrameLine = new Map();
  for (const t of pointTraces) {
    const k = `${t.frame_id}|${t.line_identity}`;
    if (!byFrameLine.has(k)) byFrameLine.set(k, []);
    byFrameLine.get(k).push(t);
  }
  const violations = [];
  for (const [key, pts] of byFrameLine) {
    if (pts.length > 1) {
      violations.push({ key, count: pts.length, frame_id: pts[0].frame_id, line_identity: pts[0].line_identity });
    }
  }
  return { ok: violations.length === 0, violations, line_frame_pairs: byFrameLine.size };
}

export function diagnoseRootCauseCategories(traceBundle) {
  const traces = traceBundle.point_traces;
  const longOff = traces.filter((t) =>
    t.inclusion_exclusion_reasons.includes('longitudinal_offset_from_pose_exceeds_cross_section_band')
  ).length;
  const multiLaneIndexPerFrame = traceBundle.per_frame_lane_count_logic.every(
    (f) => f.unique_lateral_bins_from_lane_points >= f.lane_point_count - 1
  );
  const v2UsesAllLaneLines = traceBundle.per_frame_lane_count_logic.every(
    (f) => f.lane_point_count >= 4 && f.v2_implied_lane_count_interior_bins_plus_one === 5
  );
  return {
    several_points_one_polyline: false,
    note_polyline: 'Preview exports one point per model lane line per frame (no WGS84 polyline vertices).',
    points_far_from_cross_section_plane: longOff > 0,
    longitudinally_offset_point_count: longOff,
    line_does_not_intersect_cross_section: 'Not applicable: V2 never tests line–plane intersection; uses point projection only.',
    source_line_bend: 'Not evidenced in WGS84 (single point per line per frame).',
    road_edge_not_full_carriageway: traceBundle.reproduction.boundary_clusters.road_edges.length > 2,
    cross_section_transform_wrong: false,
    v2_counts_each_lane_line_slot_as_boundary: v2UsesAllLaneLines,
    v2_per_frame_lane_count_uses_interior_bin_count_plus_one: true,
    confirmed_primary_cause:
      'V2 hypothesis counts distinct lateral bins of all lane_point samples per frame as interior boundaries (+1 for lanes), while preview supplies up to four model lane-line slots (lane_index 0..3) per frame — not physical lane dividers.',
  };
}
