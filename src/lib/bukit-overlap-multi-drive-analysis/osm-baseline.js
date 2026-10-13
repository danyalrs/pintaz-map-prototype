import fs from 'node:fs';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { roadIndexPath } from '../lane-baseline-paths.js';

export function loadOsmRoadById() {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  return new Map(roads.features.map((f) => [String(f.properties?.osm_id), f]));
}

export function loadRoadIndex() {
  if (!fs.existsSync(roadIndexPath())) return { by_osm_id: {} };
  return JSON.parse(fs.readFileSync(roadIndexPath(), 'utf8'));
}

export function compareSpanToOsmBaseline(osmId, roadById, roadIndex) {
  const feat = roadById.get(String(osmId));
  const idx = roadIndex.by_osm_id?.[String(osmId)] || {};
  const props = feat?.properties || {};
  return {
    osm_id: String(osmId),
    osm_confirmed: {
      highway: props.highway ?? null,
      oneway: props.oneway ?? null,
      lanes_tag: props.lanes ?? props.lanes_forward ?? null,
      bridge: props.bridge ?? null,
      tunnel: props.tunnel ?? null,
      layer: props.layer ?? null,
      centreline_geometry: feat?.geometry?.type === 'LineString',
    },
    display_estimates: {
      derived_display_lane_width_m: idx.lane_width_m ?? 3.2,
      road_width_m: idx.road_width_m ?? null,
      road_width_source: idx.road_width_source ?? null,
      lane_count_total: idx.lane_count_total ?? null,
      note: 'display_lane_width_not_surveyed_truth',
    },
    lane_baseline: {
      geometry_status: idx.geometry_status ?? null,
      geometry_confidence: idx.geometry_confidence ?? null,
      road_surface_accepted: idx.geometry_status === 'accepted_surface',
      divider_count_generated: null,
    },
    unknown_fields: [],
    server_observed: {},
  };
}
