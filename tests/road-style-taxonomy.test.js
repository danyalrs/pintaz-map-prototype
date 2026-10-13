import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHighway,
  categoryHighwayFilter,
  elevationFilter,
  widthExpression,
  casingWidthExpression,
  labelTextField,
  labelFilter,
  layerOrderKeys,
  isTunnelFilter,
  isBridgeFilter,
} from '../src/lib/road-style-taxonomy.js';
import {
  detailedRoadLayerDefinitions,
  expectedLayerIdOrder,
  DETAILED_FILL_LAYER_IDS,
} from '../src/public/detailed-road-layers.js';
import { formatRoadInfo, ROAD_INFO_KEYS } from '../src/lib/road-click-info.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('classifyHighway maps OSM classes to draw categories', () => {
  assert.equal(classifyHighway('motorway_link'), 'motorway_trunk');
  assert.equal(classifyHighway('living_street'), 'local');
  assert.equal(classifyHighway('footway'), 'footway_path_track');
  assert.equal(classifyHighway('corridor'), 'corridor_elevator');
  assert.equal(classifyHighway('mystery_road'), 'other');
  assert.equal(classifyHighway(undefined), 'other');
});

test('width expressions are deterministic interpolate arrays', () => {
  const w = widthExpression('primary');
  assert.equal(w[0], 'interpolate');
  assert.equal(casingWidthExpression('primary')[0], 'interpolate');
});

test('elevation filters separate tunnel, bridge, and ground', () => {
  const cat = categoryHighwayFilter('primary');
  const tunnel = elevationFilter('tunnel', cat);
  const bridge = elevationFilter('bridge', cat);
  const ground = elevationFilter('ground', cat);
  assert.deepEqual(tunnel[1], cat);
  assert.deepEqual(tunnel[2], isTunnelFilter());
  assert.deepEqual(bridge[2], isBridgeFilter());
  assert.equal(ground[0], 'all');
});

test('label prefers name then ref', () => {
  assert.deepEqual(labelTextField(), ['coalesce', ['get', 'name'], ['get', 'ref']]);
  const f = labelFilter();
  assert.equal(f[0], 'any');
});

test('formatRoadInfo shows Not provided for missing fields', () => {
  const text = formatRoadInfo({ osm_id: '1', highway: 'primary' });
  assert.match(text, /osm_id: 1/);
  assert.match(text, /name: Not provided/);
  assert.equal(ROAD_INFO_KEYS.length, 12);
});

test('layer definition order matches expected stack', () => {
  const defs = detailedRoadLayerDefinitions();
  const ids = defs.map((l) => l.id);
  assert.deepEqual(ids, expectedLayerIdOrder());
  const keys = layerOrderKeys();
  assert.equal(keys.length, DETAILED_FILL_LAYER_IDS.length * 2 + 3);
});

test('no MAPS_READ_TOKEN in public styling sources', () => {
  const files = [
    'src/public/app.js',
    'src/public/detailed-road-layers.js',
    'src/public/road-display-options.js',
    'src/lib/road-style-taxonomy.js',
    'src/lib/road-click-info.js',
  ];
  for (const rel of files) {
    const body = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(body, /MAPS_READ_TOKEN/);
    assert.doesNotMatch(body, /maps-read\.kommu\.ai/);
  }
});
