import path from 'node:path';
import { ROOT_DIR } from '../config.js';

const BASE = path.join(ROOT_DIR, 'data', 'osm-lane-baseline');

export const LANE_BASELINE_AREA = 'bukit-bintang-imbi';

export function laneBaselineDir() {
  return BASE;
}

export function surfacesPath(areaId = LANE_BASELINE_AREA) {
  return path.join(BASE, `${areaId}-road-surfaces.geojson`);
}

export function dividersPath(areaId = LANE_BASELINE_AREA) {
  return path.join(BASE, `${areaId}-lane-dividers.geojson`);
}

export function directionMarkersPath(areaId = LANE_BASELINE_AREA) {
  return path.join(BASE, `${areaId}-direction-markers.geojson`);
}

export function summaryPath(areaId = LANE_BASELINE_AREA) {
  return path.join(BASE, `${areaId}-lane-baseline-summary.json`);
}

export function roadIndexPath(areaId = LANE_BASELINE_AREA) {
  return path.join(BASE, `${areaId}-road-index.json`);
}

/** Artifact paths under an optional output directory (defaults to live lane-baseline data dir). */
export function laneBaselineArtifactPaths(areaId = LANE_BASELINE_AREA, baseDir = BASE) {
  return {
    surfaces: path.join(baseDir, `${areaId}-road-surfaces.geojson`),
    dividers: path.join(baseDir, `${areaId}-lane-dividers.geojson`),
    directionMarkers: path.join(baseDir, `${areaId}-direction-markers.geojson`),
    summary: path.join(baseDir, `${areaId}-lane-baseline-summary.json`),
    roadIndex: path.join(baseDir, `${areaId}-road-index.json`),
  };
}
