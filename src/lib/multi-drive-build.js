import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT_DIR } from '../config.js';
import { loadActiveSourceManifest } from './active-source-manifest.js';
import { localAreaGeojsonPath, FALLBACK_LOCAL_AREA_ID } from './local-areas.js';
import { summaryPath } from './lane-baseline-paths.js';
import { mismatchSummaryPath } from './mismatch-paths.js';
import { comparisonSummaryPath } from './comparison-paths.js';
import { buildDerivedPreviewForDrive, writeDerivedManifest } from './multi-drive-derived-build.js';
import { runPerDrivePipeline } from './multi-drive-per-drive-run.js';
import { aggregateCrossDriveEvidence } from './multi-drive-aggregate.js';
import { redactPerDriveSection, splitAggregateLayers } from './multi-drive-redact.js';
import { ensureMultiDriveDecisionStore } from './multi-drive-decisions.js';
import {
  multiDriveBaseDir,
  multiDrivePrivateDir,
  multiDriveRedactedDir,
  perDriveSummaryRedactedPath,
  perDriveSectionsRedactedPath,
  aggregateSummaryRedactedPath,
  aggregateSectionsRedactedPath,
  supportedCandidatesRedactedPath,
  singleDriveSignalsRedactedPath,
  consistentSectionsRedactedPath,
  diagnosticsRedactedPath,
  sensitivityRedactedPath,
  multiDrivePrivateManifestPath,
  multiDriveDriveMappingPrivatePath,
  MULTI_DRIVE_AREA_ID,
} from './multi-drive-mismatch-paths.js';
import { listMultiDriveSpecs, MULTI_DRIVE_KEYS } from './multi-drive-mismatch-config.js';
import { DEFAULT_PARAMS } from './mismatch-classify.js';
import {
  buildActualDongleGroups,
  privateDongleManifestSlice,
  redactedDongleAuditForReports,
} from './multi-drive-dongle-audit.js';
import { countSingleDriveConsistentSections, assertPublicOutputSafe } from './multi-drive-redact.js';
import { runMultiDrivePilotDiagnosis, writeDiagnosisOutputs } from './multi-drive-pilot-diagnosis.js';

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeJson(filePath, obj) {
  atomicWrite(filePath, `${JSON.stringify(obj, null, 2)}\n`);
}

function buildDriveMapping() {
  const audit = buildActualDongleGroups();
  const routes = audit.drives.map((d) => ({
    probe_ref: d.drive_key,
    redacted_drive_ref: d.redacted_drive_ref,
    dongle_group: d.dongle_group,
  }));
  return {
    routes,
    groups: audit.groups,
    byRef: audit.byDriveKey,
    distinct_real_dongles: audit.distinct_real_dongles,
    privateDongle: privateDongleManifestSlice(audit),
  };
}

export function buildBukitMultiDriveMismatchV1({ baseDir = multiDriveBaseDir() } = {}) {
  fs.mkdirSync(multiDrivePrivateDir(baseDir), { recursive: true });
  fs.mkdirSync(multiDriveRedactedDir(baseDir), { recursive: true });

  const mapping = buildDriveMapping();
  writeJson(multiDriveDriveMappingPrivatePath(baseDir), {
    schema: 'pintaz.multi-drive.drive-mapping',
    version: 1,
    routes: mapping.routes,
    dongle_groups: mapping.groups,
    private_dongle_manifest: mapping.privateDongle,
  });

  const derivedRecords = [];
  for (const spec of listMultiDriveSpecs()) {
    derivedRecords.push(buildDerivedPreviewForDrive(spec.drive_key, baseDir));
  }
  writeDerivedManifest(derivedRecords, baseDir);

  const perDriveResults = [];
  const perDriveSummaries = [];
  const perDriveSectionFeatures = [];

  for (const spec of listMultiDriveSpecs()) {
    const dongle_group = mapping.byRef.get(spec.drive_key)?.dongle_group || null;
    const result = runPerDrivePipeline(spec.drive_key, baseDir, { dongle_group });
    perDriveResults.push(result);
    perDriveSummaries.push({
      redacted_drive_ref: result.redacted_drive_ref,
      dongle_group: result.dongle_group,
      derived_features: result.derived_feature_count,
      poses_matched: result.comparison?.matched_pose_count,
      poses_rejected: result.comparison?.rejected_pose_count,
      sections: result.mismatch_summary?.section_count,
      classification_counts: result.mismatch_summary?.classification_counts,
      actionable_candidates: result.mismatch_summary?.actionable_candidate_count,
    });
    for (const row of result.enriched_sections) {
      perDriveSectionFeatures.push(redactPerDriveSection(result, row));
    }
  }

  const { aggregateFeatures, stateCounts, evaluated_osm_ways } = aggregateCrossDriveEvidence(perDriveResults);
  const layers = splitAggregateLayers(aggregateFeatures);

  const inputHashes = {
    bukit_osm: sha256File(localAreaGeojsonPath(MULTI_DRIVE_AREA_ID)),
    kinrara_osm: fs.existsSync(localAreaGeojsonPath(FALLBACK_LOCAL_AREA_ID))
      ? sha256File(localAreaGeojsonPath(FALLBACK_LOCAL_AREA_ID))
      : null,
    lane_baseline_summary: sha256File(summaryPath(MULTI_DRIVE_AREA_ID)),
    active_preview: derivedRecords.find((d) => d.drive_key === 'drive-active')?.raw_sha256,
    drive_raws: derivedRecords.reduce((acc, d) => {
      acc[d.drive_key] = String(d.raw_sha256).slice(0, 12);
      return acc;
    }, {}),
    existing_mismatch_summary: fs.existsSync(mismatchSummaryPath())
      ? sha256File(mismatchSummaryPath())
      : null,
    existing_comparison_summary: fs.existsSync(comparisonSummaryPath())
      ? sha256File(comparisonSummaryPath())
      : null,
  };

  writeJson(perDriveSummaryRedactedPath(baseDir), {
    schema: 'pintaz.multi-drive.per-drive-summary',
    version: 1,
    area_id: MULTI_DRIVE_AREA_ID,
    drives: perDriveSummaries,
    thresholds: DEFAULT_PARAMS,
    generated_at: new Date().toISOString(),
  });

  writeJson(perDriveSectionsRedactedPath(baseDir), {
    type: 'FeatureCollection',
    features: perDriveSectionFeatures,
  });

  writeJson(aggregateSectionsRedactedPath(baseDir), {
    type: 'FeatureCollection',
    features: aggregateFeatures,
  });

  writeJson(supportedCandidatesRedactedPath(baseDir), {
    type: 'FeatureCollection',
    features: layers.supported,
  });
  writeJson(singleDriveSignalsRedactedPath(baseDir), {
    type: 'FeatureCollection',
    features: layers.single,
  });
  writeJson(consistentSectionsRedactedPath(baseDir), {
    type: 'FeatureCollection',
    features: layers.consistent,
  });
  writeJson(diagnosticsRedactedPath(baseDir), {
    type: 'FeatureCollection',
    features: layers.diagnostics,
  });

  const diagnosis = runMultiDrivePilotDiagnosis(baseDir);
  writeDiagnosisOutputs(diagnosis, baseDir);
  const dongleRedacted = redactedDongleAuditForReports(buildActualDongleGroups());
  const topFailures = {};
  for (const d of diagnosis.drives) {
    for (const { reason, count } of d.top_failure_reasons || []) {
      topFailures[reason] = (topFailures[reason] || 0) + count;
    }
  }

  const aggregateSummary = {
    schema: 'pintaz.multi-drive.aggregate-summary',
    version: 1,
    area_id: MULTI_DRIVE_AREA_ID,
    drives_analysed: MULTI_DRIVE_KEYS.length,
    distinct_dongle_groups: mapping.distinct_real_dongles,
    distinct_redacted_dongle_groups: mapping.groups.length,
    osm_roads_evaluated: evaluated_osm_ways,
    aggregate_state_counts: stateCounts,
    multi_drive_candidates: layers.supported.length,
    single_drive_signals: layers.single.length,
    single_drive_consistent_sections: countSingleDriveConsistentSections(aggregateFeatures),
    consistent_across_drives: layers.consistent.length,
    conflicts: stateCounts.conflicting_drive_evidence,
    pilot_scope: {
      matcher_scope: 'inside_pilot_only',
      bbox_source: diagnosis.drives[0]?.pilot_bbox_source,
      per_drive: diagnosis.drives.map((d) => ({
        redacted_drive_ref: d.redacted_drive_ref,
        total_route_poses: d.vehicle_pose_pipeline.total_route,
        pilot_poses: d.vehicle_pose_pipeline.inside_pilot,
        excluded_outside_pilot: d.vehicle_pose_pipeline.outside_pilot,
        matched_pilot_poses: d.vehicle_pose_pipeline.matched,
      })),
    },
    support_eligible_totals: diagnosis.combined,
    ui_diagnostics: {
      top_failure_reasons: Object.entries(topFailures)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    },
    dongle_independence: dongleRedacted,
    input_hash_prefixes: Object.fromEntries(
      Object.entries(inputHashes).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 12) : v])
    ),
    generated_at: new Date().toISOString(),
  };
  assertPublicOutputSafe(aggregateSummary);
  writeJson(aggregateSummaryRedactedPath(baseDir), aggregateSummary);

  writeJson(sensitivityRedactedPath(baseDir), {
    schema: 'pintaz.multi-drive.sensitivity',
    version: 1,
    note: 'Per-drive mismatch V1.1 sensitivity unchanged; aggregation requires independent stability.',
    per_drive_thresholds: DEFAULT_PARAMS,
  });

  writeJson(multiDrivePrivateManifestPath(baseDir), {
    schema: 'pintaz.multi-drive.private-manifest',
    version: 1,
    repo_root: ROOT_DIR,
    drives: derivedRecords,
    input_hashes: inputHashes,
    generated_at: new Date().toISOString(),
  });

  ensureMultiDriveDecisionStore(baseDir);

  return {
    ok: true,
    perDriveSummaries,
    stateCounts,
    candidates: layers.supported.length,
    inputHashes,
  };
}
