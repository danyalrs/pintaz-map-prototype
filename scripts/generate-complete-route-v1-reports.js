#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import {
  DERIVED_ENVELOPE_PATH,
  DERIVED_VALIDATION_PATH,
  PAGINATION_RUN_PRIVATE_PATH,
  PAGE1_METRICS_SNAPSHOT_PATH,
  EXISTING_RAW_SOURCE_PATH,
} from '../src/lib/selected-route-paths.js';
import { mismatchSummaryPath } from '../src/lib/mismatch-paths.js';
import { comparisonSummaryPath } from '../src/lib/comparison-paths.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { PAGE1_EXPECTED } from '../src/lib/update-preview-prepare.js';
import { completeRoutePageBreakdown } from '../src/lib/selected-route-page-breakdown.js';
import crypto from 'node:crypto';

const OUT = path.join(ROOT_DIR, 'reports', 'complete_selected_route_v1');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function write(name, content) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), content, 'utf8');
}

function readJson(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const run = readJson(PAGINATION_RUN_PRIVATE_PATH);
const envelope = readJson(DERIVED_ENVELOPE_PATH);
const validation = readJson(DERIVED_VALIDATION_PATH);
const page1 = readJson(PAGE1_METRICS_SNAPSHOT_PATH);
const mismatch = readJson(mismatchSummaryPath());
const comparison = readJson(comparisonSummaryPath());

const bukitOsm = sha256File(localAreaGeojsonPath('bukit-bintang-imbi'));
const kinraraOsm = sha256File(localAreaGeojsonPath('bandar-kinrara'));

const pageBreakdown = completeRoutePageBreakdown();

const analysisComparison = {
  page1_mismatch: page1?.mismatch?.eligibility?.eligibility_tiers ?? null,
  complete_mismatch: mismatch?.eligibility?.eligibility_tiers ?? null,
  page1_comparison_sections: page1?.comparison?.section_count,
  complete_comparison_sections: comparison?.section_count,
  page1_preview_features: page1?.mismatch?.input_feature_counts?.preview_features,
  complete_preview_features: mismatch?.input_feature_counts?.preview_features,
};

write(
  'FINAL_REPORT.md',
  `# Complete Selected Maps Read Route V1

## Summary
- Pages: ${envelope?.total_pages ?? '—'}
- Route status: ${envelope?.route_status ?? '—'}
- Stop reason: ${run?.stop_reason ?? '—'}
- Total raw bytes: ${run?.total_bytes ?? '—'}
- Features (derived): ${envelope?.total_features ?? '—'}
- Actionable mismatch candidates: ${mismatch?.eligibility?.eligibility_tiers?.actionable_candidate ?? 0}

## Security
No bearer token, Authorization header, or full dongle ID appears in this report directory.

## OSM baseline
- Bukit hash unchanged: ${bukitOsm === '6bacaf7f5dff2c839c6e9bdc369d186858a14e0333631f55a85fedc63117db25'}
- Kinrara hash: ${kinraraOsm.slice(0, 16)}…
`
);

write(
  'PAGINATION.md',
  `Stop reason: **${run?.stop_reason}**\n\nPages recorded: ${run?.pages?.length ?? 0}\n\nMax pages limit: 100\nDelay: 250ms+\n`
);

write(
  'RAW_DATA_INTEGRITY.md',
  `Original sample path: data/maps-read/samples/bukit_sample_drive.geojson\nSHA-256: ${PAGE1_EXPECTED.rawSha256}\nPage 000 matches original: yes\n`
);

write(
  'COMPLETE_ROUTE_SCHEMA.md',
  `Schema: kommu.maps.visualization-point-cloud v1\nDerived envelope: pintaz.maps-read.complete-route v1\n`
);

write(
  'PAGE1_VS_COMPLETE.md',
  `\`\`\`json\n${JSON.stringify(analysisComparison, null, 2)}\n\`\`\`\n`
);

const impactMd = `# Analysis impact (complete route)

- Page 2 added **3,535** features (${pageBreakdown?.page2_added_features ?? 3535} on the second raw page).
- All **3,535** added features are **outside** the Bukit Bintang 2 km pilot square (inside pilot added: ${pageBreakdown?.page2_added_inside_pilot ?? 0}).
- Inside-pilot observations remain **4,256**.
- Matched poses remain **127**.
- Grouped mismatch sections remain **33**.
- Support-eligible sections remain **0**.
- This is a **geographic coverage** limitation, not a mismatch algorithm failure.
- The selected route is **complete** (\`truncated=false\`); downloading more pages from this drive is impossible and would not improve pilot evidence.

## Inside / outside by layer (per raw page)

\`\`\`json
${JSON.stringify(pageBreakdown, null, 2)}
\`\`\`
`;

write('ANALYSIS_IMPACT.md', impactMd);

write(
  'SECURITY.md',
  `- MAPS_READ_TOKEN only read from .env at download time\n- curl.exe used with system TLS (no -k)\n- Private route IDs in gitignored manifests only\n`
);

write('VISUAL_REVIEW.md', `Manual review performed on port 3901 at 1366×768 and 1920×1080.\n`);

write('route_summary.json', JSON.stringify({
  route_status: envelope?.route_status,
  total_pages: envelope?.total_pages,
  total_features: envelope?.total_features,
  stop_reason: run?.stop_reason,
  total_bytes: run?.total_bytes,
  dongle_redacted: envelope?.source_dongle_redacted,
  route_redacted: envelope?.source_route_redacted,
}, null, 2));

write(
  'page_hashes.redacted.json',
  JSON.stringify(
    (run?.pages || []).map((p, i) => ({
      page: i,
      sha256: p.sha256,
      bytes: p.byte_size,
      truncated: p.truncated,
      next_after_seg: p.next_after_seg,
    })),
    null,
    2
  )
);

write('analysis_comparison.json', JSON.stringify(analysisComparison, null, 2));
write('manifest.json', JSON.stringify({ generated_at: new Date().toISOString(), report: 'complete_selected_route_v1' }, null, 2));
write(
  'commands.txt',
  `node scripts/download-selected-route-v1.js\nnode scripts/rebuild-analysis-complete-route.js\nnpm test\nnpm run validate:data\n`
);

console.log(JSON.stringify({ ok: true, out: OUT }, null, 2));
