import fs from 'node:fs';
import { LAYER_NAMES, insideOutsideCounts } from './update-preview-stats.js';
import { bukitPilotBboxForCounts, pointInsideBukitPilot } from './bukit-pilot-bounds.js';
import { coordinateBounds } from './selected-route-page-validate.js';

const GRID_CELL_METERS = 50;
const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(lon1, lat1, lon2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function metersPerDegreeLat() {
  return 111320;
}

export function metersPerDegreeLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Deterministic 50 m grid over the pilot square (diagnostics only).
 */
export function gridCellKey50m(lon, lat, bbox = bukitPilotBboxForCounts()) {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const mPerLon = metersPerDegreeLon(centerLat);
  const mPerLat = metersPerDegreeLat();
  const x = Math.floor(((lon - bbox.minLon) * mPerLon) / GRID_CELL_METERS);
  const y = Math.floor(((lat - bbox.minLat) * mPerLat) / GRID_CELL_METERS);
  return `${x},${y}`;
}

export function countNonFiniteGeometries(features) {
  let n = 0;
  for (const f of features) {
    const [lon, lat] = f?.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) n += 1;
  }
  return n;
}

function layerInsideCounts(features) {
  const bbox = bukitPilotBboxForCounts();
  const totals = Object.fromEntries(LAYER_NAMES.map((k) => [k, 0]));
  for (const f of features) {
    const layer = f?.properties?.layer;
    if (!layer || totals[layer] === undefined) continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (pointInsideBukitPilot(lon, lat)) totals[layer] += 1;
  }
  return totals;
}

function uniqueInsideValues(features, propNames) {
  const set = new Set();
  for (const f of features) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!pointInsideBukitPilot(lon, lat)) continue;
    const p = f.properties || {};
    for (const name of propNames) {
      if (p[name] != null) set.add(String(p[name]));
    }
  }
  return set;
}

function insideVehiclePosePathMetrics(features) {
  const poses = [];
  for (const f of features) {
    if (f?.properties?.layer !== 'vehicle_pose') continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    poses.push({ lon, lat, inside: pointInsideBukitPilot(lon, lat) });
  }
  let pathLengthM = 0;
  let maxContinuousInside = 0;
  let curContinuous = 0;
  for (let i = 0; i < poses.length; i += 1) {
    const p = poses[i];
    if (p.inside) {
      curContinuous += 1;
      if (i > 0 && poses[i - 1].inside) {
        pathLengthM += haversineMeters(poses[i - 1].lon, poses[i - 1].lat, p.lon, p.lat);
      }
    } else {
      maxContinuousInside = Math.max(maxContinuousInside, curContinuous);
      curContinuous = 0;
    }
  }
  maxContinuousInside = Math.max(maxContinuousInside, curContinuous);
  return { inside_vehicle_path_length_m: pathLengthM, max_continuous_inside_vehicle_poses: maxContinuousInside };
}

function insideTimeSpan(features) {
  const ts = [];
  for (const f of features) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !pointInsideBukitPilot(lon, lat)) continue;
    const p = f.properties || {};
    const candidates = [p.timestamp, p.time, p.t, p.unix_time, p.log_time];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n)) ts.push(n);
    }
  }
  if (ts.length < 2) return { supported: false, span_seconds: null };
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  return { supported: true, span_seconds: max - min };
}

export function vehiclePoseGridCells(features) {
  const cells = new Set();
  for (const f of features) {
    if (f?.properties?.layer !== 'vehicle_pose') continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!pointInsideBukitPilot(lon, lat)) continue;
    cells.add(gridCellKey50m(lon, lat));
  }
  return cells;
}

export function loadActiveRouteVehicleGrid(previewGeojsonPath) {
  const cells = new Set();
  if (!previewGeojsonPath || !fs.existsSync(previewGeojsonPath)) return cells;
  const collection = JSON.parse(fs.readFileSync(previewGeojsonPath, 'utf8'));
  return vehiclePoseGridCells(collection.features || []);
}

export function assignProbeStatus(metrics, { httpOk, validationOk }) {
  if (!httpOk) return 'request_failed';
  if (!validationOk) return 'invalid_page';
  const insideTotal =
    metrics.inside_vehicle_pose +
    metrics.inside_lane_point +
    metrics.inside_edge_point +
    metrics.inside_gps_point;
  if (insideTotal === 0) return 'no_pilot_points_on_page1';
  const promising =
    metrics.unique_inside_frame_count >= 8 && metrics.inside_vehicle_path_length_m >= 25;
  if (promising) return 'promising_page1_coverage';
  return 'some_page1_coverage';
}

export function measurePage1PilotCoverage(features, activeGridCells) {
  const bbox = bukitPilotBboxForCounts();
  const { inside_area_count, outside_area_count } = insideOutsideCounts(features, bbox);
  const layerInside = layerInsideCounts(features);
  const frameSet = uniqueInsideValues(features, ['frame_id', 'frame', 'frame_idx']);
  const segmentSet = uniqueInsideValues(features, ['segment', 'seg', 'segment_id', 'seg_id']);
  const insideBounds = coordinateBounds(
    features.filter((f) => {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      return Number.isFinite(lon) && Number.isFinite(lat) && pointInsideBukitPilot(lon, lat);
    })
  );
  const pathMetrics = insideVehiclePosePathMetrics(features);
  const timeSpan = insideTimeSpan(features);
  const gridCells = vehiclePoseGridCells(features);
  let overlap = 0;
  let novel = 0;
  for (const c of gridCells) {
    if (activeGridCells.has(c)) overlap += 1;
    else novel += 1;
  }

  const metrics = {
    total_features: features.length,
    inside_pilot_features: inside_area_count,
    outside_pilot_features: outside_area_count,
    inside_vehicle_pose: layerInside.vehicle_pose,
    inside_lane_point: layerInside.lane_point,
    inside_edge_point: layerInside.edge_point,
    inside_gps_point: layerInside.gps_point,
    unique_inside_frame_count: frameSet.size,
    unique_inside_segment_count: segmentSet.size,
    inside_bounds: insideBounds,
    inside_vehicle_path_length_m: pathMetrics.inside_vehicle_path_length_m,
    max_continuous_inside_vehicle_poses: pathMetrics.max_continuous_inside_vehicle_poses,
    inside_time_span: timeSpan,
    grid_cells_vehicle_pose_50m: gridCells.size,
    grid_cells_novel_vs_active: novel,
    grid_cells_overlap_active: overlap,
  };

  return metrics;
}

export function buildGeojsonPage1Url({ apiBase, dongle, route }) {
  const layers = 'vehicle_pose,lane_point,edge_point,gps_point';
  const q = new URLSearchParams({
    dongle,
    route,
    layers,
    max_features: '80000',
  });
  return `${apiBase}/v1/geojson?${q.toString()}`;
}
