import fs from 'node:fs';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { OBSERVATION_ROUTES } from '../local-route-explorer/config.js';
import { routeComparisonDir, derivedPreviewPath } from '../local-route-explorer/paths.js';
import { matchedPosesPath } from '../comparison-paths.js';
import { previewGeojsonPath } from '../update-preview-paths.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import { LIMITS, EXCLUDED_TRAINING_ROUTE_KEYS } from './constants.js';
import { buildFrameSignature } from './signature.js';

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function isLabelledOneWayRoadIndexEntry(entry) {
  if (!entry || entry.lane_count_source === 'lane_count_unknown') return false;
  const n = Number(entry.lane_count_total);
  if (n < LIMITS.minLaneCount || n > LIMITS.maxLaneCount) return false;
  return entry.direction_confidence === 'oneway_forward' || entry.direction_confidence === 'oneway_reverse';
}

function previewPointsByFrame(previewFeatures) {
  const byFrame = new Map();
  for (const f of previewFeatures || []) {
    const layer = f.properties?.layer;
    if (layer !== 'lane_point' && layer !== 'edge_point') continue;
    const fid = f.properties.frame_id;
    if (fid == null) continue;
    if (!byFrame.has(fid)) byFrame.set(fid, { lane: [], edge: [] });
    const bucket = layer === 'lane_point' ? 'lane' : 'edge';
    byFrame.get(fid)[bucket].push(f.properties);
  }
  return byFrame;
}

/**
 * @returns {{ ways: Map<string, object>, routesLoaded: string[] }}
 */
export function loadLabelledWayCorpus({ areaId = DEFAULT_LOCAL_AREA_ID } = {}) {
  const roadIndex = loadJson(roadIndexPath(areaId));
  const ways = new Map();
  const routesLoaded = [];

  for (const spec of OBSERVATION_ROUTES) {
    const routeKey = spec.route_key;
    const compDir = routeComparisonDir(routeKey);
    const matchedPath = matchedPosesPath(compDir);
    const previewPath = routeKey === 'active' ? previewGeojsonPath() : derivedPreviewPath(routeKey);
    const matched = loadJson(matchedPath);
    const preview = loadJson(previewPath);
    if (!matched?.features?.length || !preview?.features?.length) continue;
    routesLoaded.push(routeKey);

    const previewByFrame = previewPointsByFrame(preview.features);
    const posesByWay = new Map();
    for (const f of matched.features) {
      const wayId = normalizeOsmWayId(f.properties?.osm_id);
      if (!wayId) continue;
      if (!posesByWay.has(wayId)) posesByWay.set(wayId, []);
      posesByWay.get(wayId).push(f);
    }

    for (const [wayId, poses] of posesByWay) {
      const entry = roadIndex?.by_osm_id?.[wayId];
      const labelled = isLabelledOneWayRoadIndexEntry(entry);
      const label = labelled ? Number(entry.lane_count_total) : null;

      const poseLookup = buildPoseLookup(poses);
      const laneEdge = preview.features.filter(
        (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
      );
      attachObservationsToPoses(laneEdge, poseLookup, new Map());

      const frameIds = [...new Set(poses.map((p) => p.properties.frame_id))];
      const frames = [];
      for (const fid of frameIds) {
        const pose = poses.find((p) => p.properties.frame_id === fid)?.properties;
        const raw = previewByFrame.get(fid) || { lane: [], edge: [] };
        const signature = buildFrameSignature({
          pose,
          lanePoints: raw.lane,
          edgePoints: raw.edge,
        });
        frames.push({
          frame_id: fid,
          route_key: routeKey,
          osm_way_id: wayId,
          osm_lane_count: label,
          signature,
        });
      }

      if (!ways.has(wayId)) {
        ways.set(wayId, {
          osm_way_id: wayId,
          osm_lane_count: label,
          labelled_one_way: labelled,
          frames: [],
          route_keys: new Set(),
        });
      }
      const w = ways.get(wayId);
      w.frames.push(...frames);
      w.route_keys.add(routeKey);
      if (label != null) w.osm_lane_count = label;
    }
  }

  for (const w of ways.values()) {
    w.route_keys = [...w.route_keys];
    w.frame_count = w.frames.length;
  }
  return { ways, routesLoaded, roadIndex };
}

export function eligibleLabelledWays(waysMap) {
  return [...waysMap.values()].filter(
    (w) =>
      w.labelled_one_way &&
      w.osm_lane_count != null &&
      w.frames.length >= LIMITS.minFramesPerWay
  );
}

export function trainingFramesForModel(waysMap, { holdoutWayId = null, excludeRoutes = EXCLUDED_TRAINING_ROUTE_KEYS } = {}) {
  const frames = [];
  for (const w of waysMap.values()) {
    if (!w.labelled_one_way || w.osm_lane_count == null) continue;
    if (holdoutWayId && w.osm_way_id === holdoutWayId) continue;
    for (const fr of w.frames) {
      if (excludeRoutes.has(fr.route_key)) continue;
      frames.push(fr);
    }
  }
  return frames;
}
