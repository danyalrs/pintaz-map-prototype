#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { DIAG_VERSION } from '../src/lib/shared-way-support-shortfall/config.js';
import { verifyPhase0, EXPECTED_HEAD } from '../src/lib/shared-way-support-shortfall/phase0-protected.js';
import { auditOsmWay } from '../src/lib/shared-way-support-shortfall/osm-way-audit.js';
import { auditRawAvailability } from '../src/lib/shared-way-support-shortfall/pose-availability.js';
import {
  buildMatchingForRoutes,
  spansOnTargetWay,
  enrichSpan,
  gapsBetweenSpans,
  overlapSummary,
} from '../src/lib/shared-way-support-shortfall/span-trace.js';
import { classifyAllGaps } from '../src/lib/shared-way-support-shortfall/gap-classification.js';
import { buildPipelineStageLoss } from '../src/lib/shared-way-support-shortfall/pipeline-loss.js';
import { runCounterfactuals } from '../src/lib/shared-way-support-shortfall/counterfactuals.js';
import { assessProcessingDefect, mapVerdict } from '../src/lib/shared-way-support-shortfall/defect-assessment.js';
import { evaluateNeighbouringRoadControls } from '../src/lib/shared-way-support-shortfall/neighbour-controls.js';
import { PRODUCTION_SUPPORT } from '../src/lib/shared-way-support-shortfall/config.js';

const DATA_DIR = path.join(ROOT_DIR, 'data', 'maps-read', DIAG_VERSION);
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'shared_way_39914067_support_shortfall_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_shared_way_39914067_support_shortfall_v1');

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}
function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function redactAvailability(av) {
  return {
    route_key: av.route_key,
    redacted_route_ref: av.redacted_route_ref,
    near_way_pose_count: av.near_way_pose_count,
    inside_pilot_near_way: av.inside_pilot_near_way,
    buckets_summary: av.buckets_summary,
    poses: av.poses.map((p) => ({
      redacted_route_ref: p.redacted_route_ref,
      frame_id: p.frame_id,
      log_mono_time: p.log_mono_time,
      inside_pilot: p.inside_pilot,
      distance_to_target_way_m: p.distance_to_target_way_m,
      matcher_decision: p.matcher_decision,
      matcher_rejection_reason: p.matcher_rejection_reason,
      matched_osm_id: p.matched_osm_id,
      projected_chain_s: p.projected_chain_s,
      centreline_residual_m: p.centreline_residual_m,
      heading_diff_deg: p.heading_diff_deg,
      travel_direction_sign: p.travel_direction_sign,
      lane_observations: p.lane_observations,
      edge_observations: p.edge_observations,
    })),
  };
}

function main() {
  const phase0 = verifyPhase0();
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), { expected_head: EXPECTED_HEAD, phase0 });
  if (!phase0.ok) {
    console.error('PHASE 0 FAILED', phase0.errors);
    process.exit(2);
  }

  const osmAudit = auditOsmWay();
  writeJson(path.join(DATA_DIR, 'osm_way_audit.json'), osmAudit);
  writeJson(path.join(REPORT_DIR, 'osm_way_audit.json'), {
    ...osmAudit,
    geometry: { ...osmAudit.geometry, coordinates: undefined },
  });

  const wayCoords = osmAudit.geometry.coordinates;
  const availability = [];
  for (const spec of [
    { route_key: 'active', probe_ref: null },
    { route_key: 'drive-005', probe_ref: 'drive-005' },
  ]) {
    availability.push(auditRawAvailability(spec.route_key, spec.probe_ref, DATA_DIR, wayCoords));
  }
  const availabilityRedacted = availability.map(redactAvailability);
  writeJson(path.join(DATA_DIR, 'raw_availability.redacted.json'), { routes: availabilityRedacted });
  writeJson(path.join(REPORT_DIR, 'raw_availability.redacted.json'), { routes: availabilityRedacted });

  const { active, d005 } = buildMatchingForRoutes(DATA_DIR);
  const metaActive = { redacted_route_ref: 'active', dongle_group: 'dongle-group-active' };
  const metaD005 = { redacted_route_ref: 'probe-005', dongle_group: 'dongle-group-F' };
  const rawSpans = spansOnTargetWay(active, d005, metaActive, metaD005);
  const spans = rawSpans.map(enrichSpan);
  const gaps = gapsBetweenSpans(spans);
  const gapClasses = classifyAllGaps(gaps, availability, spans);
  const summary = overlapSummary(spans);

  writeJson(path.join(DATA_DIR, 'spans.redacted.json'), { spans, summary, do_not_sum_disjoint_spans: true });
  writeJson(path.join(REPORT_DIR, 'spans.redacted.json'), { spans, summary, do_not_sum_disjoint_spans: true });
  writeJson(path.join(DATA_DIR, 'gap_classification.redacted.json'), { gaps: gapClasses });
  writeJson(path.join(REPORT_DIR, 'gap_classification.redacted.json'), { gaps: gapClasses });

  const pipeline = buildPipelineStageLoss(availability, spans, osmAudit.geometry.length_m);
  writeJson(path.join(DATA_DIR, 'pipeline_stage_loss.json'), pipeline);
  writeJson(path.join(REPORT_DIR, 'pipeline_stage_loss.json'), pipeline);

  const counterfactuals = runCounterfactuals(active, d005, metaActive, metaD005);
  writeJson(path.join(DATA_DIR, 'counterfactuals.json'), counterfactuals);
  writeJson(path.join(REPORT_DIR, 'counterfactuals.json'), counterfactuals);

  const defect = assessProcessingDefect(gapClasses, availability, spans);
  const verdict = mapVerdict(defect, gapClasses);
  writeJson(path.join(DATA_DIR, 'defect_assessment.json'), defect);
  writeJson(path.join(REPORT_DIR, 'defect_assessment.json'), defect);

  const neighbour = evaluateNeighbouringRoadControls(spans, osmAudit);
  const safety = {
    neighbouring_road_controls: neighbour,
    zero_unsafe_merge_hypothesis: neighbour.all_pass,
    production_thresholds_unchanged: true,
  };
  writeJson(path.join(DATA_DIR, 'safety_controls.json'), safety);
  writeJson(path.join(REPORT_DIR, 'safety_controls.json'), safety);

  const shortfallClass =
    verdict.code === 'A'
      ? 'A'
      : gapClasses.some((g) => g.ownership === 'parameter_boundary_effect') &&
          gapClasses.some((g) => g.reasons.includes('per_dongle_frame_shortfall'))
        ? 'D'
        : verdict.code === 'B'
          ? 'C'
          : 'E';

  const testResults = {
    defect_verdict: verdict.code,
    defect_verdict_text: verdict.text,
    shortfall_classification: shortfallClass,
    shortfall_labels: {
      A: 'processing_or_grouping_defect',
      B: 'conservative_gate_correct',
      C: 'genuine_missing_disjoint_observations',
      D: 'mixed_causes',
      E: 'unresolved',
    },
    osm_way_length_m: osmAudit.geometry.length_m,
    raw_near_way_poses: {
      active: availability[0].near_way_pose_count,
      drive_005: availability[1].near_way_pose_count,
    },
    accepted_matches: {
      active: availability[0].buckets_summary.matched_target,
      drive_005: availability[1].buckets_summary.matched_target,
    },
    span_count: summary.span_count,
    total_separated_overlap_m: summary.total_separated_overlap_m,
    longest_continuous_overlap_m: summary.longest_continuous_overlap_m,
    gap_count: gapClasses.length,
    first_stage_below_25m: pipeline.first_stage_below_25m,
    counterfactual_max_safe_continuous_m: counterfactuals.counterfactual_max_safe_continuous_overlap_m,
    processing_defect_proven: defect.proven,
    production_support_with_unchanged_gates: spans.some(
      (s) => (s.production_support_gates?.gate_failures || []).length === 0
    ),
  };
  writeJson(path.join(DATA_DIR, 'test_results.json'), testResults);
  writeJson(path.join(REPORT_DIR, 'test_results.json'), testResults);

  writeJson(path.join(DATA_DIR, 'manifest.json'), {
    schema: 'pintaz.shared-way.support-shortfall.v1',
    osm_id: '39914067',
    generated_at: new Date().toISOString(),
  });
  writeJson(path.join(REPORT_DIR, 'manifest.json'), {
    schema: 'pintaz.shared-way.support-shortfall.v1',
    osm_id: '39914067',
    generated_at: new Date().toISOString(),
  });

  writeText(path.join(REPORT_DIR, 'commands.txt'), `node scripts/run-shared-way-39914067-support-shortfall-v1.js\nnpm test\nnpm run validate:data\n`);

  const md = (title, body) => writeText(path.join(REPORT_DIR, title), `${body}\n`);
  md(
    'FINAL_REPORT.md',
    `# Shared-way support shortfall V1 — OSM way 39914067\n\n## Defect verdict: ${verdict.code} — ${verdict.text}\n## Shortfall class: ${shortfallClass} (${testResults.shortfall_labels[shortfallClass] || 'see test_results'})\n\nSpans: ${summary.span_count}; separated total ${summary.total_separated_overlap_m.toFixed(1)} m; longest continuous ${summary.longest_continuous_overlap_m.toFixed(1)} m (< ${PRODUCTION_SUPPORT.minContinuousLengthM} m gate).\nActive matched on way: ${testResults.accepted_matches.active}; drive-005: ${testResults.accepted_matches.drive_005}.\nFirst below 25 m: ${pipeline.first_stage_below_25m}.\nNo production changes.\n`
  );
  md('OSM_WAY_AUDIT.md', `Length ${osmAudit.geometry.length_m.toFixed(1)} m; highway ${osmAudit.tags.highway}; oneway ${osmAudit.tags.oneway}.`);
  md('RAW_OBSERVATION_AVAILABILITY.md', JSON.stringify(availabilityRedacted.map((r) => r.buckets_summary), null, 2));
  md('SPAN_RECONSTRUCTION.md', JSON.stringify(summary, null, 2));
  md('GAP_CLASSIFICATION.md', JSON.stringify(gapClasses, null, 2));
  md('PIPELINE_STAGE_LOSS.md', JSON.stringify(pipeline, null, 2));
  md('COUNTERFACTUALS.md', `Max safe continuous ${counterfactuals.counterfactual_max_safe_continuous_overlap_m} m`);
  md('DEFECT_ASSESSMENT.md', JSON.stringify(defect, null, 2));
  md('NEIGHBOURING_ROAD_CONTROLS.md', JSON.stringify(neighbour, null, 2));
  md('LIMITATIONS.md', 'Read-only diagnosis; counterfactuals are not recommendations; thresholds unchanged.');

  console.log('VERDICT', verdict.code, shortfallClass);
}

main();
