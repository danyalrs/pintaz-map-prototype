#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import {
  runRouteAwareLaneCalibrationAudit,
  MINIMUM_SUPPORT_POLICY,
  ROUTE_VERDICT,
  UNKNOWN_WAY_COVERAGE,
  DRIVE005_KAMUNING_WAY_ID,
} from '../src/lib/route-aware-lane-calibration-audit/index.js';
import { redactRouteKey } from '../src/lib/route-aware-lane-calibration-audit/redact.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'route_aware_lane_calibration_audit_v1');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function qualMatrixMarkdown(qualifications) {
  const header =
    '| Route | Verdict | Labelled ways | Eligible | Single exact% | Single incorrect | Abstain% | High-margin wrong | Multi exact% | Accepted frame % |';
  const sep =
    '|-------|---------|--------------:|---------:|--------------:|-----------------:|---------:|------------------:|-------------:|-----------------:|';
  const lines = qualifications.map((q) => {
    const s = q.held_out_single_best;
    const m = q.held_out_multi_frame;
    return `| ${redactRouteKey(q.route_key)} | ${q.route_verdict} | ${q.labelled_one_way_ways} | ${q.eligible_labelled_ways} | ${(s.exact_match_rate * 100).toFixed(1)}% | ${s.incorrect_candidate_count} | ${(s.abstention_rate * 100).toFixed(1)}% | ${s.high_margin_incorrect_count} | ${m ? (m.exact_match_rate * 100).toFixed(1) + '%' : '—'} | ${(q.source_quality.accepted_frame_fraction * 100).toFixed(1)}% |`;
  });
  return `${header}\n${sep}\n${lines.join('\n')}`;
}

function unknownSummaryMarkdown(rows) {
  const counts = {};
  for (const r of rows) counts[r.coverage_status] = (counts[r.coverage_status] || 0) + 1;
  return `| Status | Count |
|--------|------:|
| ${UNKNOWN_WAY_COVERAGE.NONE} | ${counts[UNKNOWN_WAY_COVERAGE.NONE] || 0} |
| ${UNKNOWN_WAY_COVERAGE.NOT_EVALUABLE} | ${counts[UNKNOWN_WAY_COVERAGE.NOT_EVALUABLE] || 0} |
| ${UNKNOWN_WAY_COVERAGE.UNQUALIFIED} | ${counts[UNKNOWN_WAY_COVERAGE.UNQUALIFIED] || 0} |
| ${UNKNOWN_WAY_COVERAGE.QUALIFIED} | ${counts[UNKNOWN_WAY_COVERAGE.QUALIFIED] || 0} |

Total unknown-lane ways with any local route observation: ${rows.filter((r) => r.route_observations.length).length}.`;
}

function main() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const audit = runRouteAwareLaneCalibrationAudit();

  writeJson(path.join(REPORT_DIR, 'route_metrics.redacted.json'), {
    schema: audit.version,
    minimum_support_policy: MINIMUM_SUPPORT_POLICY,
    routes: audit.redacted.route_metrics,
  });
  writeJson(path.join(REPORT_DIR, 'per_route_evaluation.redacted.json'), {
    schema: audit.version,
    rows: audit.redacted.per_route_evaluation,
  });
  writeJson(path.join(REPORT_DIR, 'unknown_way_coverage.redacted.json'), {
    schema: audit.version,
    rows: audit.redacted.unknown_way_coverage,
    kamuning_demonstration: audit.kamuning_demonstration
      ? {
          ...audit.kamuning_demonstration,
          osm_way_id: `way-${DRIVE005_KAMUNING_WAY_ID.slice(-6)}`,
        }
      : null,
  });

  writeText(
    path.join(REPORT_DIR, 'ROUTE_QUALIFICATION_MATRIX.md'),
    `# Route qualification matrix

Per-route leave-one-OSM-way-out calibration (same route frames only; no cross-route pooling).

## Minimum support policy

${MINIMUM_SUPPORT_POLICY.description}

\`\`\`json
${JSON.stringify(MINIMUM_SUPPORT_POLICY, null, 2)}
\`\`\`

${qualMatrixMarkdown(audit.qualifications)}
`
  );

  writeText(
    path.join(REPORT_DIR, 'UNKNOWN_OSM_COVERAGE_MATRIX.md'),
    `# Unknown OSM lane coverage (observation coverage only — not alignment)

${unknownSummaryMarkdown(audit.unknownCoverage)}

Lane counts are **not** inferred for unknown-OSM ways.
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Route-aware point-only lane calibration audit V1

## Conclusions

1. **Routes evaluable (LOO labelled support):** ${audit.conclusions.routes_evaluable.join(', ') || 'none'}
2. **Routes reliable for this experimental method:** ${audit.conclusions.routes_reliable_for_experimental_method.join(', ') || 'none'}
3. **Unknown-OSM ways with route coverage:** ${audit.conclusions.unknown_ways_with_any_route_coverage}
4. **Real enrichment candidate allowed:** **${audit.conclusions.real_enrichment_candidate_allowed}** — ${audit.conclusions.real_enrichment_note}

## Drive 005 / Jalan Kamuning (way …${String(audit.kamuning_demonstration?.osm_way_id || '').slice(-6)})

- Coverage status: \`${audit.kamuning_demonstration?.coverage_status ?? 'not_found'}\`
- drive-005 covers: ${audit.kamuning_demonstration?.demonstration?.drive_005_covers ?? false}
- **No confirmed lane count** (OSM lane tag unknown).

HEAD: \`${head}\` (\`${branch}\`)
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    protected_hashes_ok: protected_hashes.ok === true,
    head,
    branch,
    maps_read_api_called: false,
    cross_route_pooling: false,
    real_enrichment_candidate_allowed: false,
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-route-aware-lane-calibration-audit-v1.js
npm test -- tests/route-aware-lane-calibration-audit.test.js
`
  );

  console.log('qualified', audit.conclusions.routes_reliable_for_experimental_method);
  console.log('Wrote', REPORT_DIR);
}

main();
