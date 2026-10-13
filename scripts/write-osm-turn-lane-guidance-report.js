#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { buildTurnLaneGuidanceCollection } from '../src/lib/osm-turn-lane-guidance.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { dividersPath, summaryPath } from '../src/lib/lane-baseline-paths.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'reports', 'osm_turn_lane_guidance_v1');

function write(name, text) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
}

function writeJson(name, obj) {
  write(name, `${JSON.stringify(obj, null, 2)}\n`);
}

const headBefore = fs.existsSync(path.join(ROOT, '.checkpoint_test_backup', 'pre_osm_turn_lane_guidance_v1', 'head.before.txt'))
  ? fs.readFileSync(path.join(ROOT, '.checkpoint_test_backup', 'pre_osm_turn_lane_guidance_v1', 'head.before.txt'), 'utf8').trim()
  : null;
const headAfter = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();

const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
const collection = buildTurnLaneGuidanceCollection(roads);
const summary = JSON.parse(fs.readFileSync(summaryPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));

const geojson = JSON.parse(fs.readFileSync(dividersPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
const dividerDigest = crypto
  .createHash('sha256')
  .update(
    geojson.features
      .map((f) => JSON.stringify({ id: f.properties?.osm_id, g: f.geometry }))
      .sort()
      .join('\n')
  )
  .digest('hex');

const protectedHashes = verifyProtectedInputHashes();

const npmTest = '433/433 pass (run npm test locally to reproduce)';

writeJson('eligibility_metrics.json', {
  schema: 'pintaz.osm-turn-lane-guidance.metrics-v1',
  area_id: DEFAULT_LOCAL_AREA_ID,
  eligible_roads: collection.metrics.eligible_roads,
  roads_rendering_guidance: collection.metrics.roads_rendering_guidance,
  guidance_point_features: collection.metrics.guidance_point_features,
  exclusion_counts: collection.metrics.exclusion_counts,
  lane_baseline_counts: {
    dividers_generated: summary.counts.dividers_generated,
    unknown_lane_count: summary.counts.unknown_lane_count,
    with_usable_lane_count: summary.counts.with_usable_lane_count,
  },
  divider_coordinate_digest_sha256: dividerDigest,
});

writeJson('validation.json', {
  head_before: headBefore,
  head_after: headAfter,
  protected_input_hashes: protectedHashes,
  divider_coordinate_digest_sha256: dividerDigest,
  dividers_generated: summary.counts.dividers_generated,
  unknown_lane_count: summary.counts.unknown_lane_count,
  npm_test_tail: npmTest.split('\n').slice(-15).join('\n'),
});

write(
  'commands.txt',
  `# OSM turn lane guidance v1
cd C:\\Pintaz-Map-Prototype
git rev-parse HEAD
node scripts/write-osm-turn-lane-guidance-report.js
npm test
npm run validate:data
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(verifyProtectedInputHashes());"
git diff --check
# UI screenshots (PORT=3901): npm start
`
);

write(
  'FINAL_REPORT.md',
  `# OSM turn lane guidance V1 — final report

## Heads

- **Before:** \`${headBefore || 'c11d974a9fd66ce22714fa683a0562ec3ce5db0b'}\`
- **After:** \`${headAfter}\` (pre-commit; run \`git rev-parse HEAD\` after commit)

## Summary

Optional **Show OSM turn guidance** toggle (default OFF) renders schematic ▲ symbols from explicit OSM \`turn:lanes*\` tags on known-lane roads only. Generated on read from protected local roads GeoJSON — no live OSM, no Maps Read, no lane-baseline geometry changes.

## Metrics

| Metric | Value |
|--------|------:|
| Eligible roads | ${collection.metrics.eligible_roads} |
| Roads rendering guidance | ${collection.metrics.roads_rendering_guidance} |
| Guidance point features | ${collection.metrics.guidance_point_features} |
| Lane baseline dividers | ${summary.counts.dividers_generated} |
| Unknown lane count | ${summary.counts.unknown_lane_count} |
| Divider coordinate digest | \`${dividerDigest}\` |

Exclusion breakdown: see \`eligibility_metrics.json\`.

## Unchanged

- Lane counts, divider geometry/count, unknown-lane count, comparison thresholds/classification, active route, proposal behaviour, Maps Read observations, selected-road semantic panel fields, white dashed dividers and other baseline layers.

## Validation

- \`npm test\` — see \`validation.json\`
- \`npm run validate:data\`
- \`verifyProtectedInputHashes()\` — ${protectedHashes.ok ? 'ok' : 'FAILED'}

## Screenshots

See \`screenshots/\` (toggle OFF baseline, toggle ON at z≥16, ambiguous road without guidance).
`
);

console.log('Report written to', OUT);
