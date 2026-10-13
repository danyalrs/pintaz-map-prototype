import fs from 'node:fs';
import path from 'node:path';
import { groupSectionsContiguous } from '../mismatch-section-group.js';
import { diagnoseSectionBreaks } from '../mismatch-section-group-diagnose.js';
import { buildOsmServerMismatchV1 } from '../mismatch-build.js';
import { aggregateCrossDriveEvidence } from '../multi-drive-aggregate.js';
import { MULTI_DRIVE_AREA_ID } from '../multi-drive-mismatch-paths.js';
import { loadBukitPilotBbox } from '../bukit-pilot-bounds.js';
import { matchedPosesPath } from '../comparison-paths.js';
import { mismatchSummaryPath } from '../mismatch-paths.js';
import { haversineMetres } from '../geo-square.js';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function sectionDistribution(sections) {
  const frames = sections.map((s) => s.length).sort((a, b) => a - b);
  const lengths = sections
    .map((sec) => {
      let sum = 0;
      for (let i = 1; i < sec.length; i++) {
        sum += haversineMetres(
          sec[i - 1].geometry.coordinates[0],
          sec[i - 1].geometry.coordinates[1],
          sec[i].geometry.coordinates[0],
          sec[i].geometry.coordinates[1]
        );
      }
      return sum;
    })
    .sort((a, b) => a - b);
  return {
    section_count: sections.length,
    median_frames: percentile(frames, 50),
    p90_frames: percentile(frames, 90),
    median_length_m: percentile(lengths, 50),
    p90_length_m: percentile(lengths, 90),
  };
}

export function augmentPosesWithLogicalRoad(posesGeojson, osmToLogical) {
  const features = (posesGeojson.features || []).map((f) => {
    const osmId = String(f.properties.osm_id);
    const logical = osmToLogical.get(osmId);
    const props = { ...f.properties };
    if (logical) {
      props.logical_road_id = logical.logical_road_id;
      props.logical_member_osm_ids = logical.member_osm_ids;
    } else {
      props.logical_road_id = osmId;
      props.logical_member_osm_ids = [osmId];
    }
    return { ...f, properties: props };
  });
  return { type: 'FeatureCollection', features };
}

export function compareGroupingBeforeAfter(posesGeojson, osmToLogical) {
  const beforeSections = groupSectionsContiguous(posesGeojson.features);
  const beforeBreaks = diagnoseSectionBreaks(posesGeojson.features);
  const augmented = augmentPosesWithLogicalRoad(posesGeojson, osmToLogical);
  const afterSections = groupSectionsContiguous(augmented.features, {
    osmGroupingKey: (p) => String(p.logical_road_id ?? p.osm_id),
  });
  const afterBreaks = diagnoseSectionBreaks(
    augmented.features.map((f) => ({
      ...f,
      properties: { ...f.properties, osm_id: f.properties.logical_road_id ?? f.properties.osm_id },
    }))
  );
  return {
    before: {
      matched_poses: posesGeojson.features.length,
      section_count: beforeSections.length,
      osm_way_change_splits: (beforeBreaks.break_events || []).filter((b) => b.reason === 'osm_way_change').length,
      distribution: sectionDistribution(beforeSections),
    },
    after: {
      matched_poses: augmented.features.length,
      section_count: afterSections.length,
      osm_way_change_splits: (afterBreaks.break_events || []).filter((b) => b.reason === 'osm_way_change').length,
      distribution: sectionDistribution(afterSections),
    },
    augmented_poses: augmented,
  };
}

export function runSimulatedMismatchForDrive({
  driveKey,
  sourceComparisonDir,
  previewPath,
  simRootDir,
  osmToLogical,
}) {
  const stagingComp = path.join(simRootDir, 'comparison', driveKey);
  const stagingMismatch = path.join(simRootDir, 'mismatch', driveKey);
  fs.mkdirSync(stagingComp, { recursive: true });
  fs.mkdirSync(stagingMismatch, { recursive: true });

  const poses = JSON.parse(fs.readFileSync(matchedPosesPath(sourceComparisonDir), 'utf8'));
  const augmented = augmentPosesWithLogicalRoad(poses, osmToLogical);
  fs.writeFileSync(matchedPosesPath(stagingComp), `${JSON.stringify(augmented)}\n`, 'utf8');

  const pilotBbox = loadBukitPilotBbox(MULTI_DRIVE_AREA_ID);
  const result = buildOsmServerMismatchV1({
    areaId: MULTI_DRIVE_AREA_ID,
    previewPath,
    comparisonOutputDir: stagingComp,
    mismatchOutputDir: stagingMismatch,
    coveragePreviewPath: previewPath,
    pilotCoverageBbox: pilotBbox,
    osmGroupingKey: (p) => String(p.logical_road_id ?? p.osm_id),
  });
  const summary = result.ok && fs.existsSync(mismatchSummaryPath(stagingMismatch))
    ? JSON.parse(fs.readFileSync(mismatchSummaryPath(stagingMismatch), 'utf8'))
    : null;
  return { ok: result.ok, summary, stagingMismatch };
}

export function summarizeMismatchSummary(summary) {
  if (!summary) return null;
  const tiers = summary.support_tier_counts || summary.eligibility_tier_counts || {};
  return {
    section_count: summary.section_count,
    support_eligible_centreline: summary.support_eligible_centreline ?? tiers.support_eligible_centreline ?? 0,
    support_eligible_lane_edge: summary.support_eligible_lane_edge ?? tiers.support_eligible_lane_edge ?? 0,
    single_drive_consistent_sections: summary.single_drive_consistent_sections ?? 0,
    classification_counts: summary.classification_counts || {},
    gate_failure_counts: summary.gate_failure_counts || {},
  };
}

export function aggregateSimulatedPerDrive(perDriveResults) {
  const agg = aggregateCrossDriveEvidence(perDriveResults);
  return {
    multi_drive_actionable_candidates: agg.multi_drive_candidates?.length ?? 0,
    aggregate_state_counts: agg.state_counts,
    insufficient_combined_evidence: agg.state_counts?.insufficient_combined_evidence ?? 0,
  };
}
