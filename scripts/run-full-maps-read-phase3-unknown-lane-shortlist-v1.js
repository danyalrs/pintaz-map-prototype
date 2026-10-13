#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { runPhase3UnknownLaneShortlist } from '../src/lib/full-maps-read-route-enrichment-discovery/run-phase3-shortlist.js';
import { REPORT_DIR_NAME } from '../src/lib/full-maps-read-route-enrichment-discovery/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const REPORT_DIR = path.join(ROOT_DIR, 'reports', REPORT_DIR_NAME);

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

async function main() {
  const token = (process.env.MAPS_READ_TOKEN || '').trim();
  if (!token) {
    console.error('MAPS_READ_TOKEN missing');
    process.exit(2);
  }

  const result = await runPhase3UnknownLaneShortlist({ token });

  writeJson(path.join(REPORT_DIR, 'phase3_shortlist.redacted.json'), {
    schema: result.version,
    coverage_summary: result.coverage_summary,
    qualification_progress: result.qualification_progress,
    way_status_counts: result.way_status_counts,
    pair_status_counts: result.pair_status_counts,
    top_future_geometry_candidates: result.top_future_geometry_candidates.map((p) => ({
      ...p,
      osm_way_id: `way-${String(p.osm_way_id).slice(-6)}`,
    })),
    target_ways: result.target_ways,
    shortlist_statement: result.shortlist_statement,
    next_single_action: result.next_single_action,
  });

  writeJson(path.join(REPORT_DIR, 'phase3_way_status_counts.json'), {
    schema: result.version,
    unknown_lane_ways_with_coverage: result.coverage_summary.unknown_lane_ways_with_coverage,
    counts_by_best_way_status: result.way_status_counts,
    pair_status_counts: result.pair_status_counts,
  });

  writeJson(path.join(REPORT_DIR, 'phase3_geojson_parse_summary.json'), result.geojson_parse_stats);

  const topLines = result.top_future_geometry_candidates.length
    ? result.top_future_geometry_candidates
        .map(
          (p, i) =>
            `${i + 1}. ${p.route_ref} × ${p.osm_way_id} poses=${p.matched_pose_count} score=${p.shortlist_ranking_score.toFixed(2)}`
        )
        .join('\n')
    : '_None in this run (qualification or geometry gates)._';

  writeText(
    path.join(REPORT_DIR, 'PHASE3_UNKNOWN_LANE_SHORTLIST.md'),
    `# Phase 3 — unknown-lane future-geometry shortlist

${result.shortlist_statement}

${result.point_only_statement}

## Coverage index

- Routes indexed: **${result.coverage_summary.catalog_routes_indexed}**
- Unknown-lane ways with route coverage: **${result.coverage_summary.unknown_lane_ways_with_coverage}**
- Route × way pair rows: **${result.coverage_summary.way_row_pairs}**

## Route qualification progress

- Routes with qualification record: **${result.qualification_progress.routes_qualified_total}** / **${result.coverage_summary.distinct_routes_in_coverage}**
- Pending this cycle: **${result.qualification_progress.routes_pending}**
- Routes passing held-out labelled-way screen (\`route_qualified_for_experiment\`): **${result.qualification_progress.routes_qualified_for_future_geometry}**
- Batch processed this run: **${result.qualification_progress.batch_processed_this_run}**

## Unknown-way status counts (best status per way, n=${result.coverage_summary.unknown_lane_ways_with_coverage})

${Object.entries(result.way_status_counts)
  .map(([k, v]) => `- \`${k}\`: **${v}**`)
  .join('\n')}

## Top 20 future-geometry candidates

${topLines}

## Jalan Kamuning (39914067)

\`\`\`json
${JSON.stringify(result.target_ways.jalan_kamuning_39914067, null, 2)}
\`\`\`

## Lorong Kuda (706737045)

\`\`\`json
${JSON.stringify(result.target_ways.lorong_kuda_706737045, null, 2)}
\`\`\`

## Next action

${result.next_single_action}
`
  );

  console.log('phase3', {
    routes_completed_total: result.qualification_progress.routes_completed_total,
    routes_pending: result.qualification_progress.routes_pending,
    batch_processed_this_run: result.qualification_progress.batch_processed_this_run,
    batch_first_route_id: result.qualification_progress.batch_first_route_id,
    batch_last_route_id: result.qualification_progress.batch_last_route_id,
    retryable_failure_count: result.qualification_progress.retryable_failure_count,
    routes_qualified_for_future_geometry: result.qualification_progress.routes_qualified_for_future_geometry,
    before: result.qualification_progress.before_run,
  });
  console.log('Wrote', REPORT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
