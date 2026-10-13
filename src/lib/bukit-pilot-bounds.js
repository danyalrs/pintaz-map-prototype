import fs from 'node:fs';
import { localAreaMetaPath, DEFAULT_LOCAL_AREA_ID } from './local-areas.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from './update-preview-paths.js';
import { parseBboxString, pointInsideBbox } from './update-preview-stats.js';

/**
 * Bukit pilot bbox and point-in-pilot classification (single shared helper).
 *
 * Edge convention: inclusive on all sides — a point on west, south, east, or north
 * boundary is inside the pilot. Points immediately outside use strict comparisons
 * (lon < minLon, lon > maxLon, lat < minLat, lat > maxLat) via pointInsideBbox.
 * Same convention as update-preview inside/outside counts and multi-drive matcher scope.
 */
export function loadBukitPilotBbox(areaId = DEFAULT_LOCAL_AREA_ID) {
  if (fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)) {
    const sel = JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8'));
    const fromSel = parseBboxString(sel.bbox);
    if (fromSel) return { ...fromSel, source: 'route_selection_bbox' };
  }
  const metaPath = localAreaMetaPath(areaId);
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const b = meta.bounds;
    if (b) {
      return {
        minLon: b.west,
        minLat: b.south,
        maxLon: b.east,
        maxLat: b.north,
        source: 'local_area_meta_bounds',
      };
    }
  }
  return parseBboxString('101.708993,3.141007,101.727007,3.158993');
}

export function bukitPilotBboxForCounts(areaId = DEFAULT_LOCAL_AREA_ID) {
  return loadBukitPilotBbox(areaId);
}

export function pointInsideBukitPilot(lon, lat, bbox = null) {
  const b = bbox || loadBukitPilotBbox();
  return pointInsideBbox(lon, lat, b);
}

export function pilotBboxRing(bbox) {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

export function partitionFeaturesByPilot(features, bbox = loadBukitPilotBbox()) {
  let inside = 0;
  let outside = 0;
  const insideFeatures = [];
  const outsideFeatures = [];
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const [lon, lat] = c;
    if (pointInsideBukitPilot(lon, lat, bbox)) {
      inside += 1;
      insideFeatures.push(f);
    } else {
      outside += 1;
      outsideFeatures.push(f);
    }
  }
  return { inside, outside, insideFeatures, outsideFeatures };
}
