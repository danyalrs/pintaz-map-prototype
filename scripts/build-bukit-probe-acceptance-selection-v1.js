#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT_DIR } from '../src/config.js';
import { parseProbePageCollection } from '../src/lib/bukit-page1-parse.js';
import {
  PROBE_RAW_DIR,
  PROBE_MANIFEST_PRIVATE_PATH,
  DRIVE_REF_MAP_PRIVATE_PATH,
} from '../src/lib/bukit-page1-probe-paths.js';
import { probeRawPath } from '../src/lib/bukit-page1-probe-paths.js';
import { loadActiveRouteVehicleGrid } from '../src/lib/bukit-page1-coverage.js';
import { resolveUpdatePreviewPaths } from '../src/lib/update-preview-paths.js';
import {
  classifyFailedDownload,
  classifyRouteCompleteness,
} from '../src/lib/bukit-probe-route-completeness.js';
import { buildRedactedDongleGroups } from '../src/lib/bukit-probe-dongle-groups.js';
import {
  cellsFromFeatures,
  combinationUnions,
  marginalNewCells,
  pairwiseOverlapReport,
  jaccardSimilarity,
} from '../src/lib/bukit-probe-spatial-grid.js';
import { supportPotentialFromFeatures } from '../src/lib/bukit-probe-support-potential.js';
import { greedyMarginalCoverageSelection } from '../src/lib/bukit-probe-greedy-selection.js';
import { containsFullDongle } from '../src/lib/bukit-route-redaction.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_route_page1_probe_v1');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function writeReport(name, content) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, name), content, 'utf8');
}

function writeJson(name, obj) {
  writeReport(name, `${JSON.stringify(obj, null, 2)}\n`);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(PROBE_MANIFEST_PRIVATE_PATH, 'utf8'));
  const driveMap = JSON.parse(fs.readFileSync(DRIVE_REF_MAP_PRIVATE_PATH, 'utf8'));
  const mappingByProbe = new Map(driveMap.mappings.map((m) => [m.probe_ref, m]));

  const activeGrid = loadActiveRouteVehicleGrid(resolveUpdatePreviewPaths().previewPath);
  const activeCells = [...activeGrid];

  const completenessRows = [];
  const routeCellMap = new Map();
  const supportByRef = new Map();
  const rawHashes = {};

  for (const rec of manifest.records || []) {
    const map = mappingByProbe.get(rec.probe_ref);
    const base = {
      probe_ref: rec.probe_ref,
      inventory_drive_ref: map?.inventory_drive_ref,
      dongle: map?.dongle,
      route: map?.route,
    };

    const rawPath = probeRawPath(rec.probe_ref);
    const rawExists = fs.existsSync(rawPath);

    if (!rec.ok) {
      const failedClass =
        rec.stop_reason === 'response_too_large' || !rawExists
          ? 'unmeasured_response_too_large'
          : classifyFailedDownload(rec.stop_reason);
      completenessRows.push({
        ...base,
        completeness_class: failedClass,
        partial_successful: false,
        status_note:
          failedClass === 'unmeasured_response_too_large'
            ? 'not_lacking_pilot_coverage_unmeasured_due_to_size_cap'
            : null,
      });
      continue;
    }

    rawHashes[rec.probe_ref] = sha256File(rawPath);
    const collection = parseProbePageCollection(fs.readFileSync(rawPath));
    const md = collection.metadata || {};
    const klass = classifyRouteCompleteness(md);
    completenessRows.push({
      ...base,
      completeness_class: klass,
      truncated: md.truncated,
      next_after_seg: md.next_after_seg ?? null,
      partial_successful: false,
    });

    if (klass === 'complete_single_response_route') {
      const cells = cellsFromFeatures(collection.features || []);
      routeCellMap.set(rec.probe_ref, cells);
      supportByRef.set(rec.probe_ref, supportPotentialFromFeatures(collection.features || []));
    }
  }

  const completeCount = completenessRows.filter(
    (r) => r.completeness_class === 'complete_single_response_route'
  ).length;
  const unmeasuredCount = completenessRows.filter(
    (r) => r.completeness_class === 'unmeasured_response_too_large'
  ).length;
  const partialCount = completenessRows.filter(
    (r) => r.completeness_class === 'partial_response_requires_pagination'
  ).length;

  const groupInput = completenessRows.map((r) => ({
    probe_ref: r.probe_ref,
    inventory_drive_ref: r.inventory_drive_ref,
    dongle: r.dongle,
    route: r.route,
    completeness_class: r.completeness_class,
    status_note:
      r.completeness_class === 'unmeasured_response_too_large'
        ? 'not_lacking_pilot_coverage_unmeasured_due_to_size_cap'
        : null,
  }));
  const { groups: dongleGroups, routes: dongleGroupRoutes, dongleToGroup } =
    buildRedactedDongleGroups(groupInput);

  const completeRefs = [...routeCellMap.keys()].sort();
  const perRouteSpatial = completeRefs.map((ref) => {
    const cells = routeCellMap.get(ref);
    const overlapActive = [...cells].filter((c) => activeGrid.has(c)).length;
    return {
      probe_ref: ref,
      route_cell_count: cells.size,
      overlap_with_active_route: overlapActive,
      novel_cells_vs_active: cells.size - overlapActive,
    };
  });

  const pairs = pairwiseOverlapReport(routeCellMap);
  const twoCombos = [];
  for (let i = 0; i < completeRefs.length; i += 1) {
    for (let j = i + 1; j < completeRefs.length; j += 1) {
      twoCombos.push({
        routes: [completeRefs[i], completeRefs[j]],
        union_cells: combinationUnions(routeCellMap, [completeRefs[i], completeRefs[j]]),
      });
    }
  }
  const threeCombos = [];
  for (let i = 0; i < completeRefs.length; i += 1) {
    for (let j = i + 1; j < completeRefs.length; j += 1) {
      for (let k = j + 1; k < completeRefs.length; k += 1) {
        threeCombos.push({
          routes: [completeRefs[i], completeRefs[j], completeRefs[k]],
          union_cells: combinationUnions(routeCellMap, [
            completeRefs[i],
            completeRefs[j],
            completeRefs[k],
          ]),
        });
      }
    }
  }

  const candidates = completeRefs.map((ref) => {
    const row = completenessRows.find((r) => r.probe_ref === ref);
    const routeDate = String(row.route || '').slice(0, 10);
    return {
      probe_ref: ref,
      inventory_drive_ref: row.inventory_drive_ref,
      dongle_group: dongleToGroup.get(row.dongle),
      route_date_key: routeDate,
    };
  });

  const greedy = greedyMarginalCoverageSelection({
    candidates,
    initialCoveredCells: activeCells,
    routeCellsByRef: routeCellMap,
    supportByRef,
  });

  const drive008Excluded = greedy.excluded.find((e) => e.probe_ref === 'drive-008');
  const drive008Selected = greedy.selected.includes('drive-008');

  const completenessRedacted = {
    schema: 'pintaz.bukit-probe.route-completeness.redacted',
    version: 1,
    complete_single_response_routes: completeCount,
    unmeasured_response_too_large: unmeasuredCount,
    partial_successful_routes: partialCount,
    routes: dongleGroupRoutes,
  };

  const overlapRedacted = {
    schema: 'pintaz.bukit-probe.pairwise-overlap.redacted',
    version: 1,
    active_route_baseline_cells: activeGrid.size,
    per_route: perRouteSpatial,
    pairwise: pairs,
    two_route_unions: twoCombos,
    three_route_unions: threeCombos,
  };

  const selectionRedacted = {
    schema: 'pintaz.bukit-probe.corrected-selection.redacted',
    version: 1,
    method: 'greedy_marginal_50m_cells',
    superseded_recommendation: ['drive-001', 'drive-005', 'drive-007'],
    selected_routes: greedy.selected,
    selection_trace: greedy.trace,
    excluded_complete_routes: greedy.excluded,
    oversized_unmeasured_routes: completenessRows
      .filter((r) => r.completeness_class === 'unmeasured_response_too_large')
      .map((r) => ({ probe_ref: r.probe_ref, dongle_group: dongleToGroup.get(r.dongle) })),
    drive_008: {
      selected: drive008Selected,
      rule_explanation: drive008Selected
        ? 'drive-008 selected by greedy marginal 50 m coverage (74 novel cells vs active on first pass ranking).'
        : drive008Excluded?.exclusion_reasons?.join('; ') ||
          'drive-008 excluded after greedy steps',
      novel_cells_vs_active_only: perRouteSpatial.find((p) => p.probe_ref === 'drive-008')
        ?.novel_cells_vs_active,
    },
    support_potential_by_route: completeRefs.map((ref) => ({
      probe_ref: ref,
      ...supportByRef.get(ref),
    })),
  };

  writeJson('route_completeness.redacted.json', completenessRedacted);
  writeJson('pairwise_overlap.redacted.json', overlapRedacted);
  writeJson('corrected_selection.redacted.json', selectionRedacted);

  writeReport(
    'ROUTE_COMPLETENESS_CORRECTION.md',
    `# Route completeness correction\n\n- **${completeCount}** \`complete_single_response_route\` (truncated:false, next_after_seg absent)\n- **${unmeasuredCount}** \`unmeasured_response_too_large\` (not “no pilot coverage”)\n- **${partialCount}** partial successful routes\n\nSuccessful stored responses are **full route payloads in one response**, not page-1 samples requiring pagination.\n`
  );
  writeReport(
    'DONGLE_GROUPS_REDACTED.md',
    `# Redacted dongle groups\n\n${dongleGroups
      .map((g) => `- **${g.dongle_group}**: ${g.probe_refs.join(', ')}`)
      .join('\n')}\n`
  );
  writeReport(
    'PAIRWISE_SPATIAL_OVERLAP.md',
    `# Pairwise spatial overlap (50 m grid)\n\n${pairs
      .map(
        (p) =>
          `- ${p.route_a} × ${p.route_b}: Jaccard ${p.jaccard.toFixed(3)}, shared ${p.shared_cells}, union ${p.union_cells}`
      )
      .join('\n')}\n`
  );
  writeReport(
    'CORRECTED_ROUTE_SELECTION.md',
    `# Corrected route selection\n\nGreedy marginal 50 m cells (baseline = active route).\n\n## Selected\n${greedy.selected.map((r) => `- ${r}`).join('\n') || '_none_'}\n\n## Trace\n\`\`\`json\n${JSON.stringify(greedy.trace, null, 2)}\n\`\`\`\n\n## drive-008\n${selectionRedacted.drive_008.rule_explanation}\n`
  );
  writeReport(
    'NEXT_MULTI_DRIVE_ANALYSIS.md',
    `# Next multi-drive analysis (design only)\n\n1. Keep raw/derived data separate per drive.\n2. Run pose-to-OSM matching independently per selected route.\n3. Build sections per drive; apply geometry/support/ambiguity gates per drive.\n4. Never connect frames across drives.\n5. Aggregate by OSM way after per-drive classification.\n6. Require cross-drive agreement before Pintaz map proposals.\n7. Preserve disagreements as diagnostics.\n\n## Preliminary cross-drive states (not implemented)\n\n- consistent_across_drives\n- possible_mismatch_supported_by_multiple_drives\n- single_drive_signal_only\n- conflicting_drive_evidence\n- insufficient_combined_evidence\n- not_evaluated\n`
  );

  writeReport(
    'FINAL_REPORT.md',
    `# Bukit page-1 probe — acceptance & selection V1\n\n- Complete single-response routes: **${completeCount}**\n- Unmeasured (too large): **${unmeasuredCount}**\n- Corrected selection (≤3): **${greedy.selected.join(', ')}**\n- Prior recommendation superseded.\n`
  );
  writeReport(
    'ROUTE_RECOMMENDATION.md',
    `# Route recommendation (corrected)\n\nGreedy 50 m marginal coverage selection:\n\n${greedy.selected.map((r) => `- **${r}**`).join('\n')}\n\nSupersedes earlier drive-001/005/007 pagination recommendation. Successful routes do **not** require complete pagination.\n`
  );
  writeReport(
    'LIMITATIONS.md',
    `# Limitations\n\n- Five shortlist entries remain \`unmeasured_response_too_large\` under the 25 MB cap (coverage unknown, not absent).\n- Five stored routes are \`complete_single_response_route\` in one HTTP response.\n- Selection uses 50 m vehicle-pose grid only (not path length).\n- Support metrics are potential-only; not mismatch-eligible until matching runs.\n`
  );

  writeJson('manifest.json', {
    task: 'bukit_probe_acceptance_selection_v1',
    generated_at: new Date().toISOString(),
    raw_hashes_recorded: Object.keys(rawHashes).length,
  });

  const blob = JSON.stringify({ completenessRedacted, overlapRedacted, selectionRedacted });
  if (containsFullDongle(blob)) throw new Error('redacted_leak');

  console.log(
    JSON.stringify(
      {
        ok: true,
        complete: completeCount,
        unmeasured: unmeasuredCount,
        selected: greedy.selected,
        drive_008_selected: drive008Selected,
      },
      null,
      2
    )
  );
}

main();
