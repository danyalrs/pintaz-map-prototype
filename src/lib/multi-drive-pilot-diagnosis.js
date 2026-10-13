import fs from 'node:fs';
import path from 'node:path';
import { percentile } from './geo-segment.js';
import { loadBukitPilotBbox, partitionFeaturesByPilot } from './bukit-pilot-bounds.js';
import { driveDerivedPreviewPath, driveComparisonDir, driveMismatchDir, multiDriveRedactedDir } from './multi-drive-mismatch-paths.js';
import { driveSpec, MULTI_DRIVE_KEYS } from './multi-drive-mismatch-config.js';
import { matchedPosesPath, rejectedMatchesPath, comparisonSummaryPath } from './comparison-paths.js';
import { sectionResultsPath, eligibilityAuditPath, mismatchSummaryPath } from './mismatch-paths.js';
import { diagnoseSectionBreaks } from './mismatch-section-group-diagnose.js';
import { DEFAULT_PARAMS } from './mismatch-classify.js';
import { isActionableMismatch, CONSISTENT_CLASS } from './mismatch-ui-groups.js';
import { groupSectionsContiguous } from './mismatch-section-group.js';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function distStats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return {
    min: v[0],
    median: percentile(v, 50),
    p90: percentile(v, 90),
    p95: percentile(v, 95),
    max: v[v.length - 1],
    count: v.length,
  };
}

function mapRejectionReason(reason) {
  const r = String(reason || 'other');
  if (r === 'outside_pilot') return 'outside_pilot';
  if (r === 'no_candidate_within_radius') return 'no_nearby_osm_candidate';
  if (r === 'ambiguous_parallel_road') return 'parallel_road_ambiguity';
  if (r === 'ambiguous_junction_or_flyover') return 'junction_or_flyover_ambiguity';
  if (r === 'ambiguous_candidate_tie') return 'parallel_road_ambiguity';
  if (r.includes('heading')) return 'heading_disagreement';
  return 'other_explicit';
}

export function deriveNotEvaluatedReasons(props) {
  const g = props.gate_failures || [];
  const reasons = [];
  if (g.includes('outside_coverage')) reasons.push('outside_pilot');
  if (g.includes('min_frames')) reasons.push('insufficient_frames');
  if (g.includes('min_section_length')) reasons.push('insufficient_length');
  if (g.includes('heading_disagreement')) reasons.push('heading_disagreement');
  if (g.includes('ambiguous_parallel_road')) reasons.push('parallel_road_ambiguity');
  if (g.includes('ambiguous_junction_or_flyover')) reasons.push('junction_or_flyover_ambiguity');
  if (g.includes('global_surface_not_accepted') || g.includes('local_surface_rejected')) {
    reasons.push('unsupported_geometry');
  }
  if (props.sensitivity_stable === false) reasons.push('sensitivity_unstable');
  if (!reasons.length && props.classification === 'not_evaluated') reasons.push('other_documented');
  return reasons;
}

function supportFunnelFromAudit(sections, auditSections) {
  const funnel = {
    matched_poses: 0,
    grouped_sections: sections.length,
    geometry_capable_centreline: 0,
    geometry_capable_lane_edge: 0,
    pass_min_frames: 0,
    pass_min_length: 0,
    pass_frame_and_length: 0,
    pass_heading: 0,
    pass_ambiguity: 0,
    pass_observation_attachment: 0,
    pass_sensitivity: 0,
    support_eligible_centreline: 0,
    support_eligible_lane_edge: 0,
    consistent: 0,
    possible_actionable: 0,
    insufficient: 0,
    not_evaluated: 0,
    gate_failure_counts: {},
  };
  for (const a of auditSections) {
    funnel.matched_poses += a.matched_pose_count || 0;
    if (a.geometry_capable_centreline) funnel.geometry_capable_centreline += 1;
    if (a.geometry_capable_lane_edge) funnel.geometry_capable_lane_edge += 1;
    if ((a.frame_count || 0) >= DEFAULT_PARAMS.minFrames) funnel.pass_min_frames += 1;
    if ((a.section_length_m || 0) >= DEFAULT_PARAMS.minSectionLengthM) funnel.pass_min_length += 1;
    if (
      (a.frame_count || 0) >= DEFAULT_PARAMS.minFrames &&
      (a.section_length_m || 0) >= DEFAULT_PARAMS.minSectionLengthM
    ) {
      funnel.pass_frame_and_length += 1;
    }
    const gates = a.gate_failures || [];
    for (const gf of gates) {
      funnel.gate_failure_counts[gf] = (funnel.gate_failure_counts[gf] || 0) + 1;
    }
    if (!gates.includes('heading_disagreement')) funnel.pass_heading += 1;
    if (!gates.includes('ambiguous_parallel_road') && !gates.includes('ambiguous_junction_or_flyover')) {
      funnel.pass_ambiguity += 1;
    }
    if ((a.lane_observations || 0) > 0 || (a.edge_observations || 0) > 0) funnel.pass_observation_attachment += 1;
    const sec = sections.find((s) => s.properties?.candidate_id === a.candidate_id);
    if (sec?.properties?.sensitivity_stable) funnel.pass_sensitivity += 1;
    if (a.support_eligible_centreline) funnel.support_eligible_centreline += 1;
    if (a.support_eligible_lane_edge) funnel.support_eligible_lane_edge += 1;
    const cl = a.classification;
    if (cl === CONSISTENT_CLASS) funnel.consistent += 1;
    else if (isActionableMismatch(cl)) funnel.possible_actionable += 1;
    else if (cl === 'insufficient_evidence') funnel.insufficient += 1;
    else if (cl === 'not_evaluated') funnel.not_evaluated += 1;
  }
  return funnel;
}

export function diagnoseDrive(driveKey, baseDir) {
  const pilotBbox = loadBukitPilotBbox();
  const previewPath = driveDerivedPreviewPath(driveKey, baseDir);
  const preview = readJson(previewPath);
  const layers = ['vehicle_pose', 'lane_point', 'edge_point', 'gps_point'];
  const layerStages = {};
  for (const layer of layers) {
    const feats = preview.features.filter((f) => f.properties?.layer === layer);
    const part = partitionFeaturesByPilot(feats, pilotBbox);
    layerStages[layer] = {
      total_route: feats.length,
      inside_pilot: part.inside,
      outside_pilot: part.outside,
      conservation_ok: part.inside + part.outside === feats.length,
    };
  }

  const compDir = driveComparisonDir(driveKey, baseDir);
  const mismatchDir = driveMismatchDir(driveKey, baseDir);
  const cmpSummary = fs.existsSync(comparisonSummaryPath(compDir))
    ? readJson(comparisonSummaryPath(compDir))
    : null;
  const matched = fs.existsSync(matchedPosesPath(compDir))
    ? readJson(matchedPosesPath(compDir)).features
    : [];
  const rejected = fs.existsSync(rejectedMatchesPath(compDir))
    ? readJson(rejectedMatchesPath(compDir)).features
    : [];

  const rejectionByReason = {};
  for (const f of rejected) {
    const bucket = mapRejectionReason(f.properties?.reason);
    rejectionByReason[bucket] = (rejectionByReason[bucket] || 0) + 1;
  }

  const matchedInPilot = matched.filter((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return lon >= pilotBbox.minLon && lon <= pilotBbox.maxLon && lat >= pilotBbox.minLat && lat <= pilotBbox.maxLat;
  }).length;

  const sections = fs.existsSync(sectionResultsPath(mismatchDir))
    ? readJson(sectionResultsPath(mismatchDir)).features
    : [];
  const audit = fs.existsSync(eligibilityAuditPath(mismatchDir))
    ? readJson(eligibilityAuditPath(mismatchDir)).sections
    : [];

  const posesInSections = groupSectionsContiguous(matched).reduce((n, g) => n + g.length, 0);
  const notEvalBreakdown = {};
  for (const s of sections) {
    for (const r of deriveNotEvaluatedReasons(s.properties)) {
      notEvalBreakdown[r] = (notEvalBreakdown[r] || 0) + 1;
    }
  }

  const grouping = diagnoseSectionBreaks(matched);

  return {
    drive_key: driveKey,
    redacted_drive_ref: driveSpec(driveKey).redacted_drive_ref,
    pilot_bbox_source: pilotBbox.source,
    layer_stages: layerStages,
    vehicle_pose_pipeline: {
      total_route: layerStages.vehicle_pose.total_route,
      inside_pilot: layerStages.vehicle_pose.inside_pilot,
      outside_pilot: layerStages.vehicle_pose.outside_pilot,
      matcher_input: cmpSummary?.matcher_input_pose_count ?? cmpSummary?.vehicle_pose_count,
      excluded_outside_pilot: cmpSummary?.excluded_outside_pilot_pose_count ?? 0,
      pilot_scoped_matcher: cmpSummary?.pilot_scoped_matcher ?? false,
      matched: matched.length,
      rejected: rejected.length,
      matcher_conservation:
        (cmpSummary?.matcher_input_pose_count ?? 0) ===
        (cmpSummary?.matched_pose_count ?? 0) + (cmpSummary?.matcher_rejected_pose_count ?? 0),
      matched_inside_pilot: matchedInPilot,
      used_in_sections: posesInSections,
      used_in_mismatch_sections: sections.length,
    },
    rejection_funnel: {
      by_reason: rejectionByReason,
      nearest_osm_distance_m: distStats(matched.map((f) => Number(f.properties?.distance_m))),
      heading_diff_deg: distStats(matched.map((f) => Number(f.properties?.heading_diff_deg))),
      rejected_distance_m: distStats(
        rejected
          .filter((f) => f.properties?.reason !== 'outside_pilot')
          .map((f) => Number(f.properties?.best_distance_m ?? f.properties?.distance_m))
      ),
    },
    support_funnel: supportFunnelFromAudit(sections, audit),
    not_evaluated_breakdown: notEvalBreakdown,
    grouping_audit: {
      break_reason_counts: grouping.break_events.reduce((acc, b) => {
        const k = b.reason || b.section_end_reason;
        if (k) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      section_count: grouping.section_count,
    },
    top_failure_reasons: Object.entries(
      supportFunnelFromAudit(sections, audit).gate_failure_counts || {}
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => ({ reason: k, count: v })),
  };
}

export function runMultiDrivePilotDiagnosis(baseDir) {
  const drives = MULTI_DRIVE_KEYS.map((k) => diagnoseDrive(k, baseDir));
  const combined = {
    support_eligible_centreline: drives.reduce((n, d) => n + d.support_funnel.support_eligible_centreline, 0),
    support_eligible_lane_edge: drives.reduce((n, d) => n + d.support_funnel.support_eligible_lane_edge, 0),
    possible_actionable: drives.reduce((n, d) => n + d.support_funnel.possible_actionable, 0),
  };
  return { drives, combined, thresholds: DEFAULT_PARAMS };
}

export function writeDiagnosisOutputs(diagnosis, baseDir) {
  const redactedDir = multiDriveRedactedDir(baseDir);
  fs.mkdirSync(redactedDir, { recursive: true });
  const pilotMetrics = {
    schema: 'pintaz.multi-drive.pilot-scope.redacted',
    version: 1,
    drives: diagnosis.drives.map((d) => ({
      redacted_drive_ref: d.redacted_drive_ref,
      layer_stages: d.layer_stages,
      vehicle_pose_pipeline: d.vehicle_pose_pipeline,
    })),
    proof_note:
      'Matcher receives only inside-pilot vehicle poses when pilot_scoped_matcher is true; outside poses are excluded before matching.',
  };
  fs.writeFileSync(
    path.join(redactedDir, 'pilot-scope-metrics.redacted.json'),
    `${JSON.stringify(pilotMetrics, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(redactedDir, 'rejection-funnel.redacted.json'),
    `${JSON.stringify({ drives: diagnosis.drives.map((d) => ({ redacted_drive_ref: d.redacted_drive_ref, rejection_funnel: d.rejection_funnel, by_reason: d.rejection_funnel.by_reason })) }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(redactedDir, 'support-funnel.redacted.json'),
    `${JSON.stringify({ drives: diagnosis.drives.map((d) => ({ redacted_drive_ref: d.redacted_drive_ref, support_funnel: d.support_funnel, not_evaluated_breakdown: d.not_evaluated_breakdown })), combined: diagnosis.combined }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(redactedDir, 'grouping-audit.redacted.json'),
    `${JSON.stringify({ drives: diagnosis.drives.map((d) => ({ redacted_drive_ref: d.redacted_drive_ref, grouping_audit: d.grouping_audit })) }, null, 2)}\n`
  );
  return pilotMetrics;
}
