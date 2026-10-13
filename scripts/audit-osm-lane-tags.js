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
console.log(JSON.stringify(audit, null, 2));
