import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localAreaGeojsonPath } from './local-areas.js';
import { previewGeojsonPath } from './update-preview-paths.js';
import { buildOsmSegmentIndex } from './osm-segment-index.js';
import { matchVehiclePoses, sortPoses } from './vehicle-osm-matcher.js';
import { attachObservationsToPoses, buildPoseLookup } from './comparison-lane-attach.js';
import {
  groupMatchedPosesIntoSections,
  proposalPassesDisplayGate,
} from './comparison-sections.js';
import {
  comparisonDir,
  comparisonSummaryPath,
  comparisonSensitivityPath,
  matchedPosesPath,
  rejectedMatchesPath,
  roadSectionsPath,
  COMPARISON_AREA_ID,
} from './comparison-paths.js';
import { pointInsideBukitPilot } from './bukit-pilot-bounds.js';

const RADIUS_CANDIDATES_M = [5, 10, 15, 25];

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadPreview(previewPath = null) {
  const p = previewPath || previewGeojsonPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function buildObservationOsmComparison({
  selectedRadiusM = null,
  previewPath = null,
  outputDir = null,
  roadsPath = null,
  /** When set, only inside-pilot vehicle poses are sent to the matcher (analysis scope). */
  pilotBbox = null,
} = {}) {
  const outDir = outputDir || comparisonDir();
  const roadsFile = roadsPath || localAreaGeojsonPath(COMPARISON_AREA_ID);
  if (!fs.existsSync(roadsFile)) {
    return { ok: false, error: 'osm_roads_missing' };
  }
  const preview = loadPreview(previewPath);
  if (!preview) {
    return { ok: false, error: 'preview_missing' };
  }

  const roads = JSON.parse(fs.readFileSync(roadsFile, 'utf8'));
  const osmHash = createHash('sha256').update(fs.readFileSync(roadsFile)).digest('hex');
  const index = buildOsmSegmentIndex(roads);

  const allRoutePoses = sortPoses(preview.features.filter((f) => f.properties?.layer === 'vehicle_pose'));
  const outsidePilotRejected = [];
  let poses = allRoutePoses;
  if (pilotBbox) {
    poses = [];
    for (let i = 0; i < allRoutePoses.length; i += 1) {
      const pose = allRoutePoses[i];
      const [lon, lat] = pose.geometry.coordinates;
      if (pointInsideBukitPilot(lon, lat, pilotBbox)) {
        poses.push(pose);
      } else {
        outsidePilotRejected.push({
          type: 'Feature',
          geometry: pose.geometry,
          properties: {
            pose_index: i,
            frame_id: pose.properties?.frame_id,
            log_mono_time: pose.properties?.log_mono_time,
            reason: 'outside_pilot',
            pilot_scope: 'excluded_before_matcher',
          },
        });
      }
    }
  }
  const laneEdge = preview.features.filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const gps = preview.features.filter((f) => f.properties?.layer === 'gps_point');

  const sensitivity = {};
  for (const r of RADIUS_CANDIDATES_M) {
    const { matches, rejected } = matchVehiclePoses(poses, index, { searchRadiusM: r });
    sensitivity[r] = {
      matched: matches.length,
      rejected: rejected.length,
      match_rate: poses.length ? matches.length / poses.length : 0,
    };
  }

  let radiusM = selectedRadiusM;
  if (radiusM == null) {
    radiusM = pickRadiusFromSensitivity(sensitivity);
  }

  const { matches, rejected: matcherRejected } = matchVehiclePoses(poses, index, { searchRadiusM: radiusM });
  const rejected = [...outsidePilotRejected, ...matcherRejected];
  const poseLookup = buildPoseLookup(matches);
  const segByPose = new Map(
    matches.map((m) => [m.properties.pose_index, null])
  );
  const { attached } = attachObservationsToPoses(laneEdge, poseLookup, segByPose);

  const sections = groupMatchedPosesIntoSections(matches, attached, gps);
  const proposals = sections.filter(proposalPassesDisplayGate);

  const classificationCounts = {};
  for (const s of sections) {
    const c = s.properties.classification;
    classificationCounts[c] = (classificationCounts[c] || 0) + 1;
  }

  const summary = {
    schema: 'pintaz.observation-osm-comparison',
    schema_version: 1,
    area_id: COMPARISON_AREA_ID,
    partial_page_scope: 'maps-read-page-1-truncated',
    selected_search_radius_m: radiusM,
    vehicle_pose_count: poses.length,
    total_route_vehicle_pose_count: allRoutePoses.length,
    pilot_vehicle_pose_count: pilotBbox ? poses.length : allRoutePoses.length,
    excluded_outside_pilot_pose_count: outsidePilotRejected.length,
    matcher_input_pose_count: poses.length,
    matched_pose_count: matches.length,
    rejected_pose_count: rejected.length,
    matcher_rejected_pose_count: matcherRejected.length,
    pilot_scoped_matcher: Boolean(pilotBbox),
    lane_edge_attached: attached.length,
    section_count: sections.length,
    proposal_display_count: proposals.length,
    classification_counts: classificationCounts,
    osm_baseline_hash_sha256: osmHash,
    ambiguity_rejections: rejected.filter((r) =>
      String(r.properties?.reason || '').startsWith('ambiguous')
    ).length,
    generated_at: new Date().toISOString(),
  };

  atomicWrite(matchedPosesPath(outDir), `${JSON.stringify({ type: 'FeatureCollection', features: matches })}\n`);
  atomicWrite(rejectedMatchesPath(outDir), `${JSON.stringify({ type: 'FeatureCollection', features: rejected })}\n`);
  atomicWrite(
    roadSectionsPath(outDir),
    `${JSON.stringify({ type: 'FeatureCollection', features: sections })}\n`
  );
  atomicWrite(comparisonSensitivityPath(outDir), `${JSON.stringify(sensitivity, null, 2)}\n`);
  atomicWrite(comparisonSummaryPath(outDir), `${JSON.stringify(summary, null, 2)}\n`);

  return {
    ok: true,
    summary,
    sensitivity,
    proposals: proposals.length,
    sections: sections.length,
  };
}

function pickRadiusFromSensitivity(sensitivity) {
  let best = 15;
  let bestScore = -1;
  for (const r of RADIUS_CANDIDATES_M) {
    const row = sensitivity[r];
    const score = row.match_rate - (row.rejected / (row.matched + row.rejected + 1)) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export function ensureComparisonBuilt({ outputDir = null } = {}) {
  const outDir = outputDir || comparisonDir();
  const summaryPath = comparisonSummaryPath(outDir);
  if (fs.existsSync(summaryPath)) {
    return { ok: true, skipped: true };
  }
  return buildObservationOsmComparison({ outputDir: outDir });
}
