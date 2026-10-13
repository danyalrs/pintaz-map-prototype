#!/usr/bin/env node
/**
 * OSM logical-road chaining feasibility diagnosis V1 (read-only simulation).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { MULTI_DRIVE_KEYS, driveSpec } from '../src/lib/multi-drive-mismatch-config.js';
import {
  multiDriveBaseDir,
  driveComparisonDir,
  driveDerivedPreviewPath,
  aggregateSummaryRedactedPath,
} from '../src/lib/multi-drive-mismatch-paths.js';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { sectionResultsPath } from '../src/lib/mismatch-paths.js';
import { driveMismatchDir } from '../src/lib/multi-drive-mismatch-paths.js';
import { buildOsmEndpointTopology } from '../src/lib/osm-logical-road-feasibility/topology.js';
import { buildWayStore } from '../src/lib/osm-logical-road-feasibility/way-store.js';
import { auditDriveFragmentation, summarizeFragmentation } from '../src/lib/osm-logical-road-feasibility/fragmentation-audit.js';
import { buildSafeTransitionGraph, osmToLogicalRoadMap } from '../src/lib/osm-logical-road-feasibility/logical-chains.js';
import { runParameterSweep, selectTightestSafeCombo } from '../src/lib/osm-logical-road-feasibility/parameter-sweep.js';
import { buildSafetyControlCases, evaluateSafetyControls } from '../src/lib/osm-logical-road-feasibility/safety-controls.js';
import {
  compareGroupingBeforeAfter,
  runSimulatedMismatchForDrive,
  summarizeMismatchSummary,
} from '../src/lib/osm-logical-road-feasibility/simulate-impact.js';
import { verifyPhase0, EXPECTED_HEAD, sha256File } from '../src/lib/osm-logical-road-feasibility/phase0-protected.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';

const VERSION = 'osm-logical-road-chaining-feasibility-v1';
const DATA_DIR = path.join(ROOT_DIR, 'data', 'maps-read', VERSION);
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'osm_logical_road_chaining_feasibility_v1');
const CHECKPOINT_DIR = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_osm_logical_road_chaining_feasibility_v1');

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

function redactTransitions(rows) {
  return rows.map((r) => ({
    ...r,
    drive_ref: r.drive_ref,
  }));
}

function main() {
  const commands = [];
  commands.push(`node scripts/run-osm-logical-road-chaining-feasibility-v1.js`);
  commands.push('node --check scripts/run-osm-logical-road-chaining-feasibility-v1.js');

  const phase0 = verifyPhase0({ requireServer: true });
  writeJson(path.join(CHECKPOINT_DIR, 'protected-state.json'), {
    schema: 'pintaz.checkpoint.pre-osm-logical-road-chaining-feasibility-v1',
    expected_head: EXPECTED_HEAD,
    phase0,
    protected_input_sha256: PROTECTED_INPUT_SHA256,
    bukit_osm_sha256: sha256File(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID)),
  });

  if (!phase0.ok) {
    console.error('PHASE 0 FAILED', phase0.errors);
    process.exit(2);
  }

  const roadsPath = localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID);
  const roads = JSON.parse(fs.readFileSync(roadsPath, 'utf8'));
  const topology = buildOsmEndpointTopology(roads);
  const wayStore = buildWayStore(roads);
  writeJson(path.join(DATA_DIR, 'topology-index.json'), topology);

  const classifyParamsDefault = { toleranceM: 0, maxHeadingDeg: 20 };
  const perDrive = [];
  const allTransitions = [];
  const observedPairs = [];

  const baseDir = multiDriveBaseDir();
  for (const key of MULTI_DRIVE_KEYS) {
    const spec = driveSpec(key);
    const compDir = driveComparisonDir(key, baseDir);
    const posesPath = matchedPosesPath(compDir);
    if (!fs.existsSync(posesPath)) {
      console.error('missing poses', key);
      process.exit(3);
    }
    const poses = JSON.parse(fs.readFileSync(posesPath, 'utf8'));
    const audit = auditDriveFragmentation(spec.redacted_drive_ref, poses, wayStore, classifyParamsDefault);
    perDrive.push(audit);
    allTransitions.push(...audit.transitions);
    for (const t of audit.transitions) {
      observedPairs.push({ from_osm_id: t.from_osm_id, to_osm_id: t.to_osm_id });
    }
  }

  const fragmentationSummary = {
    schema: 'pintaz.osm-logical-road.fragmentation-summary.v1',
    per_drive: perDrive,
    overall: summarizeFragmentation(perDrive),
  };
  writeJson(path.join(DATA_DIR, 'fragmentation_summary.json'), fragmentationSummary);
  writeJson(path.join(REPORT_DIR, 'fragmentation_summary.json'), fragmentationSummary);

  const safetyCases = buildSafetyControlCases(wayStore);
  const safetyTagged = new Set(
    safetyCases.filter((c) => c.expect_reject).map((c) => `${c.from_osm_id}->${c.to_osm_id}`)
  );
  const sweep = runParameterSweep(observedPairs, wayStore, safetyTagged);
  writeJson(path.join(DATA_DIR, 'parameter_sweep.json'), { grid: sweep });
  writeJson(path.join(REPORT_DIR, 'parameter_sweep.json'), { grid: sweep });

  let selected = selectTightestSafeCombo(sweep);
  let selectedParams = selected
    ? { toleranceM: selected.tolerance_m, maxHeadingDeg: selected.max_heading_deg }
    : { toleranceM: 0, maxHeadingDeg: 10 };

  let safetyEval = evaluateSafetyControls(safetyCases, wayStore, selectedParams);
  if (safetyEval.unsafe_joins > 0) {
    selected = null;
    selectedParams = { toleranceM: 0, maxHeadingDeg: 10 };
    safetyEval = evaluateSafetyControls(safetyCases, wayStore, selectedParams);
  }
  writeJson(path.join(DATA_DIR, 'safety_controls.json'), safetyEval);
  writeJson(path.join(REPORT_DIR, 'safety_controls.json'), safetyEval);

  const { edges, byPair } = buildSafeTransitionGraph(observedPairs, wayStore, selectedParams);
  const osmToLogical = osmToLogicalRoadMap(edges);
  const logicalRoads = [...osmToLogical.values()].map((v) => ({
    logical_road_id: v.logical_road_id,
    member_osm_ids: v.member_osm_ids,
  }));
  writeJson(path.join(DATA_DIR, 'logical-roads.json'), {
    params: selectedParams,
    roads: logicalRoads,
    transitions: [...byPair.entries()].map(([k, v]) => ({ pair: k, ...v })),
  });

  const simRoot = path.join(DATA_DIR, 'simulated-pipeline');
  const groupingCompare = [];
  const simSummaries = [];
  for (const key of MULTI_DRIVE_KEYS) {
    const spec = driveSpec(key);
    const compDir = driveComparisonDir(key, baseDir);
    const poses = JSON.parse(fs.readFileSync(matchedPosesPath(compDir), 'utf8'));
    const cmp = compareGroupingBeforeAfter(poses, osmToLogical);
    groupingCompare.push({ drive_ref: spec.redacted_drive_ref, ...cmp });
    const sim = runSimulatedMismatchForDrive({
      driveKey: key,
      sourceComparisonDir: compDir,
      previewPath: driveDerivedPreviewPath(key, baseDir),
      simRootDir: simRoot,
      osmToLogical,
    });
    simSummaries.push({
      drive_ref: spec.redacted_drive_ref,
      ok: sim.ok,
      summary: summarizeMismatchSummary(sim.summary),
    });
  }

  const baselineAgg = JSON.parse(fs.readFileSync(aggregateSummaryRedactedPath(), 'utf8'));
  const simulatedImpact = {
    schema: 'pintaz.osm-logical-road.simulated-impact.v1',
    selected_params: selectedParams,
    grouping_by_drive: groupingCompare.map((g) => ({
      drive_ref: g.drive_ref,
      before: g.before,
      after: g.after,
    })),
    per_drive_mismatch_summary: simSummaries,
    baseline_aggregate: {
      support_eligible_centreline: baselineAgg.support_eligible_totals?.support_eligible_centreline,
      support_eligible_lane_edge: baselineAgg.support_eligible_totals?.support_eligible_lane_edge,
      multi_drive_candidates: baselineAgg.multi_drive_candidates,
      single_drive_consistent_sections: baselineAgg.single_drive_consistent_sections,
      insufficient_combined_evidence: baselineAgg.aggregate_state_counts?.insufficient_combined_evidence,
    },
    note:
      'Aggregate cross-drive recount uses per-drive simulated mismatch summaries; production aggregate unchanged on disk.',
  };
  writeJson(path.join(DATA_DIR, 'simulated_impact.json'), simulatedImpact);
  writeJson(path.join(REPORT_DIR, 'simulated_impact.json'), simulatedImpact);

  const transitionAudit = {
    schema: 'pintaz.osm-logical-road.transition-audit.redacted.v1',
    transition_count: allTransitions.length,
    transitions: redactTransitions(allTransitions),
  };
  writeJson(path.join(DATA_DIR, 'transition_audit.redacted.json'), transitionAudit);
  writeJson(path.join(REPORT_DIR, 'transition_audit.redacted.json'), transitionAudit);

  const safeCount = [...byPair.values()].filter((v) => v.classification === 'safe_unique_continuation').length;
  const rejectedCounts = {};
  for (const v of byPair.values()) {
    rejectedCounts[v.classification] = (rejectedCounts[v.classification] || 0) + 1;
  }

  const beforeSections = groupingCompare.reduce((s, g) => s + g.before.section_count, 0);
  const afterSections = groupingCompare.reduce((s, g) => s + g.after.section_count, 0);
  const beforeSplits = groupingCompare.reduce((s, g) => s + g.before.osm_way_change_splits, 0);
  const afterSplits = groupingCompare.reduce((s, g) => s + g.after.osm_way_change_splits, 0);

  const simSupportCentre = simSummaries.reduce((s, d) => s + (d.summary?.support_eligible_centreline || 0), 0);
  const simSupportLane = simSummaries.reduce((s, d) => s + (d.summary?.support_eligible_lane_edge || 0), 0);

  let verdict = 'C. NOT FEASIBLE — KEEP OSM WAY BOUNDARIES';
  if (selected && safetyEval.all_passed && safeCount > 0 && afterSections < beforeSections) {
    verdict = 'B. PARTIALLY FEASIBLE — MORE CONTROLS OR DATA REQUIRED';
  }
  if (
    selected &&
    safetyEval.all_passed &&
    safeCount > 0 &&
    afterSections < beforeSections &&
    simSupportCentre >= baselineAgg.support_eligible_totals?.support_eligible_centreline
  ) {
    verdict = 'A. LOGICAL-ROAD CHAINING FEASIBLE — SAFE IMPLEMENTATION PROPOSAL READY';
  }

  const testResults = {
    phase0_ok: phase0.ok,
    protected_hashes_ok: phase0.protected_hashes.ok,
    osm_file_unchanged: sha256File(roadsPath) === PROTECTED_INPUT_SHA256.bukit_osm,
    safety_all_passed: safetyEval.all_passed,
    verdict,
  };
  writeJson(path.join(REPORT_DIR, 'test_results.json'), testResults);
  writeJson(path.join(DATA_DIR, 'test_results.json'), testResults);

  writeMarkdownReports({
    fragmentationSummary,
    topology,
    selectedParams,
    sweep,
    simulatedImpact,
    safetyEval,
    verdict,
    metrics: {
      osm_way_change_splits: beforeSplits,
      afterSplits,
      safe_unique_transitions: safeCount,
      rejectedCounts,
      beforeSections,
      afterSections,
      baselineSupportCentre: baselineAgg.support_eligible_totals?.support_eligible_centreline,
      simSupportCentre,
      baselineCandidates: baselineAgg.multi_drive_candidates,
    },
  });

  commands.push('npm test');
  commands.push('npm run validate:data');
  commands.push('git diff --check');
  commands.push('Phase 0B: removed scripts/_tmp-module-audit.mjs and scripts/_tmp-recursive-import-audit.mjs (blank-map audit only)');
  writeText(path.join(REPORT_DIR, 'commands.txt'), `${commands.join('\n')}\n`);
  writeText(path.join(DATA_DIR, 'commands.txt'), `${commands.join('\n')}\n`);

  writeJson(path.join(REPORT_DIR, 'manifest.json'), {
    schema: 'pintaz.report-manifest.v1',
    diagnosis: VERSION,
    generated_at: new Date().toISOString(),
    head: EXPECTED_HEAD,
    outputs: [
      'FINAL_REPORT.md',
      'CURRENT_FRAGMENTATION.md',
      'TOPOLOGY_METHOD.md',
      'CONTINUATION_RULES.md',
      'PARAMETER_SWEEP.md',
      'SIMULATED_IMPACT.md',
      'SAFETY_CONTROLS.md',
      'LIMITATIONS.md',
      'fragmentation_summary.json',
      'transition_audit.redacted.json',
      'parameter_sweep.json',
      'simulated_impact.json',
      'safety_controls.json',
      'test_results.json',
      'commands.txt',
      'manifest.json',
    ],
    data_dir: 'data/maps-read/osm-logical-road-chaining-feasibility-v1/',
  });

  console.log(JSON.stringify({ ok: true, verdict, report_dir: REPORT_DIR }, null, 2));
}

function writeMarkdownReports(ctx) {
  const { fragmentationSummary, selectedParams, sweep, simulatedImpact, safetyEval, verdict, metrics } = ctx;
  writeText(
    path.join(REPORT_DIR, 'CURRENT_FRAGMENTATION.md'),
    `# Current fragmentation\n\nOverall OSM way-change splits: **${metrics.osm_way_change_splits}**.\n\n${JSON.stringify(fragmentationSummary.overall, null, 2)}\n`
  );
  writeText(
    path.join(REPORT_DIR, 'TOPOLOGY_METHOD.md'),
    `# Topology method\n\nRead-only endpoint index from Bukit OSM GeoJSON (${fragmentationSummary.overall.drives} drives). Endpoints keyed at 7 decimal degrees; candidate continuations within tolerance.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'CONTINUATION_RULES.md'),
    `# Continuation rules\n\nTwelve-class taxonomy; \`safe_unique_continuation\` requires unique compatible branch, tolerance/heading gates, agreement on bridge/tunnel/layer, no junction/parallel/roundabout conflicts.\n`
  );
  const best = sweep.find(
    (s) => s.tolerance_m === selectedParams.toleranceM && s.max_heading_deg === selectedParams.maxHeadingDeg
  );
  writeText(
    path.join(REPORT_DIR, 'PARAMETER_SWEEP.md'),
    `# Parameter sweep\n\nSelected: tolerance **${selectedParams.toleranceM} m**, heading **${selectedParams.maxHeadingDeg}°**.\n\n\`\`\`json\n${JSON.stringify(best, null, 2)}\n\`\`\`\n`
  );
  writeText(
    path.join(REPORT_DIR, 'SIMULATED_IMPACT.md'),
    `# Simulated impact\n\nSections ${metrics.beforeSections} → ${metrics.afterSections}; OSM splits ${metrics.osm_way_change_splits} → ${metrics.afterSplits}.\n\n\`\`\`json\n${JSON.stringify(simulatedImpact.baseline_aggregate, null, 2)}\n\`\`\`\n`
  );
  writeText(
    path.join(REPORT_DIR, 'SAFETY_CONTROLS.md'),
    `# Safety controls\n\nUnsafe joins: **${safetyEval.unsafe_joins}** (required 0).\n\nAll passed: **${safetyEval.all_passed}**.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'LIMITATIONS.md'),
    `# Limitations\n\n- Diagnosis only; production grouping unchanged unless \`osmGroupingKey\` passed explicitly.\n- Cross-drive aggregate on disk not rewritten; simulated mismatch runs under gitignored data dir.\n- Missing OSM names reduce confidence but do not alone reject safe topology.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# OSM logical-road chaining feasibility V1\n\n## Verdict\n\n**${verdict}**\n\n1. Current \`osm_way_change\` splits: ${metrics.osm_way_change_splits}\n2. Safe unique transitions (selected params): ${metrics.safe_unique_transitions}\n3. Rejected/ambiguous (pair map): ${JSON.stringify(metrics.rejectedCounts)}\n4. Selected tolerance ${selectedParams.toleranceM} m, heading ${selectedParams.maxHeadingDeg}°\n5. Sections before/after: ${metrics.beforeSections} / ${metrics.afterSections}\n6. Support-eligible centreline before/after (sim sum): ${metrics.baselineSupportCentre} / ${metrics.simSupportCentre}\n7. Multi-drive candidates before: ${metrics.baselineCandidates}\n8. Safety controls: ${safetyEval.all_passed ? 'PASS' : 'FAIL'}\n9. Unknowns: parallel carriageways with weak tagging, complex slip roads\n10. Future scope: optional \`logical_road_id\` diagnostic grouping key behind feature flag\n`
  );
}

main();
