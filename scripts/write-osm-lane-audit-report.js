import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { auditOsmRoadFeatures } from '../src/lib/lane-tag-audit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(root, 'reports', 'osm_lane_baseline_v1');
fs.mkdirSync(reportDir, { recursive: true });

const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath('bukit-bintang-imbi'), 'utf8'));
const audit = auditOsmRoadFeatures(roads.features);
fs.writeFileSync(path.join(reportDir, 'lane_tag_audit.json'), `${JSON.stringify(audit, null, 2)}\n`);

const lines = [
  '# OSM lane tag audit — Bukit Bintang–Imbi',
  '',
  `Feature count: **${audit.feature_count}**`,
  `Features with \`lanes\` tag present: **${audit.lanes_tag_present_count}**`,
  '',
  '## Per-tag summary',
  '',
  '| Tag | Present | Missing | Valid numeric | Invalid | Conditional/multiple | Outlier | Other |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];

for (const [tag, row] of Object.entries(audit.tags)) {
  lines.push(
    `| \`${tag}\` | ${row.present} | ${row.missing} | ${row.valid_numeric ?? 0} | ${row.invalid ?? 0} | ${row.conditional_or_multiple ?? 0} | ${row.outlier ?? 0} | ${row.other ?? 0} |`
  );
}

lines.push('', '## Highway counts (top 15)', '');
const hw = Object.entries(audit.highway_counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [k, v] of hw) lines.push(`- ${k}: ${v}`);

lines.push(
  '',
  '## Notes',
  '',
  '- OSM lane tags are incomplete; absence of `lanes` does not imply a single lane.',
  '- Width and lane display estimates are documented separately in lane interpretation rules.',
  '- Source GeoJSON was not modified by this audit.',
  ''
);

fs.writeFileSync(path.join(reportDir, 'OSM_LANE_TAG_AUDIT.md'), `${lines.join('\n')}\n`);
console.log(`Wrote ${reportDir}`);
