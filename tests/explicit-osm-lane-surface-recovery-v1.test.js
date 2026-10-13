import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  dedupeCoordinates,
  lineStringToRoadSurface,
  lineStringToRoadSurfaceLegacy,
  validateRoadSurface,
  lineLengthM,
  maxDistanceToCentrelineM,
  pointToSegmentDistanceM,
  ringSelfIntersects,
  validateDividerLine,
  offsetLineFromCentre,
  laneDividerOffsets,
} from '../src/lib/lane-geometry.js';
import { interpretOsmRoadProperties } from '../src/lib/lane-interpret.js';
import { parsePositiveInt } from '../src/lib/lane-tag-parse.js';
import { buildLaneBaselineForArea } from '../src/lib/lane-baseline-build.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { surfacesPath, dividersPath, summaryPath } from '../src/lib/lane-baseline-paths.js';
import { laneBaselineSummarySemanticDigestFromJsonText } from '../src/lib/lane-baseline-semantic-digest.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';

const BUKIT = 'bukit-bintang-imbi';

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('maxDistanceToCentrelineM uses per-vertex minimum distance', () => {
  const coords = [
    [101.71, 3.14],
    [101.72, 3.14],
    [101.73, 3.14],
  ];
  const halfW = 3.2;
  const poly = lineStringToRoadSurface(coords, halfW);
  const ring = poly.coordinates[0];
  let wrongMax = 0;
  for (const [lon, lat] of ring.slice(0, -1)) {
    for (let i = 0; i < coords.length - 1; i++) {
      wrongMax = Math.max(
        wrongMax,
        pointToSegmentDistanceM(lon, lat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
      );
    }
  }
  const fixed = maxDistanceToCentrelineM(ring, coords);
  assert.ok(wrongMax > halfW + 50, 'legacy aggregation inflates distance on long polylines');
  assert.ok(fixed <= halfW + 0.5, `fixed max ${fixed} should stay near half-width`);
});

test('valid straight surface remains accepted', () => {
  const coords = [[101.71, 3.14], [101.715, 3.14]];
  const halfW = 3.2;
  const len = lineLengthM(coords);
  const poly = lineStringToRoadSurface(coords, halfW);
  assert.equal(validateRoadSurface(poly, coords, halfW, len).ok, true);
});

test('gentle curve surface accepted when topology sound', () => {
  const coords = [
    [101.71, 3.14],
    [101.712, 3.141],
    [101.714, 3.142],
    [101.716, 3.143],
  ];
  const halfW = 3.2;
  const len = lineLengthM(coords);
  const poly = lineStringToRoadSurface(coords, halfW);
  assert.equal(validateRoadSurface(poly, coords, halfW, len).ok, true);
});

test('self-intersection remains rejected', () => {
  const hairpin = [
    [101.71, 3.147],
    [101.7115, 3.147],
    [101.7115, 3.1485],
    [101.71, 3.1485],
  ];
  const half = 4.8;
  const legacy = lineStringToRoadSurfaceLegacy(hairpin, half);
  const val = validateRoadSurface(legacy, hairpin, half, 120);
  assert.equal(val.reason, 'self_intersects');
});

test('non-finite coordinates rejected at surface build', () => {
  const poly = lineStringToRoadSurface([[101.71, 3.14], [NaN, 3.15]], 3);
  assert.equal(poly, null);
});

test('divider containment on straight two-lane road', () => {
  const coords = [[101.71, 3.14], [101.72, 3.14]];
  const halfW = 3.2;
  const off = laneDividerOffsets(2, 6.4, 'oneway_forward')[0];
  const div = offsetLineFromCentre(coords, off);
  assert.equal(validateDividerLine(div, coords, halfW).ok, true);
});

test('lane-tagged recovery increases osm_derived surfaces', () => {
  const summary = JSON.parse(fs.readFileSync(summaryPath(BUKIT), 'utf8'));
  const surfaces = JSON.parse(fs.readFileSync(surfacesPath(BUKIT), 'utf8'));
  const osmDerived = surfaces.features.filter((f) => f.properties.surface_role === 'osm_derived').length;
  assert.ok(summary.counts.with_usable_lane_count === 548);
  assert.ok(osmDerived >= 540, `expected most lane-tagged ways surfaced, got ${osmDerived}`);
  assert.ok(summary.counts.dividers_generated > 284);
});

test('unknown-lane classification unchanged — no invented lane counts', () => {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(BUKIT), 'utf8'));
  let unknown = 0;
  for (const f of roads.features) {
    const r = interpretOsmRoadProperties(f.properties || {}, 6);
    if (r.lane_count_source === 'lane_count_unknown') unknown += 1;
  }
  assert.equal(unknown, 2711);
});

test('deterministic lane baseline regeneration', () => {
  const a = buildLaneBaselineForArea(BUKIT);
  const b = buildLaneBaselineForArea(BUKIT);
  assert.deepEqual(a.counts, b.counts);
  const d1 = laneBaselineSummarySemanticDigestFromJsonText(fs.readFileSync(summaryPath(BUKIT), 'utf8'));
  const d2 = laneBaselineSummarySemanticDigestFromJsonText(fs.readFileSync(summaryPath(BUKIT), 'utf8'));
  assert.equal(d1, d2);
});

test('protected OSM input hashes unchanged', () => {
  const r = verifyProtectedInputHashes();
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});

test('raw OSM extract hash unchanged', () => {
  const expected = hashFile(localAreaGeojsonPath(BUKIT));
  assert.equal(
    expected,
    'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111'
  );
});
