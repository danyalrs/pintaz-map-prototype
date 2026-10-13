import fs from 'node:fs';
import path from 'node:path';
import { PHASE3_VERSION, resolvePhase3CheckpointPath } from './phase3-constants.js';

export function isPhase3RouteCompleted(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.completion_status === 'retryable') return false;
  if (entry.completion_status === 'completed') return true;
  if (entry.retryable === true) return false;
  if (entry.route_fetch_status === 'malformed_response') return false;
  return Boolean(entry.route_ref);
}

export function normalizePhase3RouteResult(result) {
  const retryable =
    result.retryable === true || result.route_fetch_status === 'malformed_response';
  return {
    ...result,
    completion_status: retryable ? 'retryable' : 'completed',
    screened_at: result.screened_at ?? new Date().toISOString(),
  };
}

export function loadPhase3Checkpoint(checkpointPath = resolvePhase3CheckpointPath()) {
  if (!fs.existsSync(checkpointPath)) {
    return { version: PHASE3_VERSION, routes: {}, updated_at: null };
  }
  const raw = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  return {
    ...raw,
    version: raw.version ?? PHASE3_VERSION,
    routes: raw.routes && typeof raw.routes === 'object' ? raw.routes : {},
    updated_at: raw.updated_at ?? null,
  };
}

export function savePhase3CheckpointAtomic(checkpoint, checkpointPath = resolvePhase3CheckpointPath()) {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const tmp = `${checkpointPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, checkpointPath);
}

export function persistPhase3RouteResult(checkpoint, routeRef, result, checkpointPath) {
  const normalized = normalizePhase3RouteResult({ ...result, route_ref: routeRef });
  if (!checkpoint.routes) checkpoint.routes = {};
  checkpoint.routes[routeRef] = normalized;
  savePhase3CheckpointAtomic(checkpoint, checkpointPath);
  return normalized;
}

export function selectPendingPhase3Routes(routesNeeded, routesByRef) {
  const map = routesByRef instanceof Map ? Object.fromEntries(routesByRef) : routesByRef;
  return routesNeeded.filter((ref) => !isPhase3RouteCompleted(map[ref]));
}

export function selectPhase3Batch(routesNeeded, routesByRef, batchSize) {
  const pending = selectPendingPhase3Routes(routesNeeded, routesByRef);
  const limit = batchSize > 0 ? batchSize : pending.length;
  const batch = pending.slice(0, limit);
  return { pending, batch };
}

export function countPhase3Progress(routesNeeded, routesByRef) {
  const map = routesByRef instanceof Map ? Object.fromEntries(routesByRef) : routesByRef;
  let completed = 0;
  let retryable = 0;
  let qualifiedForGeometry = 0;
  for (const ref of routesNeeded) {
    const row = map[ref];
    if (!isPhase3RouteCompleted(row)) continue;
    completed += 1;
    if (row.route_verdict === 'route_qualified_for_experiment') qualifiedForGeometry += 1;
  }
  for (const row of Object.values(map)) {
    if (row?.completion_status === 'retryable' || row?.retryable === true) retryable += 1;
  }
  const pending = routesNeeded.length - completed;
  return {
    routes_completed_total: completed,
    routes_pending: pending,
    retryable_failure_count: retryable,
    routes_qualified_for_future_geometry: qualifiedForGeometry,
  };
}
