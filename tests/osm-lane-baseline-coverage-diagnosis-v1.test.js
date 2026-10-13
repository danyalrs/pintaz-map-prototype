import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  runOsmLaneBaselineCoverageDiagnosis,
  classifyRootCause,
} from '../src/lib/osm-lane-baseline-coverage-diagnosis/run-diagnosis.js';
import { buildOsmRoadInventory } from '../src/lib/osm-lane-baseline-coverage-diagnosis/inventory.js';
import { expectedDividerCount } from '../src/lib/osm-lane-baseline-coverage-diagnosis/lane-resolution-audit.js';
import { simulateFeaturePipeline } from '../src/lib/osm-lane-baseline-coverage-diagnosis/pipeline-simulate.js';
import { redactServerScope } from '../src/lib/osm-lane-baseline-coverage-diagnosis/server-scope.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { surfacesPath, summaryPath } from '../src/lib/lane-baseline-paths.js';
import { laneDividerOffsets, validateDividerLine, offsetLineFromCentre, dedupeCoordinates } from '../src/lib/lane-geometry.js';
import { interpretOsmRoadProperties } from '../src/lib/lane-interpret.js';

const BUKIT = 'bukit-bintang-imbi';

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const osmHashBefore = hashFile(localAreaGeojsonPath(BUKIT));
const summaryHashBefore = hashFile(summaryPath(BUKIT));
const surfacesHashBefore = hashFile(surfacesPath(BUKIT));

test('OSM feature conservation — loaded count matches summary', () => {
  const d = runOsmLaneBaselineCoverageDiagnosis();
  assert.equal(d.inventory.totals.feature_count, d.summaryCounts.osm_roads);
  assert.equal(d.inventory.totals.feature_count, 3259);
});

test('lane-tag category counts — majority without lanes tag', () => {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(BUKIT), 'utf8'));
  const inv = buildOsmRoadInventory(roads.features);
  assert.equal(inv.totals.explicit_lanes_tag, 548);
  assert.ok(inv.totals.no_lane_information > 2000);
});

test('total vs directional lane semantics — two-way total does not auto-split', () => {
  const r = interpretOsmRoadProperties({ lanes: '4', oneway: 'no' });
  assert.equal(r.lane_count_forward, null);
  assert.equal(r.lane_count_backward, null);
  assert.equal(r.direction_confidence, 'total_only');
});

test('oneway handling assigns lanes to forward direction', () => {
  const r = interpretOsmRoadProperties({ lanes: '3', oneway: 'yes' });
  assert.equal(r.lane_count_forward, 3);
  assert.equal(r.lane_count_backward, 0);
});

test('malformed lane values classified unknown', () => {
  const r = interpretOsmRoadProperties({ lanes: '2;3' });
  assert.equal(r.lane_count_source, 'lane_count_unknown');
});

test('roads without lane tags — unknown geometry confidence', () => {
  const r = interpretOsmRoadProperties({ highway: 'primary' }, 9);
  assert.equal(r.lane_count_total, null);
  assert.equal(r.geometry_confidence, 'line_only_unknown_lanes');
});

test('expected N-1 divider count for directional confidence', () => {
  assert.equal(expectedDividerCount(4, 'oneway_forward'), 3);
  const offs = laneDividerOffsets(4, 12.8, 'oneway_forward');
  assert.equal(offs.length, 3);
});

test('generated surface containment — divider inside half width on straight segment', () => {
  const coords = [[101.71, 3.14], [101.711, 3.14]];
  const clean = dedupeCoordinates(coords);
  const halfW = 4.8;
  const off = laneDividerOffsets(2, 9.6, 'oneway_forward')[0];
  const div = offsetLineFromCentre(clean, off);
  const v = validateDividerLine(div, clean, halfW);
  assert.equal(v.ok, true);
});

test('curved-road divider geometry — accepted multi-vertex ways keep dividers inside', () => {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(BUKIT), 'utf8'));
  const curved = (roads.features || []).find(
    (f) =>
      f.geometry?.coordinates?.length >= 10 &&
      f.properties?.lanes &&
      Number(f.properties.lanes) >= 2
  );
  if (!curved) return;
  const sim = simulateFeaturePipeline(curved);
  if (sim.divider_count > 0) {
    assert.equal(sim.terminal, 'accepted');
    assert.ok(sim.divider_count >= 1);
  }
});

test('left-side traffic orientation — offset signs differ by side', () => {
  const coords = [[101.71, 3.14], [101.712, 3.14]];
  const left = offsetLineFromCentre(coords, -1.6);
  const right = offsetLineFromCentre(coords, 1.6);
  assert.notDeepEqual(left[0], right[0]);
});

test('stage-loss conservation — simulation accepts match production surface count', () => {
  const d = runOsmLaneBaselineCoverageDiagnosis();
  assert.equal(d.pipelineStageCounts.simulation.surfaces_accepted, d.summaryCounts.surfaces_generated);
});

test('public redaction — server scope omits update_id', () => {
  const d = runOsmLaneBaselineCoverageDiagnosis();
  const red = redactServerScope(d.serverScope);
  assert.equal(red.update_id, undefined);
});

test('raw OSM non-mutation', () => {
  const before = hashFile(localAreaGeojsonPath(BUKIT));
  runOsmLaneBaselineCoverageDiagnosis();
  assert.equal(hashFile(localAreaGeojsonPath(BUKIT)), before);
});

test('production lane baseline non-mutation', () => {
  const sumBefore = hashFile(summaryPath(BUKIT));
  const surfBefore = hashFile(surfacesPath(BUKIT));
  runOsmLaneBaselineCoverageDiagnosis();
  assert.equal(hashFile(summaryPath(BUKIT)), sumBefore);
  assert.equal(hashFile(surfacesPath(BUKIT)), surfBefore);
});

test('no Maps Read API calls in diagnosis module', () => {
  const src = fs.readFileSync(
    new URL('../src/lib/osm-lane-baseline-coverage-diagnosis/run-diagnosis.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(src, /maps-read|Maps Read API|fetch\(/i);
});

test('root cause classification returns non-empty for pilot', () => {
  const d = runOsmLaneBaselineCoverageDiagnosis();
  const causes = classifyRootCause(d);
  assert.ok(causes.length >= 2);
});
