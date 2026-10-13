import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeMapFitPadding,
  MIN_FIT_MARGIN_PX,
  OUTLINE_STROKE_INSET_PX,
  boundsCornersInsideSafeArea,
  projectBoundsCorners,
} from '../src/public/fit-local-area.js';
import {
  detailedRoadLayerDefinitions,
  DETAILED_FILL_LAYER_IDS,
} from '../src/public/detailed-road-layers.js';
import { WIDTH_STOPS } from '../src/lib/road-style-taxonomy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mockContainer(width, height, controlRects = []) {
  const cRect = { top: 0, left: 0, right: width, bottom: height, width, height };
  return {
    getBoundingClientRect: () => cRect,
    querySelectorAll: () =>
      controlRects.map((r) => ({
        getBoundingClientRect: () => r,
      })),
  };
}

test('fit padding meets minimum margin on empty map panel', () => {
  const pad = computeMapFitPadding(mockContainer(1080, 900));
  const min = MIN_FIT_MARGIN_PX + OUTLINE_STROKE_INSET_PX;
  assert.ok(pad.top >= min);
  assert.ok(pad.right >= min);
  assert.ok(pad.bottom >= min);
  assert.ok(pad.left >= min);
});

test('fit padding grows for bottom-left attribution and scale', () => {
  const w = 1366;
  const h = 768;
  const scale = {
    top: h - 28,
    left: 8,
    right: 108,
    bottom: h - 4,
    width: 100,
    height: 24,
  };
  const pad = computeMapFitPadding(mockContainer(w, h, [scale]));
  assert.ok(pad.bottom >= MIN_FIT_MARGIN_PX + 24);
});

test('fit padding grows for top-right navigation cluster', () => {
  const w = 1920;
  const h = 1080;
  const nav = {
    top: 8,
    left: w - 48,
    right: w - 8,
    bottom: 88,
    width: 40,
    height: 80,
  };
  const pad = computeMapFitPadding(mockContainer(w, h, [nav]));
  assert.ok(pad.top >= MIN_FIT_MARGIN_PX + 40);
  assert.ok(pad.right >= MIN_FIT_MARGIN_PX + 40);
});

test('bounds corner projection helper returns four points', () => {
  const bounds = { west: 1, south: 2, east: 3, north: 4 };
  const map = {
    project: ([lng, lat]) => ({ x: lng * 10, y: lat * 10 }),
  };
  const pts = projectBoundsCorners(map, bounds);
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], { x: 10, y: 20 });
});

test('safe-area check accepts corners inside padded inset', () => {
  const bounds = { west: 0, south: 0, east: 1, north: 1 };
  const padding = { top: 30, right: 30, bottom: 50, left: 30 };
  const container = mockContainer(800, 600);
  const map = {
    project: () => ({ x: 400, y: 300 }),
  };
  assert.equal(boundsCornersInsideSafeArea(map, bounds, padding, container), true);
});

test('app uses dynamic fit helper', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'public', 'app.js'), 'utf8');
  assert.match(app, /fitMapToBounds/);
  assert.doesNotMatch(app, /padding:\s*28/);
});

test('minor road layers have higher contrast and service thinner than local', () => {
  const layers = detailedRoadLayerDefinitions();
  const local = layers.find((l) => l.id === 'pintaz-road-ground-local-fill');
  const service = layers.find((l) => l.id === 'pintaz-road-ground-service-fill');
  const path = layers.find((l) => l.id === 'pintaz-road-ground-footway_path_track-fill');
  assert.equal(local.paint['line-opacity'], 0.92);
  assert.ok(path.paint['line-dasharray']);
  const localAt13 = WIDTH_STOPS.local.find(([z]) => z === 13)[1];
  const serviceAt13 = WIDTH_STOPS.service.find(([z]) => z === 13)[1];
  assert.ok(serviceAt13 < localAt13);
});

test('clickable layer ids cover all road categories', () => {
  const expected = [
    'pintaz-road-ground-motorway_trunk-fill',
    'pintaz-road-ground-primary-fill',
    'pintaz-road-ground-secondary-fill',
    'pintaz-road-ground-tertiary-fill',
    'pintaz-road-ground-local-fill',
    'pintaz-road-ground-service-fill',
    'pintaz-road-ground-footway_path_track-fill',
    'pintaz-road-ground-other-fill',
  ];
  for (const id of expected) {
    assert.ok(DETAILED_FILL_LAYER_IDS.includes(id), `missing ${id}`);
  }
});
