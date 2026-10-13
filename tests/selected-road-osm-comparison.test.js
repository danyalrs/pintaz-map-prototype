import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lookupSelectedRouteOsmComparison,
  normalizeOsmWayId,
} from '../src/lib/selected-route-osm-comparison-lookup.js';
import { roadSectionsPath } from '../src/lib/comparison-paths.js';
import { routeComparisonDir } from '../src/lib/local-route-explorer/paths.js';
import {
  formatOsmVsSelectedRouteBlock,
  comparisonResultBadgeLabel,
} from '../src/public/osm-vs-selected-route-panel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'src', 'public');

function comparisonDataReady(routeKey) {
  return fs.existsSync(roadSectionsPath(routeComparisonDir(routeKey)));
}

async function withTestServer(fn) {
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

test('normalizeOsmWayId accepts numeric and float-shaped ids', () => {
  assert.equal(normalizeOsmWayId(779663464), '779663464');
  assert.equal(normalizeOsmWayId('779663464.0'), '779663464');
  assert.equal(normalizeOsmWayId(' 39914067 '), '39914067');
});

test('active Jalan Sultan Ismail way 252085334 alignment_consistent', () => {
  if (!comparisonDataReady('active')) return;
  const row = lookupSelectedRouteOsmComparison('active', '252085334');
  assert.equal(row.comparison_available, true);
  assert.equal(row.osm_lane_count, 3);
  assert.equal(row.osm_lane_count_label, '3');
  assert.equal(row.comparison_result, 'alignment_consistent');
  assert.equal(row.route_state_label, 'Active route — production active');
  assert.equal(row.proposal_status, 'No production proposal — OSM baseline agrees');
  assert.equal(row.observation_counts.vehicle_frames, 25);
});

test('drive-008 Jalan Tun Razak way 779663464 matches audit slice', () => {
  if (!comparisonDataReady('drive-008')) return;
  const row = lookupSelectedRouteOsmComparison('drive-008', '779663464');
  assert.equal(row.comparison_available, true);
  assert.equal(row.osm_lane_count, 4);
  assert.equal(row.comparison_result, 'insufficient_evidence');
  assert.equal(row.first_failed_gate, 'min_frames');
  assert.equal(row.observation_counts.vehicle_frames, 7);
  assert.equal(row.observation_counts.lane_observations, 56);
  assert.equal(row.observation_counts.edge_observations, 28);
  assert.equal(row.proposal_status, 'Diagnostic route — no production proposal');
  assert.equal(row.route_state_label, 'Diagnostic local route — does not change production active source');
});

test('drive-005 Jalan Kamuning 39914067 has insufficient-evidence row', () => {
  if (!comparisonDataReady('drive-005')) return;
  const row = lookupSelectedRouteOsmComparison('drive-005', '39914067');
  assert.equal(row.comparison_available, true);
  assert.equal(row.osm_lane_count, null);
  assert.equal(row.osm_lane_count_label, 'Lane count unknown');
  assert.equal(row.comparison_result, 'insufficient_evidence');
  assert.equal(row.proposal_status, 'Diagnostic route — no production proposal');
});

test('drive-005 way 503668959 has not_evaluated comparison row when bundle exists', () => {
  if (!comparisonDataReady('drive-005')) return;
  const row = lookupSelectedRouteOsmComparison('drive-005', '503668959');
  assert.equal(row.comparison_available, true);
  assert.equal(row.comparison_result, 'not_evaluated');
  assert.equal(row.first_failed_gate, 'outside_observation_corridor_or_no_pose_match');
  assert.equal(row.observation_counts.vehicle_frames, 0);
});

test('not_evaluated row renders badge and gate, not missing-route stub', () => {
  const html = formatOsmVsSelectedRouteBlock({
    comparison_available: true,
    route_label: 'Drive 005',
    route_state_label: 'Diagnostic local route — does not change production active source',
    osm_lane_count_label: 'Lane count unknown',
    comparison_result: 'not_evaluated',
    first_failed_gate: 'outside_observation_corridor_or_no_pose_match',
    observation_counts: { vehicle_frames: 0, lane_observations: 0, edge_observations: 0 },
    proposal_status: 'Diagnostic route — no production proposal',
  });
  assert.match(html, /Not evaluated for this route/);
  assert.match(html, /outside_observation_corridor_or_no_pose_match/);
  assert.doesNotMatch(html, /<p class="muted small">Not evaluated for this route<\/p>/);
});

test('format block shows aligned badge for case A', () => {
  const html = formatOsmVsSelectedRouteBlock({
    comparison_available: true,
    route_label: 'Active route — production active',
    route_state_label: 'Active route — production active',
    osm_lane_count_label: '3',
    comparison_result: 'alignment_consistent',
    first_failed_gate: null,
    observation_counts: { vehicle_frames: 25, lane_observations: 200, edge_observations: 100 },
    proposal_status: 'No production proposal — OSM baseline agrees',
  });
  assert.equal(comparisonResultBadgeLabel('alignment_consistent'), 'Aligned with OSM baseline');
  assert.match(html, /Aligned with OSM baseline/);
  assert.match(html, /No production proposal — OSM baseline agrees/);
  assert.match(html, /green comparison-section highlight/);
});

test('format block shows insufficient evidence and min_frames for case B', () => {
  const html = formatOsmVsSelectedRouteBlock({
    comparison_available: true,
    route_label: 'Drive 008 — local diagnostic / coverage-expansion candidate',
    route_state_label: 'Diagnostic local route — does not change production active source',
    osm_lane_count_label: '4',
    comparison_result: 'insufficient_evidence',
    first_failed_gate: 'min_frames',
    observation_counts: { vehicle_frames: 7, lane_observations: 56, edge_observations: 28 },
    proposal_status: 'Diagnostic route — no production proposal',
  });
  assert.match(html, /Insufficient evidence/);
  assert.match(html, /min_frames/);
  assert.match(html, />7</);
  assert.match(html, />56</);
  assert.match(html, />28</);
});

test('comparison way API returns drive-008 Tun Razak audit values', async () => {
  if (!comparisonDataReady('drive-008')) return;
  await withTestServer(async (base) => {
    const res = await fetch(
      `${base}/api/local-route-explorer/v1/routes/drive-008/comparison/way/779663464`
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.comparison.comparison_available, true);
    assert.equal(body.comparison.comparison_result, 'insufficient_evidence');
    assert.equal(body.comparison.first_failed_gate, 'min_frames');
    assert.equal(body.comparison.observation_counts.vehicle_frames, 7);
  });
});

test('public modules share one observation-route-state cache query', () => {
  const files = fs.readdirSync(publicDir).filter((n) => n.endsWith('.js'));
  const versions = new Set();
  for (const f of files) {
    const t = fs.readFileSync(path.join(publicDir, f), 'utf8');
    const re = /observation-route-state\.js\?v=([^'"]+)/g;
    let m;
    while ((m = re.exec(t))) versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `expected one cache key, got: ${[...versions].join(', ')}`);
  assert.equal(versions.values().next().value, 'osm-turn-lane-guidance-v2');
});

test('selected road panel module is wired in map-selection', () => {
  const src = fs.readFileSync(path.join(root, 'src/public/map-selection.js'), 'utf8');
  assert.match(src, /osm-vs-selected-route-panel/);
  assert.match(src, /getObservationRouteKey\(\)/);
});
