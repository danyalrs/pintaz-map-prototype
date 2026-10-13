import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTurnGuidanceFeaturesForWay,
  buildTurnLaneGuidanceCollection,
  parseTurnLanesTag,
  selectEligibleTurnLaneTags,
  MOVEMENT_DISPLAY_GLYPH,
  turnGuidanceGlyphForMovement,
} from '../src/lib/osm-turn-lane-guidance.js';
import {
  turnGuidanceLayerDefinition,
  turnGuidanceLayerVisibility,
  TURN_GUIDANCE_MIN_ZOOM,
} from '../src/lib/turn-guidance-map-layer.js';
import { bearingDeg } from '../src/lib/lane-geometry.js';
import { buildLaneBaselineForArea } from '../src/lib/lane-baseline-build.js';
import { dividersPath, summaryPath } from '../src/lib/lane-baseline-paths.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { lookupSelectedRouteOsmComparison } from '../src/lib/selected-route-osm-comparison-lookup.js';
import { LANE_LAYER, TURN_GUIDANCE_SOURCE } from '../src/public/lane-baseline-layers.js';

const BUKIT = 'bukit-bintang-imbi';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lineFeature(osmId, coords, props = {}) {
  return {
    type: 'Feature',
    properties: { osm_id: osmId, highway: 'secondary', lanes: '3', ...props },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

function laneDividerGeometryDigest(areaId) {
  const geojson = JSON.parse(fs.readFileSync(dividersPath(areaId), 'utf8'));
  const norms = geojson.features
    .map((f) => JSON.stringify({ id: f.properties?.osm_id, g: f.geometry }))
    .sort();
  return crypto.createHash('sha256').update(norms.join('\n')).digest('hex');
}

test('oneway road with turn:lanes produces turn-guidance features', () => {
  const f = lineFeature('t1', [[101.71, 3.15], [101.711, 3.15]], {
    oneway: 'yes',
    'turn:lanes': 'left|through|right',
  });
  const { features, exclusions } = buildTurnGuidanceFeaturesForWay(f);
  assert.equal(exclusions.length, 0);
  assert.ok(features.length >= 3);
  assert.equal(features[0].properties.movement, 'left');
  assert.equal(features[0].properties.glyph, '⬅');
  assert.equal(features[1].properties.movement, 'through');
  assert.equal(features[1].properties.glyph, '↑');
  assert.equal(features[2].properties.movement, 'right');
  assert.equal(features[2].properties.glyph, '➡');
});

test('each supported OSM movement maps to a distinct display glyph', () => {
  for (const [movement, glyph] of Object.entries(MOVEMENT_DISPLAY_GLYPH)) {
    assert.equal(turnGuidanceGlyphForMovement(movement), glyph);
  }
  assert.equal(turnGuidanceGlyphForMovement('left'), '⬅');
  assert.equal(turnGuidanceGlyphForMovement('through'), '↑');
  assert.equal(turnGuidanceGlyphForMovement('u_turn'), '↩');
});

test('turn guidance layer uses glyph field and is visible only when toggle on', () => {
  const def = turnGuidanceLayerDefinition('test-turn-layer', 'test-source');
  assert.equal(def.minzoom, TURN_GUIDANCE_MIN_ZOOM);
  assert.equal(def.layout['text-field'][1], 'glyph');
  assert.equal(def.layout['text-allow-overlap'], true);
  assert.equal(turnGuidanceLayerVisibility(true), 'visible');
  assert.equal(turnGuidanceLayerVisibility(false), 'none');
});

test('turn:lanes:forward renders along OSM forward direction', () => {
  const coords = [[101.71, 3.15], [101.7102, 3.15]];
  const f = lineFeature('t2', coords, { 'turn:lanes:forward': 'through' });
  const { features } = buildTurnGuidanceFeaturesForWay(f);
  assert.equal(features.length, 1);
  const expected = bearingDeg(coords[0][0], coords[0][1], coords[1][0], coords[1][1]);
  assert.equal(features[0].properties.orientation, 'forward');
  assert.equal(Math.round(features[0].properties.bearing), Math.round(expected));
});

test('turn:lanes:backward renders in reverse OSM direction', () => {
  const coords = [[101.71, 3.15], [101.7102, 3.15]];
  const f = lineFeature('t3', coords, { 'turn:lanes:backward': 'through' });
  const { features } = buildTurnGuidanceFeaturesForWay(f);
  assert.equal(features.length, 1);
  const forward = bearingDeg(coords[0][0], coords[0][1], coords[1][0], coords[1][1]);
  const expected = (forward + 180) % 360;
  assert.equal(features[0].properties.orientation, 'backward');
  assert.equal(Math.round(features[0].properties.bearing), Math.round(expected));
});

test('generic turn:lanes on two-way road is excluded', () => {
  const f = lineFeature('t4', [[101.71, 3.15], [101.711, 3.15]], {
    oneway: 'no',
    'turn:lanes': 'left|through|right',
  });
  const { features, exclusions } = buildTurnGuidanceFeaturesForWay(f);
  assert.equal(features.length, 0);
  assert.ok(exclusions.includes('two_way_ambiguous_turn_lanes'));
});

test('malformed and missing turn tags produce no guidance', () => {
  const missing = lineFeature('t5', [[101.71, 3.15], [101.711, 3.15]], { oneway: 'yes' });
  assert.equal(buildTurnGuidanceFeaturesForWay(missing).features.length, 0);

  const bad = lineFeature('t6', [[101.71, 3.15], [101.711, 3.15]], {
    oneway: 'yes',
    'turn:lanes': 'left|none|right',
  });
  const badOut = buildTurnGuidanceFeaturesForWay(bad);
  assert.equal(badOut.features.length, 0);
  assert.ok(badOut.exclusions.some((e) => e.includes('unsupported_movement')));

  assert.equal(parseTurnLanesTag('').ok, false);
  assert.equal(parseTurnLanesTag('|through').ok, false);
});

test('turn guidance layer id and source are defined for UI toggle', () => {
  assert.equal(LANE_LAYER.turnGuidance, 'pintaz-turn-lane-guidance-symbols');
  assert.equal(TURN_GUIDANCE_SOURCE, 'pintaz-turn-lane-guidance');
  const html = fs.readFileSync(path.join(root, 'src', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="lane-baseline-turn-guidance-toggle"/);
  assert.match(html, /Show OSM turn guidance/);
  assert.doesNotMatch(html, /id="lane-baseline-turn-guidance-toggle" checked/);
});

test('turn guidance does not alter lane baseline artifacts', () => {
  const beforeSummary = JSON.parse(fs.readFileSync(summaryPath(BUKIT), 'utf8'));
  const digestBefore = laneDividerGeometryDigest(BUKIT);
  const a = buildLaneBaselineForArea(BUKIT);
  const b = buildLaneBaselineForArea(BUKIT);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const afterSummary = JSON.parse(fs.readFileSync(summaryPath(BUKIT), 'utf8'));
  assert.equal(afterSummary.counts.dividers_generated, 776);
  assert.equal(afterSummary.counts.unknown_lane_count, 2711);
  assert.equal(afterSummary.counts.dividers_generated, beforeSummary.counts.dividers_generated);
  assert.equal(afterSummary.counts.unknown_lane_count, beforeSummary.counts.unknown_lane_count);
  assert.equal(laneDividerGeometryDigest(BUKIT), digestBefore);
  assert.equal(
    laneDividerGeometryDigest(BUKIT),
    '48b437b4cc0d71a5012a0517bec7b6fb0981a6507ee9d2de7b1df0a99ae5ed72'
  );
});

test('comparison lookup unchanged for audit slice', () => {
  const row = lookupSelectedRouteOsmComparison('active', '252085334');
  if (!row.comparison_available) return;
  assert.equal(row.comparison_result, 'alignment_consistent');
  assert.equal(row.osm_lane_count, 3);
});

test('bukit turn-lane guidance API returns features and metrics', async () => {
  if (!fs.existsSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID))) return;
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const { port } = server.address();
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/lane-baseline/v1/${BUKIT}/turn-lane-guidance.geojson`
    );
    assert.equal(res.ok, true);
    const body = await res.json();
    assert.ok(Array.isArray(body.features));
    assert.ok(body.metrics.eligible_roads > 0);
    assert.ok(body.metrics.guidance_point_features > 0);
    const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(BUKIT), 'utf8'));
    const offline = buildTurnLaneGuidanceCollection(roads);
    assert.equal(body.features.length, offline.features.length);
    assert.equal(body.metrics.eligible_roads, offline.metrics.eligible_roads);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('verified eligible way 1042088509 maps OSM slots to distinct glyphs', () => {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(BUKIT), 'utf8'));
  const f = roads.features.find((x) => String(x.properties?.osm_id) === '1042088509');
  assert.ok(f);
  assert.equal(f.properties['turn:lanes'], 'left;through|through|slight_right');
  const { features } = buildTurnGuidanceFeaturesForWay(f);
  assert.equal(features.length, 3);
  assert.deepEqual(
    features.map((x) => ({ movement: x.properties.movement, glyph: x.properties.glyph })),
    [
      { movement: 'left', glyph: '⬅' },
      { movement: 'through', glyph: '↑' },
      { movement: 'slight_right', glyph: '↗' },
    ]
  );
});

test('selectEligibleTurnLaneTags respects oneway and directional tags', () => {
  const twoWay = selectEligibleTurnLaneTags({ lanes: '2', 'turn:lanes': 'through|through' });
  assert.equal(twoWay.selected.length, 0);
  assert.ok(twoWay.exclusions.includes('two_way_ambiguous_turn_lanes'));

  const oneWay = selectEligibleTurnLaneTags({ lanes: '2', oneway: 'yes', 'turn:lanes': 'through|through' });
  assert.equal(oneWay.selected.length, 1);
  assert.equal(oneWay.selected[0].tagKey, 'turn:lanes');
});
