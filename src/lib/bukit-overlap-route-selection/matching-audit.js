import fs from 'node:fs';
import path from 'node:path';
import { buildObservationOsmComparison } from '../comparison-build.js';
import { matchedPosesPath, rejectedMatchesPath, comparisonSummaryPath } from '../comparison-paths.js';
import { loadBukitPilotBbox } from '../bukit-pilot-bounds.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { projectAlongCentreline } from '../mismatch-projection.js';
import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import { ensureDerivedPreview } from './derive-preview.js';

function travelSign(headingDiff) {
  const h = Number(headingDiff);
  if (!Number.isFinite(h)) return 0;
  return h <= 90 ? 1 : -1;
}

export function runMatcherForRoute(routeKey, probeRef, dataDir) {
  const { previewPath } = ensureDerivedPreview(routeKey, probeRef, dataDir);
  const compDir = path.join(dataDir, 'matching', routeKey, 'comparison-v1');
  fs.mkdirSync(compDir, { recursive: true });
  const pilotBbox = loadBukitPilotBbox(DEFAULT_LOCAL_AREA_ID);
  const result = buildObservationOsmComparison({
    previewPath,
    outputDir: compDir,
    roadsPath: localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID),
    pilotBbox,
  });
  const summary = result.ok ? JSON.parse(fs.readFileSync(comparisonSummaryPath(compDir), 'utf8')) : null;
  const matches = result.ok
    ? JSON.parse(fs.readFileSync(matchedPosesPath(compDir), 'utf8')).features || []
    : [];
  const rejected = result.ok
    ? JSON.parse(fs.readFileSync(rejectedMatchesPath(compDir), 'utf8')).features || []
    : [];
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
  const laneEdge = preview.features.filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const { attached } = attachObservationsToPoses(laneEdge, buildPoseLookup(matches), null);

  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const roadById = new Map(roads.features.map((f) => [String(f.properties?.osm_id), f]));

  const byOsm = new Map();
  const rejectReasons = {};
  for (const r of rejected) {
    const reason = r.properties?.reason || 'unknown';
    rejectReasons[reason] = (rejectReasons[reason] || 0) + 1;
  }

  for (const m of matches) {
    const osmId = String(m.properties.osm_id);
    const road = roadById.get(osmId);
    const coords = road?.geometry?.coordinates || [];
    const [lon, lat] = m.geometry.coordinates;
    const proj = coords.length >= 2 ? projectAlongCentreline(lon, lat, coords) : null;
    const frameId = m.properties.frame_id;
    const lane = attached.filter((a) => a.properties.pose_index === m.properties.pose_index && a.properties.layer === 'lane_point').length;
    const edge = attached.filter((a) => a.properties.pose_index === m.properties.pose_index && a.properties.layer === 'edge_point').length;
    const rec = {
      frame_id: frameId,
      chain_s: proj?.chainS ?? null,
      lateral_m: proj?.lateralM ?? null,
      direction_sign: travelSign(m.properties.heading_diff_deg),
      lane_obs: lane,
      edge_obs: edge,
    };
    if (!byOsm.has(osmId)) byOsm.set(osmId, []);
    byOsm.get(osmId).push(rec);
  }

  const osmSummaries = [];
  for (const [osmId, recs] of byOsm) {
    const sVals = recs.map((r) => r.chain_s).filter((v) => v != null);
    const bins = new Set(sVals.map((s) => Math.floor(s / 5)));
    osmSummaries.push({
      osm_id: osmId,
      matched_frames: new Set(recs.map((r) => r.frame_id)).size,
      matched_poses: recs.length,
      min_s: sVals.length ? Math.min(...sVals) : null,
      max_s: sVals.length ? Math.max(...sVals) : null,
      direction_signs: [...new Set(recs.map((r) => r.direction_sign).filter(Boolean))],
      lane_obs: recs.reduce((s, r) => s + r.lane_obs, 0),
      edge_obs: recs.reduce((s, r) => s + r.edge_obs, 0),
      bin_count_5m: bins.size,
    });
  }

  return {
    route_key: routeKey,
    ok: result.ok,
    summary,
    rejection_reasons: rejectReasons,
    distinct_matched_osm_ways: byOsm.size,
    osm_summaries: osmSummaries,
    osm_records: Object.fromEntries(byOsm),
  };
}
