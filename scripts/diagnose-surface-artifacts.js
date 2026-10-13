/**
 * Diagnose legacy (pre-repair) road-surface artefacts using the old vertex-averaged bearing method.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { interpretOsmRoadProperties } from '../src/lib/lane-interpret.js';
import {
  analyseRoadSurfaceCandidate,
  lineStringToRoadSurfaceLegacy,
  lineLengthM,
  dedupeCoordinates,
  sharpestTurnDeg,
} from '../src/lib/lane-geometry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(root, 'reports', 'osm_lane_baseline_v1');
const CATEGORY_WIDTH = { motorway: 12, trunk: 10, primary: 9, secondary: 8, tertiary: 7, residential: 6, service: 5, unclassified: 6 };

const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath('bukit-bintang-imbi'), 'utf8'));
const spikes = [];
let maxAreaRatio = 0;
let maxExcessDist = 0;

for (const f of roads.features) {
  if (f.geometry?.type !== 'LineString') continue;
  const coords = f.geometry.coordinates;
  const len = lineLengthM(coords);
  const hw = f.properties?.highway;
  const interp = interpretOsmRoadProperties(f.properties, CATEGORY_WIDTH[hw] ?? 6);
  if (!interp.road_width_m) continue;
  const halfW = interp.road_width_m / 2;
  const poly = lineStringToRoadSurfaceLegacy(coords, halfW);
  if (!poly) continue;
  const analysis = analyseRoadSurfaceCandidate(poly, coords, halfW, len);
  if (analysis.area_ratio > maxAreaRatio) maxAreaRatio = analysis.area_ratio;
  if (analysis.max_excess_centreline_m > maxExcessDist) maxExcessDist = analysis.max_excess_centreline_m;
  const failsGate =
    !analysis.valid_ring ||
    analysis.self_intersects ||
    analysis.max_vertex_distance_m > halfW + 0.35 ||
    analysis.area_ratio > 1.75 ||
    analysis.area_ratio < 0.5;
  if (failsGate) {
    spikes.push({
      osm_id: String(f.properties.osm_id),
      name: f.properties.name ?? null,
      highway: f.properties.highway,
      lanes: f.properties.lanes ?? null,
      line_length_m: Math.round(len * 100) / 100,
      derived_width_m: interp.road_width_m,
      half_width_m: halfW,
      vertex_count: coords.length,
      sharpest_turn_deg: Math.round(sharpestTurnDeg(dedupeCoordinates(coords)) * 10) / 10,
      ...analysis,
    });
  }
}

spikes.sort((a, b) => b.max_excess_centreline_m - a.max_excess_centreline_m);
const top = spikes.slice(0, 40);

const md = [
  '# Surface artefact diagnosis (legacy generator)',
  '',
  '## Root cause',
  '',
  'The pre-repair `lineStringToRoadSurface` offset each vertex using a **naïve average of incoming/outgoing bearings** at interior points. On sharp bends this is **not** the angle bisector (and can be wrong across the 0°/360° wrap). Left/right offset chains were stitched into one ring **without proper join intersection or miter limiting**, producing:',
  '',
  '- **Self-intersecting rings** (bow-tie / triangular spikes)',
  '- **Vertices far beyond intended half-width** from the centreline',
  '- **Implausible polygon area** vs `line_length × width`',
  '',
  'This matches **incorrect left/right offset intersection at sharp turns** plus **unbounded effective miter extension**, not duplicate OSM features or width mis-reads.',
  '',
  '## Aggregate (legacy)',
  '',
  `- Features failing acceptance gates: **${spikes.length}**`,
  `- Max area ratio observed: **${Math.round(maxAreaRatio * 1000) / 1000}**`,
  `- Max excess centreline distance (m): **${Math.round(maxExcessDist * 100) / 100}**`,
  '',
  '## Example spike `osm_id` values (Jalan Sultan Ismail corridor and nearby bends)',
  '',
  ...top.slice(0, 15).map(
    (r) =>
      `- \`${r.osm_id}\` — ${r.name || 'unnamed'} — excess ${r.max_excess_centreline_m}m, area ratio ${r.area_ratio}, turn ${r.sharpest_turn_deg}°, self-intersect ${r.self_intersects}`
  ),
  '',
  '## Per-feature metrics (top 40)',
  '',
  '| osm_id | name | length m | width m | area ratio | max dist m | excess m | self-ix | turn ° |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
  ...top.map(
    (r) =>
      `| ${r.osm_id} | ${(r.name || '').replace(/\|/g, '/')} | ${r.line_length_m} | ${r.derived_width_m} | ${r.area_ratio} | ${r.max_vertex_distance_m} | ${r.max_excess_centreline_m} | ${r.self_intersects} | ${r.sharpest_turn_deg} |`
  ),
  '',
];

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'SURFACE_ARTIFACT_DIAGNOSIS.md'), `${md.join('\n')}\n`);
fs.writeFileSync(
  path.join(reportDir, 'surface_artifact_diagnosis.json'),
  `${JSON.stringify({ spike_count: spikes.length, max_area_ratio: maxAreaRatio, max_excess_m: maxExcessDist, top }, null, 2)}\n`
);
console.log(`Wrote diagnosis: ${spikes.length} failing features`);
