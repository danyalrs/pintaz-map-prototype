import fs from 'node:fs';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { matchedPosesPath } from '../comparison-paths.js';
import { routeComparisonDir } from '../local-route-explorer/paths.js';
import { selectCrossSections } from '../lane-enrichment-geometry-v2/cross-section.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { resolveActivePreviewAbs } from './inventory.js';

export const EXAMPLE_FRAME_ID = 19685;
export const EXAMPLE_OSM_WAY = '252085334';
export const EXAMPLE_CROSS_SECTION_ID = 'ef9afb2b3f9c4e37';
export const EXAMPLE_ROUTE = 'active';

function lineId(props) {
  if (props.layer === 'lane_point') {
    return {
      line_id: `lane_index:${props.lane_index}`,
      feature_type: 'lane_boundary_model_line',
    };
  }
  if (props.layer === 'edge_point') {
    return {
      line_id: `edge_index:${props.edge_index}`,
      feature_type: 'road_edge_model_line',
    };
  }
  return { line_id: null, feature_type: null };
}

export function buildExampleFrameTrace(previewAbs, frameId = EXAMPLE_FRAME_ID) {
  const collection = JSON.parse(fs.readFileSync(previewAbs, 'utf8'));
  const features = (collection.features || []).filter((f) => f.properties?.frame_id === frameId);
  const pose = features.find((f) => f.properties?.layer === 'vehicle_pose');

  const lines = features
    .filter((f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point')
    .map((f) => {
      const p = f.properties;
      const { line_id, feature_type } = lineId(p);
      const vertices = 1;
      return {
        frame_id: frameId,
        timestamp: p.log_mono_time || p.unixtime || null,
        vehicle_pose_heading_deg: pose?.properties?.heading_deg ?? null,
        feature_type,
        line_id,
        probability: p.lane_probability ?? p.edge_probability ?? null,
        raw_field_paths: {
          identity: 'properties.frame_id + properties.lane_index | edge_index',
          coordinates_wgs84: 'geometry.coordinates',
          local_scalars: [
            'properties.east_m',
            'properties.north_m',
            'properties.model_x_m',
            'properties.model_y_m',
            'properties.model_z_m',
          ],
          upstream_polyline_hint: [
            'properties.source_point_index_before',
            'properties.source_point_index_after',
            'properties.point_selection',
          ],
        },
        vertex_count: vertices,
        coordinate_units: {
          wgs84: 'degrees lon/lat on Point geometry',
          local_scalars: 'metres in vehicle/model frame (single sample, not an array)',
        },
        ordering_proof:
          vertices === 1
            ? 'Only one GeoJSON feature per (frame_id, lane_index|edge_index); point_index equals slot ordinal, not polyline vertex chain in this export.'
            : 'Multiple vertices present',
        coordinates_local_m_ordered: null,
        coordinates_local_m_single_sample: {
          east_m: p.east_m ?? null,
          north_m: p.north_m ?? null,
          model_forward_m: p.model_x_m ?? null,
          model_lateral_m: p.model_y_m ?? null,
        },
        wgs84_point: f.geometry.coordinates,
        can_intersect_cross_section: false,
        intersection_block_reason:
          'Degenerate polyline (one point per line per frame); no ordered vertex array in local artefacts. True line–plane intersection requires upstream polyline export or qlog source (not present locally).',
      };
    });

  return {
    schema: 'pintaz.lane-enrichment-v3.example-frame-trace',
    frame_id: frameId,
    osm_way_context: EXAMPLE_OSM_WAY,
    cross_section_id: EXAMPLE_CROSS_SECTION_ID,
    route_key: EXAMPLE_ROUTE,
    lines,
    vehicle_pose: pose
      ? {
          frame_id: pose.properties.frame_id,
          heading_deg: pose.properties.heading_deg,
          wgs84: pose.geometry.coordinates,
          east_m: pose.properties.east_m,
          north_m: pose.properties.north_m,
        }
      : null,
    verdict: 'V3_GEOMETRY_NOT_AVAILABLE',
  };
}

export function assessCrossSectionFeasibility(previewAbs, osmWayId = EXAMPLE_OSM_WAY) {
  const collection = JSON.parse(fs.readFileSync(previewAbs, 'utf8'));
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const feat = roads.features.find((f) => normalizeOsmWayId(f.properties?.osm_id) === osmWayId);
  const compDir = routeComparisonDir('active');
  const matched = JSON.parse(fs.readFileSync(matchedPosesPath(compDir), 'utf8')).features;
  const posesOnWay = matched.filter((f) => normalizeOsmWayId(f.properties?.osm_id) === osmWayId);
  const { sections } = selectCrossSections(osmWayId, feat.geometry.coordinates, posesOnWay);
  const best = sections.sort((a, b) => b.matched_pose_count - a.matched_pose_count)[0];
  const sectionFrameIds = new Set(best?.pose_samples?.map((s) => s.pose.properties.frame_id) || []);

  let lanePointsOnSection = 0;
  let maxVertices = 0;
  for (const f of collection.features) {
    if (f.properties?.layer !== 'lane_point' && f.properties?.layer !== 'edge_point') continue;
    if (!sectionFrameIds.has(f.properties?.frame_id)) continue;
    lanePointsOnSection += 1;
    maxVertices = Math.max(maxVertices, 1);
  }

  return {
    route_key: EXAMPLE_ROUTE,
    osm_way_id: osmWayId,
    cross_section_id: best?.cross_section_id || null,
    matches_v2_1_cross_section: best?.cross_section_id === EXAMPLE_CROSS_SECTION_ID,
    accepted_pose_frames_on_section: sectionFrameIds.size,
    lane_edge_point_features_on_section: lanePointsOnSection,
    can_reconstruct_ordered_polyline_per_frame: false,
    can_compute_line_cross_section_intersection: false,
    reason:
      'All lane_point/edge_point features on this section are WGS84 Points with max 1 vertex per (frame_id, line_id).',
    local_qlog_bz2_available: false,
  };
}
