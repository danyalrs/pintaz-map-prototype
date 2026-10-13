import fs from 'node:fs';
import path from 'node:path';
import { buildObservationOsmComparison } from './comparison-build.js';
import { buildOsmServerMismatchV1 } from './mismatch-build.js';
import { groupSectionsContiguous } from './mismatch-section-group.js';
import { observedAlongSpanM } from './mismatch-local-geometry.js';
import { localAreaGeojsonPath } from './local-areas.js';
import { comparisonSummaryPath, matchedPosesPath, rejectedMatchesPath } from './comparison-paths.js';
import {
  mismatchSummaryPath,
  sectionResultsPath,
  eligibilityAuditPath,
  mismatchSensitivityPath,
} from './mismatch-paths.js';
import {
  driveDerivedPreviewPath,
  driveComparisonDir,
  driveMismatchDir,
} from './multi-drive-mismatch-paths.js';
import { driveSpec } from './multi-drive-mismatch-config.js';
import { MULTI_DRIVE_AREA_ID } from './multi-drive-mismatch-paths.js';
import { loadBukitPilotBbox } from './bukit-pilot-bounds.js';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function enrichSectionsWithAlongRange(driveKey, baseDir) {
  const compDir = driveComparisonDir(driveKey, baseDir);
  const mismatchDir = driveMismatchDir(driveKey, baseDir);
  const posesPath = matchedPosesPath(compDir);
  const sectionsPath = sectionResultsPath(mismatchDir);
  if (!fs.existsSync(posesPath) || !fs.existsSync(sectionsPath)) return [];
  const roads = readJson(localAreaGeojsonPath(MULTI_DRIVE_AREA_ID));
  const roadById = new Map(roads.features.map((f) => [String(f.properties?.osm_id), f]));
  const poses = readJson(posesPath).features || [];
  const sections = (readJson(sectionsPath).features || []).sort(
    (a, b) => Number(a.properties?.section_index) - Number(b.properties?.section_index)
  );
  const groups = groupSectionsContiguous(poses);
  const enriched = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const group = groups[i];
    if (!group?.length) {
      enriched.push({ section: sec, along_start_m: null, along_end_m: null });
      continue;
    }
    const osmId = String(group[0].properties.osm_id);
    const coords = roadById.get(osmId)?.geometry?.coordinates || [];
    const along = coords.length >= 2 ? observedAlongSpanM(group, coords) : null;
    enriched.push({
      section: sec,
      along_start_m: along?.minS ?? null,
      along_end_m: along?.maxS ?? null,
    });
  }
  return enriched;
}

export function runPerDrivePipeline(driveKey, baseDir, { dongle_group } = {}) {
  const spec = driveSpec(driveKey);
  const previewPath = driveDerivedPreviewPath(driveKey, baseDir);
  const compDir = driveComparisonDir(driveKey, baseDir);
  const mismatchOut = driveMismatchDir(driveKey, baseDir);
  fs.mkdirSync(compDir, { recursive: true });
  fs.mkdirSync(mismatchOut, { recursive: true });

  const pilotBbox = loadBukitPilotBbox(MULTI_DRIVE_AREA_ID);
  const cmp = buildObservationOsmComparison({
    previewPath,
    outputDir: compDir,
    pilotBbox,
  });
  if (!cmp.ok) {
    throw new Error(`comparison_failed:${driveKey}:${cmp.error}`);
  }

  const mm = buildOsmServerMismatchV1({
    areaId: MULTI_DRIVE_AREA_ID,
    previewPath,
    comparisonOutputDir: compDir,
    mismatchOutputDir: mismatchOut,
    coveragePreviewPath: previewPath,
    pilotCoverageBbox: pilotBbox,
  });
  if (!mm.ok) {
    throw new Error(`mismatch_failed:${driveKey}:${mm.error}`);
  }

  const enriched = enrichSectionsWithAlongRange(driveKey, baseDir);
  const cmpSummary = cmp.summary ||
    (fs.existsSync(comparisonSummaryPath(compDir)) ? readJson(comparisonSummaryPath(compDir)) : null);
  const mmSummary = mm.summary;
  const poses = fs.existsSync(matchedPosesPath(compDir))
    ? readJson(matchedPosesPath(compDir)).features.length
    : 0;
  const rejected = fs.existsSync(rejectedMatchesPath(compDir))
    ? readJson(rejectedMatchesPath(compDir)).features.length
    : 0;

  const classificationCounts = mmSummary?.classification_counts || {};
  const audit = fs.existsSync(eligibilityAuditPath(mismatchOut))
    ? readJson(eligibilityAuditPath(mismatchOut))
    : null;

  const sectionsPrivate = enriched.map(({ section, along_start_m, along_end_m }, idx) => ({
    section_index: idx,
    candidate_id: section.properties?.candidate_id,
    osm_id: section.properties?.osm_id,
    classification: section.properties?.classification,
    along_start_m,
    along_end_m,
    support_eligible_centreline: section.properties?.support_eligible_centreline,
    support_eligible_lane_edge: section.properties?.support_eligible_lane_edge,
    sensitivity_stable: section.properties?.sensitivity_stable,
    median_common_centre_shift_m: section.properties?.median_common_centre_shift_m,
    frames_with_both_edges: section.properties?.frames_with_both_edges,
    gate_failures: section.properties?.gate_failures,
  }));

  const privateSummaryPath = path.join(baseDir, 'private', driveKey, 'per-drive-summary.private.json');
  fs.mkdirSync(path.dirname(privateSummaryPath), { recursive: true });
  fs.writeFileSync(
    privateSummaryPath,
    `${JSON.stringify(
      {
        drive_key: driveKey,
        redacted_drive_ref: spec.redacted_drive_ref,
        dongle_group,
        comparison: cmpSummary,
        mismatch: {
          section_count: mmSummary?.section_count,
          classification_counts: classificationCounts,
          actionable_candidate_count: mmSummary?.actionable_candidate_count,
          selected_parameters: mmSummary?.selected_parameters,
        },
        poses_matched: poses,
        poses_rejected: rejected,
        sections_private: sectionsPrivate,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    drive_key: driveKey,
    redacted_drive_ref: spec.redacted_drive_ref,
    dongle_group,
    derived_feature_count: readJson(previewPath).features?.length ?? 0,
    comparison: cmpSummary,
    mismatch_summary: mmSummary,
    enriched_sections: enriched,
    sensitivity_path: mismatchSensitivityPath(mismatchOut),
  };
}
