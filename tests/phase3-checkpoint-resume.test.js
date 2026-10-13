import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadPhase3Checkpoint,
  persistPhase3RouteResult,
  selectPhase3Batch,
  countPhase3Progress,
  isPhase3RouteCompleted,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-checkpoint.js';

function tempCheckpointPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-ck-')), 'phase3-route-qualification.json');
}

function completedRow(routeRef, verdict = 'route_not_evaluable') {
  return {
    route_ref: routeRef,
    route_fetch_status: 'ok',
    route_verdict: verdict,
    labelled_ways_on_route: 1,
    eligible_labelled_ways: 0,
    disqualification_reasons: [],
  };
}

test('phase3 resume: batch 2 of 3 then 1 then 0', () => {
  const ckPath = tempCheckpointPath();
  const routesNeeded = ['route-1', 'route-2', 'route-3'];
  let checkpoint = loadPhase3Checkpoint(ckPath);

  const run1 = selectPhase3Batch(routesNeeded, checkpoint.routes, 2);
  assert.deepEqual(run1.batch, ['route-1', 'route-2']);
  persistPhase3RouteResult(checkpoint, 'route-1', completedRow('route-1'), ckPath);
  persistPhase3RouteResult(checkpoint, 'route-2', completedRow('route-2'), ckPath);
  checkpoint = loadPhase3Checkpoint(ckPath);
  assert.equal(Object.keys(checkpoint.routes).length, 2);

  const run2 = selectPhase3Batch(routesNeeded, checkpoint.routes, 2);
  assert.deepEqual(run2.batch, ['route-3']);
  persistPhase3RouteResult(checkpoint, 'route-3', completedRow('route-3'), ckPath);
  checkpoint = loadPhase3Checkpoint(ckPath);

  const run3 = selectPhase3Batch(routesNeeded, checkpoint.routes, 2);
  assert.deepEqual(run3.batch, []);
});

test('loadPhase3Checkpoint preserves stale_lookup_failures metadata', () => {
  const ckPath = tempCheckpointPath();
  const checkpoint = loadPhase3Checkpoint(ckPath);
  checkpoint.stale_lookup_failures = { 'drive-1': { completion_status: 'stale_lookup_failure' } };
  checkpoint.reconciliation = { last_run_at: '2026-01-01T00:00:00.000Z' };
  fs.writeFileSync(ckPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  const loaded = loadPhase3Checkpoint(ckPath);
  assert.ok(loaded.stale_lookup_failures['drive-1']);
  assert.equal(loaded.reconciliation.last_run_at, '2026-01-01T00:00:00.000Z');
});

test('retryable malformed route stays pending', () => {
  const ckPath = tempCheckpointPath();
  const routesNeeded = ['route-a', 'route-b'];
  const checkpoint = loadPhase3Checkpoint(ckPath);
  persistPhase3RouteResult(
    checkpoint,
    'route-a',
    {
      route_fetch_status: 'malformed_response',
      parse_reason: 'json_parse_failed',
      retryable: true,
      route_verdict: null,
    },
    ckPath
  );
  const loaded = loadPhase3Checkpoint(ckPath);
  assert.equal(isPhase3RouteCompleted(loaded.routes['route-a']), false);
  const { batch } = selectPhase3Batch(routesNeeded, loaded.routes, 10);
  assert.deepEqual(batch, ['route-a', 'route-b']);
});

test('existing checkpoint rows preserved on append', () => {
  const ckPath = tempCheckpointPath();
  let checkpoint = loadPhase3Checkpoint(ckPath);
  persistPhase3RouteResult(checkpoint, 'route-1', completedRow('route-1', 'route_not_qualified'), ckPath);
  checkpoint = loadPhase3Checkpoint(ckPath);
  const prior = JSON.stringify(checkpoint.routes['route-1']);
  persistPhase3RouteResult(checkpoint, 'route-2', completedRow('route-2'), ckPath);
  checkpoint = loadPhase3Checkpoint(ckPath);
  assert.equal(JSON.stringify(checkpoint.routes['route-1']), prior);
  assert.ok(checkpoint.routes['route-2']);
});

test('progress counts completed vs qualified verdict', () => {
  const routesNeeded = ['r1', 'r2', 'r3'];
  const routes = {
    r1: { route_ref: 'r1', route_verdict: 'route_qualified_for_experiment', completion_status: 'completed' },
    r2: { route_ref: 'r2', route_verdict: 'route_not_qualified', completion_status: 'completed' },
  };
  const p = countPhase3Progress(routesNeeded, routes);
  assert.equal(p.routes_completed_total, 2);
  assert.equal(p.routes_pending, 1);
  assert.equal(p.routes_qualified_for_future_geometry, 1);
});
