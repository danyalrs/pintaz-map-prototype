#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { DIAG_VERSION, AUDIT_ROUTE_REFS } from '../src/lib/bukit-overlap-route-selection/config.js';
import { verifyPhase0, EXPECTED_HEAD } from '../src/lib/bukit-overlap-route-selection/phase0-protected.js';
import { buildRouteInventory } from '../src/lib/bukit-overlap-route-selection/route-inventory.js';
import { runMatcherForRoute } from '../src/lib/bukit-overlap-route-selection/matching-audit.js';
import {
  buildOverlapMatrices,
  parameterSensitivitySweep,
} from '../src/lib/bukit-overlap-route-selection/pairwise-overlap.js';
import {
  activeAnchoredRanking,
  globalOverlapRanking,
  selectProposedRoutes,
  noveltySetComparison,
} from '../src/lib/bukit-overlap-route-selection/rankings.js';
import { evaluateOverlapSafetyControls } from '../src/lib/bukit-overlap-route-selection/safety-controls.js';

const DATA_DIR = path.join(ROOT_DIR, 'data', 'maps-read', DIAG_VERSION);
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_overlap_oriented_route_selection_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_bukit_overlap_oriented_route_selection_v1');
const PRIVATE_DIR = path.join(DATA_DIR, 'private');

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}
function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function main() {
  const phase0 = verifyPhase0({ requireServer: false });
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), { expected_head: EXPECTED_HEAD, phase0 });
  if (!phase0.ok) {
    console.error('PHASE 0 FAILED', phase0.errors);
    process.exit(2);
  }

  const inventory = buildRouteInventory();
  const incomplete = inventory.routes.filter((r) => !r.complete);
  if (incomplete.length) {
    console.error('INCOMPLETE ROUTES', incomplete.map((r) => r.route_key));
    process.exit(3);
  }

  writeJson(path.join(PRIVATE_DIR, 'route_inventory.private.json'), inventory);
  writeJson(path.join(DATA_DIR, 'route_inventory.redacted.json'), {
    schema: inventory.schema,
    complete_route_count: inventory.complete_route_count,
    routes: inventory.redacted_public,
  });
  writeJson(path.join(REPORT_DIR, 'route_inventory.redacted.json'), {
    schema: inventory.schema,
    complete_route_count: inventory.complete_route_count,
    routes: inventory.redacted_public,
  });

  const matchingAudits = [];
  for (const spec of AUDIT_ROUTE_REFS) {
    matchingAudits.push(runMatcherForRoute(spec.route_key, spec.probe_ref, DATA_DIR));
  }
  const matchingRedacted = matchingAudits.map((m) => ({
    route_key: m.route_key,
    ok: m.ok,
    distinct_matched_osm_ways: m.distinct_matched_osm_ways,
    matched_pose_count: m.summary?.matched_pose_count,
    rejected_pose_count: m.summary?.rejected_pose_count,
    rejection_reasons: m.rejection_reasons,
    osm_summaries: m.osm_summaries,
  }));
  writeJson(path.join(DATA_DIR, 'matching_audit.redacted.json'), { routes: matchingRedacted });
  writeJson(path.join(REPORT_DIR, 'matching_audit.redacted.json'), { routes: matchingRedacted });

  const matrix = buildOverlapMatrices(matchingAudits, inventory.redacted_public);
  writeJson(path.join(DATA_DIR, 'pairwise_overlap.redacted.json'), { pairs: matrix });
  writeJson(path.join(REPORT_DIR, 'pairwise_overlap.redacted.json'), { pairs: matrix });

  const sensitivity = parameterSensitivitySweep(matrix);
  writeJson(path.join(DATA_DIR, 'parameter_sensitivity.json'), { grid: sensitivity });
  writeJson(path.join(REPORT_DIR, 'parameter_sensitivity.json'), { grid: sensitivity });

  const activeRank = activeAnchoredRanking(matrix);
  const globalRank = globalOverlapRanking(matrix);
  const proposed = selectProposedRoutes(activeRank, globalRank, inventory.redacted_public);
  const rankings = { active_anchored: activeRank, global: globalRank };
  writeJson(path.join(DATA_DIR, 'rankings.redacted.json'), rankings);
  writeJson(path.join(REPORT_DIR, 'rankings.redacted.json'), rankings);
  writeJson(path.join(DATA_DIR, 'proposed_route_set.redacted.json'), proposed);
  writeJson(path.join(REPORT_DIR, 'proposed_route_set.redacted.json'), proposed);

  const safety = evaluateOverlapSafetyControls(matrix);
  writeJson(path.join(DATA_DIR, 'safety_controls.json'), safety);
  writeJson(path.join(REPORT_DIR, 'safety_controls.json'), safety);

  const indepPairs = matrix.filter((r) => r.independent_compatible_overlaps > 0).length;
  const totalRepeated = matrix.reduce((s, r) => s + r.independent_overlap_length_m, 0);
  const spans25 = matrix.reduce((s, r) => s + r.spans_ge_25m, 0);
  const sharedOsms = matrix.reduce((s, r) => s + r.shared_osm_way_count, 0);

  let verdict = 'C. NO USEFUL REPEATED COVERAGE IN STORED ROUTES';
  if (indepPairs > 0 && spans25 > 0) verdict = 'B. LIMITED REPEATED COVERAGE — MORE OVERLAPPING ROUTES REQUIRED';
  const distinctProposedDongles = proposed.distinct_dongles_in_set;
  if (indepPairs >= 2 && spans25 >= 2 && proposed.proposed_additional_routes.length >= 2 && distinctProposedDongles >= 3) {
    verdict = 'A. EXISTING COMPLETE ROUTES PROVIDE SAFE REPEATED-ROAD COVERAGE';
  } else if (indepPairs > 0 || totalRepeated > 0) {
    verdict = 'B. LIMITED REPEATED COVERAGE — MORE OVERLAPPING ROUTES REQUIRED';
  }

  const novelty = noveltySetComparison();
  const simulated = {
    current_novelty_set: novelty,
    overlap_oriented_proposed: proposed,
    shared_osm_ways_novelty: 0,
    shared_osm_ways_audited_inventory: sharedOsms,
    independent_overlap_length_m: totalRepeated,
  };
  writeJson(path.join(DATA_DIR, 'simulated_impact.json'), simulated);
  writeJson(path.join(REPORT_DIR, 'simulated_impact.json'), simulated);

  const testResults = { phase0_ok: phase0.ok, protected_hashes_ok: phase0.protected_hashes.ok, verdict };
  writeJson(path.join(REPORT_DIR, 'test_results.json'), testResults);
  writeJson(path.join(DATA_DIR, 'test_results.json'), testResults);

  const dongleGroups = new Set(inventory.redacted_public.map((r) => r.dongle_group).filter(Boolean));
  writeMarkdownReports({
    verdict,
    inventory,
    matrix,
    activeRank,
    globalRank,
    proposed,
    safety,
    sensitivity,
    dongleGroups: dongleGroups.size,
    indepPairs,
    totalRepeated,
    spans25,
    novelty,
  });

  writeText(path.join(REPORT_DIR, 'commands.txt'), 'node scripts/run-bukit-overlap-oriented-route-selection-v1.js\nnpm test\nnpm run validate:data\n');
  writeJson(path.join(REPORT_DIR, 'manifest.json'), { diagnosis: DIAG_VERSION, head: EXPECTED_HEAD });

  console.log(JSON.stringify({ ok: true, verdict, report_dir: REPORT_DIR }, null, 2));
}

function writeMarkdownReports(ctx) {
  const lines = (k, v) => writeText(path.join(REPORT_DIR, k), `${v}\n`);
  lines('FINAL_REPORT.md', `# Final report\n\n**${ctx.verdict}**\n\nRoutes audited: ${ctx.inventory.complete_route_count}\nDongle groups: ${ctx.dongleGroups}\nIndependent pairs with overlap: ${ctx.indepPairs}\nRepeated-road length (indep): ${ctx.totalRepeated.toFixed(1)} m\nSpans ≥25m: ${ctx.spans25}\nBest active-anchored: ${ctx.activeRank[0]?.candidate || 'none'}\nProposed set: ${JSON.stringify(ctx.proposed.proposed_additional_routes)}\n`);
  lines('COMPLETE_ROUTE_INVENTORY.md', `# Inventory\n\n${ctx.inventory.complete_route_count} complete routes.\n`);
  lines('MATCHING_AUDIT.md', `# Matching audit\n\nPilot-scoped matcher per route; outputs under gitignored data dir.\n`);
  lines('PAIRWISE_OVERLAP.md', `# Pairwise overlap\n\nMatrix pairs: ${ctx.matrix.length}\n`);
  lines('PARAMETER_SENSITIVITY.md', `# Parameter sensitivity\n\nGrid combinations: ${ctx.sensitivity.length}\n`);
  lines('ACTIVE_ANCHORED_RANKING.md', `# Active anchored\n\n${JSON.stringify(ctx.activeRank.slice(0, 5), null, 2)}\n`);
  lines('GLOBAL_OVERLAP_RANKING.md', `# Global ranking\n\n${JSON.stringify(ctx.globalRank.slice(0, 5), null, 2)}\n`);
  lines('PROPOSED_ROUTE_SET.md', `# Proposed set\n\n${JSON.stringify(ctx.proposed, null, 2)}\n`);
  lines('CURRENT_VS_OVERLAP_SELECTION.md', `# Current vs overlap\n\n${JSON.stringify(ctx.novelty, null, 2)}\n`);
  lines('SAFETY_CONTROLS.md', `# Safety\n\nall_passed: ${ctx.safety.all_passed}\n`);
  lines('LIMITATIONS.md', `# Limitations\n\nMatcher replay uses diagnostic output dirs only; probe raws may contain literal NaN (derived copy for matching only).\n`);
}

main();
