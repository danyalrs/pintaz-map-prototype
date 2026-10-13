import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  formatTurnLanesDisplay,
  collectOsmSemantics,
  hasUsableOsmLaneCount,
  propsForLaneCountInterpretation,
} from '../src/lib/osm-lane-semantics.js';
import { formatSelectedRoadCard } from '../src/lib/road-lane-info.js';
import { interpretOsmRoadProperties } from '../src/lib/lane-interpret.js';
import { dividersPath, surfacesPath } from '../src/lib/lane-baseline-paths.js';
import { pickTags } from '../src/lib/road-tags.js';

const BUKIT = 'bukit-bintang-imbi';

function laneDividerGeometryDigest(areaId) {
  const geojson = JSON.parse(fs.readFileSync(dividersPath(areaId), 'utf8'));
  const norms = geojson.features
    .map((f) => JSON.stringify({ id: f.properties?.osm_id, g: f.geometry }))
    .sort();
  return crypto.createHash('sha256').update(norms.join('\n')).digest('hex');
}

test('pickTags retains directional and turn-lane keys from OSM tags', () => {
  const picked = pickTags({
    highway: 'secondary',
    lanes: '3',
    'lanes:forward': '2',
    'turn:lanes': 'left|through|right',
    'turn:lanes:forward': 'through|right',
    maxspeed: '50',
    surface: 'asphalt',
    bridge: 'yes',
  });
  assert.equal(picked.lanes, '3');
  assert.equal(picked['lanes:forward'], '2');
  assert.equal(picked['turn:lanes'], 'left|through|right');
  assert.equal(picked['turn:lanes:forward'], 'through|right');
  assert.equal(picked.maxspeed, '50');
  assert.equal(picked.surface, 'asphalt');
  assert.equal(picked.bridge, 'yes');
});

test('formatTurnLanesDisplay pipe and semicolon movements', () => {
  assert.equal(formatTurnLanesDisplay('left|through|right'), 'left | through | right');
  assert.equal(
    formatTurnLanesDisplay('left;through|right'),
    'left / through | right'
  );
});

test('known-lane road shows turn and directional metadata in selected road card', () => {
  const props = {
    osm_id: '999001',
    highway: 'secondary',
    name: 'Test Road',
    lanes: '3',
    'turn:lanes': 'left|through|right',
    'lanes:forward': '2',
    maxspeed: '50',
    surface: 'asphalt',
    oneway: 'yes',
  };
  const derived = interpretOsmRoadProperties(props, 8);
  assert.equal(hasUsableOsmLaneCount(derived), true);
  const text = formatSelectedRoadCard(props, derived);
  assert.match(text, /turn:lanes: left\|through\|right/);
  assert.match(text, /turn:lanes \(display\): left \| through \| right/);
  assert.match(text, /lanes:forward: 2/);
  assert.match(text, /maxspeed: 50/);
  assert.match(text, /surface: asphalt/);
});

test('unknown-lane road omits semantic block and shows Not provided for bridge', () => {
  const props = { osm_id: '999002', highway: 'footway', bridge: 'yes' };
  const derived = interpretOsmRoadProperties(props, 6);
  assert.equal(hasUsableOsmLaneCount(derived), false);
  const text = formatSelectedRoadCard(props, derived);
  assert.doesNotMatch(text, /OSM lane semantics/);
  assert.doesNotMatch(text, /turn:lanes/);
  assert.match(text, /bridge: yes/);
});

test('lane baseline divider geometry unchanged (checkpoint digest)', () => {
  assert.equal(
    laneDividerGeometryDigest(BUKIT),
    '48b437b4cc0d71a5012a0517bec7b6fb0981a6507ee9d2de7b1df0a99ae5ed72',
    'divider coordinates must match pre-enrichment checkpoint'
  );
  assert.equal(fs.existsSync(surfacesPath(BUKIT)), true);
});

test('directional tags do not alter lane-count interpretation', () => {
  const props = { lanes: '3', 'lanes:forward': '2', 'lanes:backward': '1' };
  const base = interpretOsmRoadProperties(propsForLaneCountInterpretation(props), 8);
  const naive = interpretOsmRoadProperties(props, 8);
  assert.equal(base.lane_count_source, 'osm_lanes_total');
  assert.equal(base.lane_count_total, 3);
  assert.equal(naive.lane_count_source, 'osm_directional_tags');
});

test('collectOsmSemantics preserves raw strings', () => {
  const { raw, display } = collectOsmSemantics({
    'turn:lanes:backward': 'left|merge',
  });
  assert.equal(raw['turn:lanes:backward'], 'left|merge');
  assert.equal(display['turn:lanes:backward'], 'left | merge');
});
