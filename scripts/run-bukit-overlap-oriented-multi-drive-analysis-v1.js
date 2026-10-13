#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { DIAG_VERSION, ANALYSIS_ROUTES, SELECTED_SWEEP_DEFAULT } from '../src/lib/bukit-overlap-multi-drive-analysis/config.js';
import { verifyPhase0, EXPECTED_HEAD } from '../src/lib/bukit-overlap-multi-drive-analysis/phase0-protected.js';
import { prepareIsolatedInputs, writePrivateManifest } from '../src/lib/bukit-overlap-multi-drive-analysis/input-integrity.js';
import { buildAnalysisInventory } from '../src/lib/bukit-overlap-multi-drive-analysis/inventory.js';
import { runPerDriveMatching } from '../src/lib/bukit-overlap-multi-drive-analysis/per-drive-matching.js';
import { reconstructPairSpans, reconstructSetSpans, auditWay39914067 } from '../src/lib/bukit-overlap-multi-drive-analysis/shared-spans.js';
import { buildPairAndSetResults } from '../src/lib/bukit-overlap-multi-drive-analysis/pair-set-results.js';
import { runSupportSweep } from '../src/lib/bukit-overlap-multi-drive-analysis/support-sweep.js';
import { leaveOneDongleOut } from '../src/lib/bukit-overlap-multi-drive-analysis/leave-one-out.js';
import { evaluateMultiDriveSafetyControls } from '../src/lib/bukit-overlap-multi-drive-analysis/safety-controls.js';
import { buildDiagnosticProposals } from '../src/lib/bukit-overlap-multi-drive-analysis/proposals.js';

const DATA_DIR = path.join(ROOT_DIR, 'data', 'maps-read', DIAG_VERSION);
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_overlap_oriented_multi_drive_analysis_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_bukit_overlap_oriented_multi_drive_analysis_v1');

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}
function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function redactMatching(m) {
  return {
    route_key: m.route_key,
    ok: m.ok,
    total_vehicle_poses: m.total_vehicle_poses,
    inside_pilot_poses: m.inside_pilot_poses,
    outside_pilot_poses: m.outside_pilot_poses,
    matcher_input_pose_count: m.matcher_input_pose_count,
    matched_poses: m.matched_poses,
    rejected_poses: m.rejected_poses,
    rejection_reasons: m.rejection_reasons,
    distinct_matched_osm_ways: m.distinct_matched_osm_ways,
    osm_summaries: m.osm_summaries,
    ambiguity_rejections: m.ambiguity_rejections,
  };
}

function main() {
  const phase0 = verifyPhase0();
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), { expected_head: EXPECTED_HEAD, phase0 });
  if (!phase0.ok) {
    console.error('PHASE 0 FAILED', phase0.errors);
    process.exit(2);
  }

  const inventory = buildAnalysisInventory();
  if (inventory.distinct_dongle_groups !== 3) {
    console.error('Expected 3 distinct dongle groups', inventory.distinct_dongle_groups);
    process.exit(3);
  }
  const inputIntegrity = prepareIsolatedInputs(DATA_DIR);
  writePrivateManifest(DATA_DIR, phase0, inventory);
  writeJson(path.join(DATA_DIR, 'input_integrity.redacted.json'), inputIntegrity);
  writeJson(path.join(REPORT_DIR, 'input_integrity.redacted.json'), inputIntegrity);

  const matchingByKey = new Map();
  const matchingAudits = [];
  for (const spec of ANALYSIS_ROUTES) {
    const m = runPerDriveMatching(spec.route_key, spec.probe_ref, DATA_DIR);
    matchingByKey.set(spec.route_key, m);
    matchingAudits.push(m);
  }
  const matchingRedacted = matchingAudits.map(redactMatching);
  writeJson(path.join(DATA_DIR, 'per_drive_matching.redacted.json'), { routes: matchingRedacted });
  writeJson(path.join(REPORT_DIR, 'per_drive_matching.redacted.json'), { routes: matchingRedacted });

  const meta = new Map(inventory.routes.map((r) => [r.route_key, r.public]));
  const active = matchingByKey.get('active');
  const d005 = matchingByKey.get('drive-005');
  const d007 = matchingByKey.get('drive-007');
  const pairSpans = {
    active_drive_005: reconstructPairSpans(active, d005, meta.get('active'), meta.get('drive-005'), {
      maxBinGapM: SELECTED_SWEEP_DEFAULT.maxBinGapM,
    }),
    active_drive_007: reconstructPairSpans(active, d007, meta.get('active'), meta.get('drive-007'), {
      maxBinGapM: SELECTED_SWEEP_DEFAULT.maxBinGapM,
    }),
    drive_005_drive_007: reconstructPairSpans(d005, d007, meta.get('drive-005'), meta.get('drive-007'), {
      maxBinGapM: SELECTED_SWEEP_DEFAULT.maxBinGapM,
    }),
  };
  const setSpans = reconstructSetSpans([active, d005, d007], meta, {
    maxBinGapM: SELECTED_SWEEP_DEFAULT.maxBinGapM,
  });
  const way399 = auditWay39914067([
    ...pairSpans.active_drive_005,
    ...pairSpans.active_drive_007,
    ...pairSpans.drive_005_drive_007,
    ...setSpans,
  ]);
  writeJson(path.join(DATA_DIR, 'shared_spans.redacted.json'), {
    pair_spans: pairSpans,
    set_spans: setSpans,
    audit_osm_way_39914067: way399,
  });
  writeJson(path.join(REPORT_DIR, 'shared_spans.redacted.json'), {
    pair_spans: pairSpans,
    set_spans: setSpans,
    audit_osm_way_39914067: way399,
  });

  const pairSet = buildPairAndSetResults(matchingByKey, inventory);
  writeJson(path.join(DATA_DIR, 'pair_set_results.redacted.json'), pairSet);
  writeJson(path.join(REPORT_DIR, 'pair_set_results.redacted.json'), pairSet);

  const allSpans = [
    ...pairSet['active+drive-005'].spans,
    ...pairSet['active+drive-007'].spans,
    ...pairSet['drive-005+drive-007'].spans,
    ...pairSet['active+drive-005+drive-007'].spans,
  ];
  const supportSweep = runSupportSweep(allSpans);
  writeJson(path.join(DATA_DIR, 'support_sweep.json'), { selected_default: SELECTED_SWEEP_DEFAULT, grid: supportSweep });
  writeJson(path.join(REPORT_DIR, 'support_sweep.json'), { selected_default: SELECTED_SWEEP_DEFAULT, grid: supportSweep });

  const classifications = allSpans.map((s) => ({
    osm_id: s.osm_id,
    shared_length_m: s.shared_length_m,
    classification: s.classification,
    stability: s.stability,
    route_keys: s.route_keys,
  }));
  writeJson(path.join(DATA_DIR, 'classifications.redacted.json'), { spans: classifications });
  writeJson(path.join(REPORT_DIR, 'classifications.redacted.json'), { spans: classifications });

  const loo = leaveOneDongleOut(pairSet['active+drive-005+drive-007'].spans);
  writeJson(path.join(DATA_DIR, 'leave_one_dongle_out.redacted.json'), { spans: loo });
  writeJson(path.join(REPORT_DIR, 'leave_one_dongle_out.redacted.json'), { spans: loo });

  const safety = evaluateMultiDriveSafetyControls(allSpans, matchingByKey);
  writeJson(path.join(DATA_DIR, 'safety_controls.json'), safety);
  writeJson(path.join(REPORT_DIR, 'safety_controls.json'), safety);

  const proposalSpans = pairSet['active+drive-005'].spans.filter((s) => s.classification?.startsWith('possible_'));
  const proposals = buildDiagnosticProposals(proposalSpans);
  writeJson(path.join(DATA_DIR, 'diagnostic_proposals.redacted.json'), proposals);
  writeJson(path.join(REPORT_DIR, 'diagnostic_proposals.redacted.json'), proposals);

  const a005 = pairSet['active+drive-005'];
  const verdict =
    proposals.count > 0
      ? 'A'
      : a005.repeated_road_length_m >= 25 && a005.shared_spans > 0
        ? 'B'
        : 'C';
  const verdictText = {
    A: 'REPEATED-ROAD EVIDENCE SUPPORTS A STABLE MULTI-DRIVE MAP PROPOSAL',
    B: 'REPEATED-ROAD EVIDENCE VALIDATES THE METHOD BUT NO MAP CHANGE IS SUPPORTED',
    C: 'REPEATED-ROAD EVIDENCE REMAINS INSUFFICIENT',
  }[verdict];

  const testResults = {
    schema: 'pintaz.bukit.overlap-multi-drive.test-results',
    verdict,
    verdict_text: verdictText,
    distinct_dongle_groups: inventory.distinct_dongle_groups,
    selected_contribution_parameters: SELECTED_SWEEP_DEFAULT,
    diagnostic_proposal_count: proposals.count,
    safety: safety.zero_unsafe_cross_drive_conclusions,
    active_drive_005_repeated_road_length_m: a005.repeated_road_length_m,
    way_39914067_span_count: way399.length,
  };
  writeJson(path.join(DATA_DIR, 'test_results.json'), testResults);
  writeJson(path.join(REPORT_DIR, 'test_results.json'), testResults);

  const manifest = {
    schema: 'pintaz.bukit.overlap-multi-drive.manifest',
    version: 1,
    diagnostic_version: DIAG_VERSION,
    generated_at: new Date().toISOString(),
    routes: ANALYSIS_ROUTES.map((r) => r.redacted_ref),
    verdict,
  };
  writeJson(path.join(DATA_DIR, 'manifest.json'), manifest);
  writeJson(path.join(REPORT_DIR, 'manifest.json'), manifest);

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `node scripts/run-bukit-overlap-oriented-multi-drive-analysis-v1.js\nnpm test\nnpm run validate:data\n`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Bukit overlap-oriented multi-drive analysis V1\n\n## Verdict: ${verdict} — ${verdictText}\n\n1. **Inputs:** active, probe-005, probe-007 (${inventory.distinct_dongle_groups} distinct dongle groups).\n2. **Shared OSM ways (active+005):** ${a005.shared_osm_ways}.\n3. **Shared spans / length (active+005):** ${a005.shared_spans} / ${a005.repeated_road_length_m.toFixed(1)} m.\n4. **Selected gates:** ${JSON.stringify(SELECTED_SWEEP_DEFAULT)}.\n5. **Support-eligible centreline spans:** ${a005.support_eligible_centreline}.\n6. **Support-eligible lane/edge spans:** ${a005.support_eligible_lane_edge}.\n7. **Consistent spans:** ${a005.consistent_spans}.\n8. **Possible mismatch spans:** ${a005.possible_mismatch_spans}.\n9. **Conflicting spans:** ${a005.conflicting_spans}.\n10. **Best-supported:** OSM way 39914067 audit spans ${way399.length}.\n11–12. See OSM_BASELINE_COMPARISON.md and lane-baseline road-index.\n13. **Sensitivity:** support sweep ${supportSweep.length} cells.\n14. **Leave-one-out:** ${loo.filter((x) => x.stable === false).length} unstable triple spans.\n15. **Diagnostic proposals:** ${proposals.count}.\n16. **Safety:** zero unsafe=${safety.zero_unsafe_cross_drive_conclusions}.\n17. **Limitations:** pilot-only; no Maps Read API; diagnostic_only.\n18. **Next task:** activate overlap trio only after explicit acceptance; extend bin-level lane residual model.\n`
  );

  const mdFiles = [
    ['INPUT_INTEGRITY.md', `Input integrity OK: ${inputIntegrity.routes.every((r) => r.conservation.ok)}`],
    ['PER_DRIVE_MATCHING.md', `See per_drive_matching.redacted.json`],
    ['SHARED_SPAN_AUDIT.md', `Way 39914067 spans: ${way399.length}; active+005 length ${a005.repeated_road_length_m.toFixed(1)} m`],
    ['EQUAL_WEIGHT_AGGREGATION.md', `Equal drive weighting in bin-evidence module; see classifications.`],
    ['SUPPORT_GATES.md', `Default ${JSON.stringify(SELECTED_SWEEP_DEFAULT)}; grid in support_sweep.json`],
    ['OSM_BASELINE_COMPARISON.md', `OSM + lane-baseline per span in pair_set_results classifications.`],
    ['CLASSIFICATION_RESULTS.md', `Total classified spans: ${classifications.length}`],
    ['PAIR_AND_SET_RESULTS.md', `See pair_set_results.redacted.json`],
    ['SENSITIVITY.md', `See support_sweep.json`],
    ['LEAVE_ONE_DONGLE_OUT.md', `See leave_one_dongle_out.redacted.json`],
    ['SAFETY_CONTROLS.md', JSON.stringify(safety, null, 2)],
    ['DIAGNOSTIC_PROPOSALS.md', proposals.reason || `${proposals.count} proposals`],
    ['LIMITATIONS.md', 'Offline diagnostic; production multi-drive unchanged; no acceptance change.'],
  ];
  for (const [name, body] of mdFiles) writeText(path.join(REPORT_DIR, name), `${body}\n`);

  console.log('VERDICT', verdict, verdictText);
}

main();
