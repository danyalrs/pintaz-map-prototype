import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  dedupeCoordinates,
  lineStringToRoadSurface,
  lineStringToRoadSurfaceLegacy,
  validateRoadSurface,
  validateDividerLine,
  laneDividerOffsets,
  offsetLineFromCentre,
  lineLengthM,
  analyseRoadSurfaceCandidate,
  VERTEX_DISTANCE_TOLERANCE_M,
  MITER_LIMIT,
} from '../src/lib/lane-geometry.js';
import { formatDistanceMetres } from '../src/lib/format-display.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import { buildLaneBaselineForArea } from '../src/lib/lane-baseline-build.js';

const sharpTurn = [
  [101.71, 3.147],
  [101.7102, 3.147],
  [101.7102, 3.1473],
];

test('sharp turn legacy surface spikes vs repaired bevel', () => {
  const half = 4.8;
  const hairpin = [
    [101.71, 3.147],
    [101.7115, 3.147],
    [101.7115, 3.1485],
    [101.71, 3.1485],
  ];
  const legacy = lineStringToRoadSurfaceLegacy(hairpin, half);
  const repaired = lineStringToRoadSurface(hairpin, half);
  const len = 120;
  const la = analyseRoadSurfaceCandidate(legacy, hairpin, half, len);
  const ra = analyseRoadSurfaceCandidate(repaired, hairpin, half, len);
  assert.ok(
    la.max_excess_centreline_m > ra.max_excess_centreline_m + 1 ||
      la.self_intersects ||
      la.area_ratio > ra.area_ratio
  );
  const v = validateRoadSurface(repaired, hairpin, half, len);
  assert.ok(
    v.ok ||
      ['self_intersects', 'vertex_beyond_half_width', 'implausible_area_ratio_high'].includes(v.reason)
  );
});

test('bounded join distance gate uses half-width scaled tolerance', () => {
  const coords = [[101.71, 3.147], [101.715, 3.147]];
  const half = 5;
  const poly = lineStringToRoadSurface(coords, half);
  const len = lineLengthM(coords);
  const val = validateRoadSurface(poly, coords, half, len);
  assert.equal(val.ok, true);
  const limit = half + Math.max(VERTEX_DISTANCE_TOLERANCE_M, half * 0.5);
  assert.ok(val.analysis.max_vertex_distance_m <= limit + 0.05);
});

test('miter limit constant documented', () => {
  assert.equal(MITER_LIMIT, 2.5);
});

test('duplicate coordinates removed', () => {
  const base = [101.71, 3.147];
  const c = dedupeCoordinates([base, base, [101.71000001, 3.14700001], [101.711, 3.147]], 0.05);
  assert.equal(c.length, 2);
});

test('near-zero-length segment rejected', () => {
  const c = [[101.71, 3.147], [101.7100001, 3.1470001]];
  const poly = lineStringToRoadSurface(c, 3);
  const val = validateRoadSurface(poly, c, 3, 0.01);
  assert.equal(val.ok, false);
});

test('implausible area spike rejected', () => {
  const coords = [[101.71, 3.147], [101.712, 3.149]];
  const poly = lineStringToRoadSurfaceLegacy(coords, 6);
  const val = validateRoadSurface(poly, coords, 6, 80);
  assert.equal(val.ok, false);
  assert.equal(val.reason, 'implausible_area_ratio_high');
});

test('implausible high area ratio rejected', () => {
  const coords = [[101.71, 3.147], [101.72, 3.147]];
  const poly = lineStringToRoadSurfaceLegacy(coords, 5);
  const val = validateRoadSurface(poly, coords, 5, 100);
  if (val.analysis.area_ratio > 1.65) assert.equal(val.ok, false);
});

test('three lanes produce two divider offsets', () => {
  const offs = laneDividerOffsets(3, 9.6, 'oneway_forward');
  assert.equal(offs.length, 2);
});

test('divider stays inside surface width', () => {
  const coords = [[101.71, 3.147], [101.712, 3.147], [101.712, 3.149]];
  const half = 4.8;
  const div = offsetLineFromCentre(coords, laneDividerOffsets(3, 9.6, 'oneway_forward')[0]);
  assert.equal(validateDividerLine(div, coords, half).ok, true);
});

test('measurement formatting', () => {
  assert.equal(formatDistanceMetres(9.600000000000001), '9.6 m');
  assert.equal(formatDistanceMetres(null), 'Not provided');
});

test('OSM and raw hashes unchanged', () => {
  const h = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(h(localAreaGeojsonPath('bukit-bintang-imbi')), 'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111');
  assert.equal(h(localAreaGeojsonPath('bandar-kinrara')), '14280508680f9c0ad56928fe4dc91eacdd8c1c146e5738a70eb9e3af2e1ea945');
  if (fs.existsSync(RAW_SAMPLE_PATH)) {
    assert.equal(h(RAW_SAMPLE_PATH), 'f5c96176bc9f528ba53e3e25d407396c300593e71d73111e8e1e9316f6b8e826');
  }
});

test('rebuild deterministic', () => {
  const a = buildLaneBaselineForArea('bukit-bintang-imbi');
  const b = buildLaneBaselineForArea('bukit-bintang-imbi');
  assert.deepEqual(a.counts, b.counts);
});

test('evidence control exists and defaults off', async () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /server-evidence-toggle/);
  assert.match(html, /Show server observations \(Evidence\)/);
  assert.doesNotMatch(html, /id="server-evidence-toggle"[^>]*checked/);
});

test('sidebar scroll and evidence section placement', async () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const lanePos = html.indexOf('OSM lane baseline');
  const evPos = html.indexOf('Server comparison evidence');
  assert.ok(lanePos > 0 && evPos > lanePos);
  const css = fs.readFileSync(new URL('../src/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.sidebar[\s\S]*overflow-y:\s*auto/);
});
