import fs from 'node:fs';
import { haversineMetres } from '../geo-square.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { buildOsmSegmentIndex, querySegmentsNear } from '../osm-segment-index.js';
import { TARGET_OSM_WAY_ID } from './config.js';

export function lineLengthM(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    sum += haversineMetres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return sum;
}

export function loadTargetWayFeature() {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const feature = roads.features.find((f) => String(f.properties?.osm_id) === TARGET_OSM_WAY_ID);
  if (!feature) throw new Error('target_way_missing');
  return { roads, feature };
}

export function auditOsmWay() {
  const { roads, feature } = loadTargetWayFeature();
  const coords = feature.geometry.coordinates;
  const idx = fs.existsSync(roadIndexPath()) ? JSON.parse(fs.readFileSync(roadIndexPath(), 'utf8')) : { by_osm_id: {} };
  const lane = idx.by_osm_id?.[TARGET_OSM_WAY_ID] || {};
  const index = buildOsmSegmentIndex(roads);
  const start = coords[0];
  const end = coords[coords.length - 1];
  const neighbourIds = new Set();
  const parallel = new Set();
  for (const pt of [start, end]) {
    for (const seg of querySegmentsNear(index, pt[0], pt[1], 18)) {
      if (String(seg.osm_id) !== TARGET_OSM_WAY_ID) neighbourIds.add(String(seg.osm_id));
    }
  }
  for (let i = 0; i < coords.length; i += 2) {
    const [lon, lat] = coords[i];
    const near = querySegmentsNear(index, lon, lat, 12);
    const ids = new Set(near.map((s) => String(s.osm_id)));
    if (ids.size >= 3) parallel.add(`coord_index_${i}`);
  }
  const props = feature.properties || {};
  return {
    osm_id: TARGET_OSM_WAY_ID,
    geometry: {
      type: 'LineString',
      vertex_count: coords.length,
      length_m: lineLengthM(coords),
      endpoints: { start, end },
      coordinates: coords,
    },
    tags: {
      highway: props.highway ?? null,
      name: props.name ?? null,
      ref: props.ref ?? null,
      lanes: props.lanes ?? null,
      oneway: props.oneway ?? null,
      bridge: props.bridge ?? null,
      tunnel: props.tunnel ?? null,
      layer: props.layer ?? null,
      junction: props.junction ?? null,
      access: props.access ?? null,
    },
    lane_baseline: {
      geometry_status: lane.geometry_status ?? null,
      road_width_m: lane.road_width_m ?? null,
      lane_count_total: lane.lane_count_total ?? null,
      geometry_confidence: lane.geometry_confidence ?? null,
      surface_accepted: lane.geometry_status === 'accepted_surface',
    },
    derived: {
      divider_count: null,
      geometry_validation: coords.length >= 2 ? 'linestring_ok' : 'invalid',
    },
    topology: {
      endpoint_neighbour_osm_ids: [...neighbourIds].sort(),
      parallel_cluster_hints: [...parallel],
      junction_near_geometry: parallel.size > 0,
    },
  };
}
