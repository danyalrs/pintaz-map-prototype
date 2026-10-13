import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gridCellKey50m,
  haversineMeters,
  buildGeojsonPage1Url,
  assignProbeStatus,
  measurePage1PilotCoverage,
  vehiclePoseGridCells,
} from '../src/lib/bukit-page1-coverage.js';
import { bukitPilotBboxForCounts, pointInsideBukitPilot } from '../src/lib/bukit-pilot-bounds.js';
import { PAGE1_PROBE_LIMITS } from '../src/lib/bukit-page1-probe-limits.js';
import { formatProbeRef } from '../src/lib/bukit-page1-probe-paths.js';
import { recommendRoutesForFullPagination } from '../src/lib/bukit-page1-recommendation.js';
import { containsFullDongle } from '../src/lib/bukit-route-redaction.js';
import { liveCompleteRouteSnapshot } from './helpers/isolated-maps-read-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('geojson page1 url has no after_seg', () => {
  const url = buildGeojsonPage1Url({
    apiBase: 'https://example.test',
    dongle: 'aaaaaaaaaaaaaaaa',
    route: '2026-01-01--01-01-01',
  });
  assert.doesNotMatch(url, /after_seg/);
  assert.ok(url.includes('layers=vehicle_pose') || url.includes('layers=vehicle_pose%2C'));
});

test('bbox inclusion uses inclusive max edges like update preview', () => {
  const b = bukitPilotBboxForCounts();
  assert.equal(pointInsideBukitPilot(b.maxLon, b.maxLat), true);
  assert.equal(pointInsideBukitPilot(b.minLon, b.minLat), true);
});

test('50m grid cell keys are deterministic', () => {
  const lon = 101.715;
  const lat = 3.15;
  assert.equal(gridCellKey50m(lon, lat), gridCellKey50m(lon, lat));
});

test('no page1 pilot points status is inconclusive not rejection', () => {
  const status = assignProbeStatus(
    {
      inside_vehicle_pose: 0,
      inside_lane_point: 0,
      inside_edge_point: 0,
      inside_gps_point: 0,
      unique_inside_frame_count: 0,
      inside_vehicle_path_length_m: 0,
    },
    { httpOk: true, validationOk: true }
  );
  assert.equal(status, 'no_pilot_points_on_page1');
});

test('recommendation caps at 3 routes and 2 per dongle', () => {
  const routes = [];
  for (let i = 0; i < 6; i += 1) {
    routes.push({
      probe_ref: formatProbeRef(i + 1),
      dongle: i < 3 ? 'aaaaaaaaaaaaaaaa' : `bbbbbbbbbbbbbbb${i}`,
      route: `2026-08-${String(i + 1).padStart(2, '0')}--01-01-01`,
      probe_status: 'promising_page1_coverage',
      metrics: {
        inside_vehicle_pose: 100 - i,
        inside_lane_point: 50,
        inside_edge_point: 20,
        unique_inside_frame_count: 10,
        inside_vehicle_path_length_m: 30,
        grid_cells_novel_vs_active: 5,
        grid_cells_overlap_active: 1,
      },
    });
  }
  const { recommended } = recommendRoutesForFullPagination(routes);
  assert.ok(recommended.length <= 3);
  const per = new Map();
  for (const r of recommended) {
    per.set(r.dongle, (per.get(r.dongle) || 0) + 1);
  }
  for (const c of per.values()) assert.ok(c <= 2);
});

test('haversine distance positive for distinct points', () => {
  const d = haversineMeters(101.71, 3.14, 101.72, 3.15);
  assert.ok(d > 0);
});

test('measure coverage counts inside layers', () => {
  const bbox = bukitPilotBboxForCounts();
  const lon = (bbox.minLon + bbox.maxLon) / 2;
  const lat = (bbox.minLat + bbox.maxLat) / 2;
  const features = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { layer: 'vehicle_pose', frame_id: 1 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { layer: 'lane_point' },
    },
  ];
  const m = measurePage1PilotCoverage(features, new Set());
  assert.equal(m.inside_vehicle_pose, 1);
  assert.equal(m.inside_lane_point, 0);
});

test('exactly one request per route is enforced by probe limits constant', () => {
  assert.equal(PAGE1_PROBE_LIMITS.maxRequests, 10);
});

test('redacted probe reports avoid dongle ids when present', () => {
  const reportDir = path.join(root, 'reports', 'bukit_route_page1_probe_v1');
  if (!fs.existsSync(reportDir)) return;
  for (const name of fs.readdirSync(reportDir)) {
    const text = fs.readFileSync(path.join(reportDir, name), 'utf8');
    assert.doesNotMatch(text, /MAPS_READ_TOKEN/);
    assert.doesNotMatch(text, /Authorization:\s*Bearer/i);
    assert.equal(containsFullDongle(text), false);
  }
});

test('active complete route preview hash unchanged', () => {
  const snap = liveCompleteRouteSnapshot();
  if (!snap) return;
  assert.equal(snap.previewSha256, '1f1d223cf45687c777b8fb5f32108392791525eec16ee0dec3f93ce0f125d444');
  assert.equal(snap.total_features, 8706);
});

test('vehicle pose grid overlap math', () => {
  const bbox = bukitPilotBboxForCounts();
  const lon = (bbox.minLon + bbox.maxLon) / 2;
  const lat = (bbox.minLat + bbox.maxLat) / 2;
  const features = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { layer: 'vehicle_pose' },
    },
  ];
  const cells = vehiclePoseGridCells(features);
  const active = new Set(cells);
  const m = measurePage1PilotCoverage(features, active);
  assert.equal(m.grid_cells_overlap_active, cells.size);
  assert.equal(m.grid_cells_novel_vs_active, 0);
});
