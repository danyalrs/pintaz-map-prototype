import fs from 'node:fs';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { matchedPosesPath, rejectedMatchesPath } from '../comparison-paths.js';
import { sectionResultsPath } from '../mismatch-paths.js';
import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import { buildActualDongleGroups } from '../multi-drive-dongle-audit.js';
import { MULTI_DRIVE_KEYS, driveSpec } from '../multi-drive-mismatch-config.js';
import {
  multiDriveBaseDir,
  driveComparisonDir,
  driveDerivedPreviewPath,
  driveMismatchDir,
} from '../multi-drive-mismatch-paths.js';
import { loadBukitPilotBbox, pointInsideBukitPilot } from '../bukit-pilot-bounds.js';
import { projectPoseOnWay, travelDirectionSign } from './along-way-projection.js';
import { haversineMetres } from '../geo-square.js';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadDriveEvidenceBundle(baseDir = multiDriveBaseDir()) {
  const pilotBbox = loadBukitPilotBbox(DEFAULT_LOCAL_AREA_ID);
  const roads = readJson(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID));
  const roadById = new Map(roads.features.map((f) => [String(f.properties?.osm_id), f]));

  const dongleAudit = buildActualDongleGroups();
  const drives = [];

  for (const key of MULTI_DRIVE_KEYS) {
    const spec = driveSpec(key);
    const meta = dongleAudit.byDriveKey.get(key);
    const compDir = driveComparisonDir(key, baseDir);
    const posesPath = matchedPosesPath(compDir);
    const previewPath = driveDerivedPreviewPath(key, baseDir);
    const posesGeo = readJson(posesPath);
    const preview = readJson(previewPath);

    const parallelFrames = new Set();
    if (fs.existsSync(rejectedMatchesPath(compDir))) {
      for (const f of readJson(rejectedMatchesPath(compDir)).features || []) {
        if (f.properties?.reason === 'ambiguous_parallel_road' && f.properties.frame_id != null) {
          parallelFrames.add(Number(f.properties.frame_id));
        }
      }
    }

    const laneEdge = preview.features.filter(
      (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
    );
    const poseLookup = buildPoseLookup(posesGeo.features);
    const { attached } = attachObservationsToPoses(laneEdge, poseLookup, null);
    const obsByPose = new Map();
    for (const a of attached) {
      const pi = a.properties.pose_index;
      if (!obsByPose.has(pi)) obsByPose.set(pi, []);
      obsByPose.get(pi).push(a);
    }

    const sectionsByOsm = new Map();
    const mismatchDir = driveMismatchDir(key, baseDir);
    if (fs.existsSync(sectionResultsPath(mismatchDir))) {
      for (const f of readJson(sectionResultsPath(mismatchDir)).features || []) {
        const oid = String(f.properties?.osm_id);
        if (!sectionsByOsm.has(oid)) sectionsByOsm.set(oid, []);
        sectionsByOsm.get(oid).push(f.properties);
      }
    }

    const records = [];
    let prevS = null;
    const sorted = [...posesGeo.features].sort((a, b) => a.properties.pose_index - b.properties.pose_index);
    for (const m of sorted) {
      const p = m.properties;
      const [lon, lat] = m.geometry.coordinates;
      if (!pointInsideBukitPilot(lon, lat, pilotBbox)) continue;
      const osmId = String(p.osm_id);
      const road = roadById.get(osmId);
      const coords = road?.geometry?.coordinates || [];
      const proj = projectPoseOnWay(lon, lat, coords, prevS);
      if (proj.ok) prevS = proj.chain_s;
      const dirSign = travelDirectionSign(p.heading_diff_deg);
      const obs = obsByPose.get(p.pose_index) || [];
      records.push({
        drive_key: key,
        redacted_drive_ref: spec.redacted_drive_ref,
        dongle_group: meta?.dongle_group,
        osm_id: osmId,
        pose_index: p.pose_index,
        frame_id: p.frame_id != null ? Number(p.frame_id) : null,
        projection: proj,
        direction_sign: dirSign,
        heading_diff_deg: Number(p.heading_diff_deg),
        lateral_m: proj.ok ? proj.lateral_m : null,
        chain_s: proj.ok ? proj.chain_s : null,
        lane_obs: obs.filter((o) => o.properties?.layer === 'lane_point').length,
        edge_obs: obs.filter((o) => o.properties?.layer === 'edge_point').length,
        parallel_ambiguity: parallelFrames.has(Number(p.frame_id)),
        bridge: p.bridge,
        tunnel: p.tunnel,
        layer: p.layer,
      });
    }

    drives.push({
      drive_key: key,
      redacted_drive_ref: spec.redacted_drive_ref,
      dongle_group: meta?.dongle_group,
      matched_pilot_records: records,
      sections_by_osm: Object.fromEntries(sectionsByOsm),
    });
  }

  return {
    pilot_bbox_source: pilotBbox.source,
    road_by_id: roadById,
    drives,
    dongle_groups: dongleAudit.groups,
    distinct_dongle_groups: dongleAudit.distinct_real_dongles,
  };
}

export function chainLengthFromRecords(records) {
  let sum = 0;
  const sorted = [...records].filter((r) => r.chain_s != null).sort((a, b) => a.pose_index - b.pose_index);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    sum += Math.abs(b.chain_s - a.chain_s);
  }
  return sum;
}

export function uniqueFrames(records) {
  const s = new Set();
  for (const r of records) {
    if (r.frame_id != null) s.add(`${r.drive_key}:${r.frame_id}`);
  }
  return s.size;
}
