import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPilotAreaConfig,
  validateBounds,
  isInsidePilotBounds,
  paddedBounds,
  boundsToFitCoordinates,
  lonLatToTile,
} from '../src/lib/pilot-area.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('pilot configuration schema', () => {
  const pilot = loadPilotAreaConfig();
  assert.ok(pilot);
  assert.equal(pilot.pilotAreaId, 'bandar-kinrara-puchong');
  assert.match(pilot.displayName, /Bandar Kinrara/);
  assert.equal(typeof pilot.defaultZoom, 'number');
  assert.equal(pilot.minDetailedRoadZoom, 10);
});

test('valid bounding-box ordering', () => {
  const pilot = loadPilotAreaConfig();
  const v = validateBounds(pilot.bounds);
  assert.equal(v.ok, true);
  assert.equal(validateBounds({ west: 1, south: 0, east: 0, north: 1 }).ok, false);
});

test('initial view lies inside pilot bounds', () => {
  const pilot = loadPilotAreaConfig();
  const [lon, lat] = pilot.defaultCenter;
  assert.equal(isInsidePilotBounds(lon, lat, pilot.bounds), true);
});

test('fit pilot uses configured bounds', () => {
  const pilot = loadPilotAreaConfig();
  const fit = boundsToFitCoordinates(pilot.bounds);
  assert.deepEqual(fit[0], [pilot.bounds.west, pilot.bounds.south]);
  assert.deepEqual(fit[1], [pilot.bounds.east, pilot.bounds.north]);
});

test('inside/outside boundary detection', () => {
  const pilot = loadPilotAreaConfig();
  assert.equal(isInsidePilotBounds(101.645, 3.046, pilot.bounds), true);
  assert.equal(isInsidePilotBounds(110, 4, pilot.bounds), false);
});

test('maxBounds padding expands bounds', () => {
  const pilot = loadPilotAreaConfig();
  const padded = paddedBounds(pilot.bounds, 0.1);
  assert.ok(padded.west < pilot.bounds.west);
  assert.ok(padded.east > pilot.bounds.east);
});

test('zoom warning copy in client module', () => {
  const client = fs.readFileSync(path.join(root, 'src', 'public', 'pilot-area-client.js'), 'utf8');
  assert.match(client, /Zoom in to level 10 or higher/);
  assert.match(client, /Outside the current pilot road coverage/);
});

test('pilot config file still present for debug', () => {
  const pilot = loadPilotAreaConfig();
  assert.ok(pilot);
});

test('no token in pilot reports', () => {
  const reportPath = path.join(root, 'reports', 'pilot_area', 'coverage_audit.json');
  if (!fs.existsSync(reportPath)) return;
  const text = fs.readFileSync(reportPath, 'utf8');
  assert.doesNotMatch(text, /pk\.ey[a-zA-Z0-9]{20,}/);
});

test('kinrara tile coords at z14', () => {
  const t = lonLatToTile(101.645, 3.046, 14);
  assert.equal(t.x, 12817);
  assert.equal(t.y, 8053);
});
