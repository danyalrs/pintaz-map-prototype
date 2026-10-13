#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';
import { verifyPhase0, EXPECTED_HEAD } from '../src/lib/same-osm-way-cross-drive-feasibility/phase0-protected.js';
import { loadDriveEvidenceBundle } from '../src/lib/same-osm-way-cross-drive-feasibility/drive-evidence-loader.js';
import { auditInputCoverage } from '../src/lib/same-osm-way-cross-drive-feasibility/coverage-audit.js';
import {
  buildSpansForOsm,
  runSpatialAggregationSweep,
  selectTightestUsefulParams,
} from '../src/lib/same-osm-way-cross-drive-feasibility/spatial-aggregation.js';
import { classifyAllSpans } from '../src/lib/same-osm-way-cross-drive-feasibility/classify-spans.js';
import { leaveOneDongleOutAnalysis } from '../src/lib/same-osm-way-cross-drive-feasibility/leave-one-dongle-out.js';
import {
  buildSafetyControlCases,
  evaluateSafetyControls,
} from '../src/lib/same-osm-way-cross-drive-feasibility/safety-controls.js';
import { simulateImpact } from '../src/lib/same-osm-way-cross-drive-feasibility/simulate-impact.js';
import { DIAG_VERSION } from '../src/lib/same-osm-way-cross-drive-feasibility/config.js';

const DATA_DIR = path.join(ROOT_DIR, 'data', 'maps-read', DIAG_VERSION);
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'same_osm_way_cross_drive_accumulation_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_same_osm_way_cross_drive_accumulation_v1');

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}
function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function projectionAuditRedacted(bundle) {
  const reasons = {};
  const samples = [];
  for (const d of bundle.drives) {
    for (const r of d.matched_pilot_records) {
      if (r.projection?.ok) continue;
      const reason = r.projection?.reason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (samples.length < 40) {
        samples.push({
          redacted_drive_ref: d.redacted_drive_ref,
          dongle_group: d.dongle_group,
          osm_id: r.osm_id,
          reason,
        });
      }
    }
  }
  return { rejection_reason_counts: reasons, sample_rejections: samples };
}

function main() {
  const commands = ['node scripts/run-same-osm-way-cross-drive-accumulation-feasibility-v1.js'];
  const phase0 = verifyPhase0({ requireServer: true });
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), {
    schema: 'pintaz.checkpoint.pre-same-osm-way-cross-drive-accumulation-v1',
    expected_head: EXPECTED_HEAD,
    phase0,
    protected_input_sha256: PROTECTED_INPUT_SHA256,
    logical_road_chaining: 'disabled_production',
  });
  if (!phase0.ok) {
    console.error('PHASE 0 FAILED', phase0.errors);
    process.exit(2);
  }

  const bundle = loadDriveEvidenceBundle();
  const coverage = auditInputCoverage(bundle);
  writeJson(path.join(DATA_DIR, 'input_coverage.json'), coverage);
  writeJson(path.join(REPORT_DIR, 'input_coverage.json'), coverage);

  const sweep = runSpatialAggregationSweep(bundle, coverage.by_osm_way);
  const selected = selectTightestUsefulParams(sweep) || {
    binSizeM: 5,
    minDongles: 2,
    minOverlapM: 25,
    maxBinGapM: 10,
  };
  writeJson(path.join(DATA_DIR, 'parameter_sweep.json'), { grid: sweep, selected });
  writeJson(path.join(REPORT_DIR, 'parameter_sweep.json'), { grid: sweep, selected });

  const allSpans = [];
  for (const [osmId, entries] of Object.entries(coverage.by_osm_way)) {
    allSpans.push(...buildSpansForOsm(osmId, entries, selected));
  }
  const classified = classifyAllSpans(allSpans, sweep);
  writeJson(path.join(DATA_DIR, 'classification_results.redacted.json'), {
    span_count: classified.length,
    results: classified,
  });
  writeJson(path.join(REPORT_DIR, 'classification_results.redacted.json'), {
    span_count: classified.length,
    results: classified,
  });

  const loo = leaveOneDongleOutAnalysis(allSpans);
  writeJson(path.join(DATA_DIR, 'leave_one_dongle_out.redacted.json'), loo);
  writeJson(path.join(REPORT_DIR, 'leave_one_dongle_out.redacted.json'), loo);

  const safetyCases = buildSafetyControlCases(bundle, coverage.by_osm_way);
  const safety = evaluateSafetyControls(safetyCases, coverage.by_osm_way, bundle);
  writeJson(path.join(DATA_DIR, 'safety_controls.json'), safety);
  writeJson(path.join(REPORT_DIR, 'safety_controls.json'), safety);

  const projAudit = projectionAuditRedacted(bundle);
  writeJson(path.join(DATA_DIR, 'projection_audit.redacted.json'), projAudit);
  writeJson(path.join(REPORT_DIR, 'projection_audit.redacted.json'), projAudit);

  const simulated = simulateImpact(phase0.baseline_summary, coverage.summary, classified, selected);
  writeJson(path.join(DATA_DIR, 'simulated_impact.json'), simulated);
  writeJson(path.join(REPORT_DIR, 'simulated_impact.json'), simulated);

  const qualifying = classified.length;
  const overlapOsms = coverage.summary.osm_multi_detail.filter((x) => x.has_overlap).length;
  let verdict = 'C. NOT FEASIBLE — KEEP PER-DRIVE SUPPORT ONLY';
  if (safety.all_passed && qualifying > 0 && simulated.delta.support_eligible_centreline > 0) {
    verdict = 'A. SAME-WAY CROSS-DRIVE ACCUMULATION FEASIBLE — IMPLEMENTATION PROPOSAL READY';
  } else if (safety.all_passed && (qualifying > 0 || overlapOsms > 5)) {
    verdict = 'B. PARTIALLY FEASIBLE — MORE DATA OR CONTROLS REQUIRED';
  }

  const testResults = {
    phase0_ok: phase0.ok,
    protected_hashes_ok: phase0.protected_hashes.ok,
    safety_all_passed: safety.all_passed,
    verdict,
  };
  writeJson(path.join(REPORT_DIR, 'test_results.json'), testResults);
  writeJson(path.join(DATA_DIR, 'test_results.json'), testResults);

  writeReports({ coverage, selected, sweep, classified, loo, safety, simulated, verdict, projAudit });
  commands.push('npm test', 'npm run validate:data', 'git diff --check');
  writeText(path.join(REPORT_DIR, 'commands.txt'), `${commands.join('\n')}\n`);
  writeText(path.join(DATA_DIR, 'commands.txt'), `${commands.join('\n')}\n`);
  writeJson(path.join(REPORT_DIR, 'manifest.json'), {
    schema: 'pintaz.report-manifest.v1',
    diagnosis: DIAG_VERSION,
    head: EXPECTED_HEAD,
    outputs: [
      'FINAL_REPORT.md',
      'INPUT_COVERAGE_AUDIT.md',
      'ALONG_WAY_PROJECTION.md',
      'ACCUMULATION_RULES.md',
      'PARAMETER_SWEEP.md',
      'CLASSIFICATION_RESULTS.md',
      'LEAVE_ONE_DONGLE_OUT.md',
      'SAFETY_CONTROLS.md',
      'SIMULATED_IMPACT.md',
      'LIMITATIONS.md',
      'input_coverage.json',
      'projection_audit.redacted.json',
      'parameter_sweep.json',
      'classification_results.redacted.json',
      'leave_one_dongle_out.redacted.json',
      'safety_controls.json',
      'simulated_impact.json',
      'test_results.json',
      'commands.txt',
      'manifest.json',
    ],
  });

  console.log(JSON.stringify({ ok: true, verdict, report_dir: REPORT_DIR }, null, 2));
}

function writeReports(ctx) {
  const { coverage, selected, classified, loo, safety, simulated, verdict, projAudit } = ctx;
  writeText(
    path.join(REPORT_DIR, 'INPUT_COVERAGE_AUDIT.md'),
    `# Input coverage audit\n\nOSM ways with ≥2 dongles: **${coverage.summary.osm_ways_two_plus_dongles}**; ≥3: **${coverage.summary.osm_ways_three_plus_dongles}**; overlapping pairs: **${coverage.summary.overlapping_dongle_pairs}**.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'ALONG_WAY_PROJECTION.md'),
    `# Along-way projection\n\nDiagnostic projection on original OSM centreline; rejection counts: ${JSON.stringify(projAudit.rejection_reason_counts)}.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'ACCUMULATION_RULES.md'),
    `# Accumulation rules\n\nSame \`osm_id\`, spatial overlap, ≥2 dongle groups, unchanged minFrames/minSectionLength, duplicate frames deduped per drive.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'PARAMETER_SWEEP.md'),
    `# Parameter sweep\n\nSelected: ${JSON.stringify(selected)}\n`
  );
  writeText(
    path.join(REPORT_DIR, 'CLASSIFICATION_RESULTS.md'),
    `# Classification\n\nSpans classified: **${classified.length}**.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'LEAVE_ONE_DONGLE_OUT.md'),
    `# Leave-one-dongle-out\n\nStable: **${loo.summary.stable_spans}**, unstable: **${loo.summary.unstable_spans}**.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'SAFETY_CONTROLS.md'),
    `# Safety controls\n\nUnsafe aggregations: **${safety.unsafe_aggregations}** (required 0).\n`
  );
  writeText(
    path.join(REPORT_DIR, 'SIMULATED_IMPACT.md'),
    `# Simulated impact\n\n\`\`\`json\n${JSON.stringify(simulated, null, 2)}\n\`\`\`\n`
  );
  writeText(
    path.join(REPORT_DIR, 'LIMITATIONS.md'),
    `# Limitations\n\n- Diagnosis only; production per-drive sections unchanged.\n- No OSM-way chaining; no Maps Read API.\n- Lane/edge multi-drive signals need stronger observation linkage than this V1 sweep.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Same-OSM-way cross-drive accumulation feasibility V1\n\n## Verdict\n\n**${verdict}**\n\n1. OSM ways ≥2 dongles: ${coverage.summary.osm_ways_two_plus_dongles}\n2. With overlapping coverage: ${coverage.summary.osm_multi_detail.filter((x) => x.has_overlap).length}\n3. Qualifying accumulated spans: ${classified.length}\n4. Selected params: ${JSON.stringify(selected)}\n5. Support centreline before/after: ${simulated.production_baseline_unchanged.support_eligible_centreline} / ${simulated.diagnostic_same_way_accumulation.support_eligible_centreline}\n6. Support lane/edge before/after: ${simulated.production_baseline_unchanged.support_eligible_lane_edge} / ${simulated.diagnostic_same_way_accumulation.support_eligible_lane_edge}\n7. Cross-drive consistent: ${simulated.diagnostic_same_way_accumulation.consistent_cross_drive}\n8. Possible mismatch signals: ${simulated.diagnostic_same_way_accumulation.possible_mismatch_signals}\n9. Conflicting spans: ${simulated.diagnostic_same_way_accumulation.conflicting_spans}\n10. LOO stable spans: ${loo.summary.stable_spans}\n11. Safety: ${safety.all_passed ? 'PASS' : 'FAIL'}\n12. Limitations: overlap bins ≠ full mismatch geometry replay\n13. Future scope (if B): explicit per-bin residual consensus + lane provenance gates\n`
  );
}

main();
