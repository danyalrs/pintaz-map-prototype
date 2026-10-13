import fs from 'node:fs';
import { phase2HasPoseEvidence, phase2PoseCheckpointSummary } from './route-identity.js';
import { loadVehiclePosesFromRaw } from './fetch-vehicle-poses.js';
import { isPhase3RouteCompleted, loadPhase3Checkpoint, savePhase3CheckpointAtomic } from './phase3-checkpoint.js';
import { resolvePhase3CheckpointPath } from './phase3-constants.js';

const STALE_REASON = 'no_vehicle_pose_index';

export function isStalePhase3LookupFailure(routeRef, entry, { phase2HasPoses } = {}) {
  if (!entry) return false;
  const reasons = entry.disqualification_reasons || [];
  if (!reasons.includes(STALE_REASON)) return false;
  if (entry.route_verdict && entry.route_verdict !== null) return false;
  const hasPhase2 = phase2HasPoses ?? phase2HasPoseEvidence(routeRef);
  return hasPhase2;
}

/**
 * Move stale no_vehicle_pose_index rows (where Phase 2 has poses) back to pending.
 * Preserves archived copy under stale_lookup_failures; does not delete evidence.
 */
export function reconcilePhase3StaleLookupFailures(
  checkpointPath = resolvePhase3CheckpointPath(),
  { hasPoseEvidence = phase2HasPoseEvidence } = {}
) {
  const checkpoint = loadPhase3Checkpoint(checkpointPath);
  const routes = checkpoint.routes || {};
  const staleArchive = checkpoint.stale_lookup_failures || {};
  let requeued = 0;
  let keptCompleted = 0;

  for (const [routeRef, entry] of Object.entries(routes)) {
    if (!isStalePhase3LookupFailure(routeRef, entry, { phase2HasPoses: hasPoseEvidence(routeRef) })) {
      if (isPhase3RouteCompleted(entry)) keptCompleted += 1;
      continue;
    }
    staleArchive[routeRef] = {
      ...entry,
      completion_status: 'stale_lookup_failure',
      reconciled_at: new Date().toISOString(),
      phase2_pose_checkpoint: phase2PoseCheckpointSummary(routeRef),
    };
    delete routes[routeRef];
    requeued += 1;
  }

  checkpoint.routes = routes;
  checkpoint.stale_lookup_failures = staleArchive;
  checkpoint.reconciliation = {
    last_run_at: new Date().toISOString(),
    requeued_stale_lookup_failures: requeued,
    routes_completed_retained: keptCompleted,
  };
  savePhase3CheckpointAtomic(checkpoint, checkpointPath);
  return { requeued, keptCompleted, checkpoint };
}

export function reconciliationStatus(checkpointPath = resolvePhase3CheckpointPath()) {
  const checkpoint = loadPhase3Checkpoint(checkpointPath);
  const routes = checkpoint.routes || {};
  let withPhase2Poses = 0;
  let loadablePoses = 0;
  let staleStillCompleted = 0;

  for (const routeRef of Object.keys(routes)) {
    if (!phase2HasPoseEvidence(routeRef)) continue;
    withPhase2Poses += 1;
    if (loadVehiclePosesFromRaw(routeRef).length > 0) loadablePoses += 1;
    const entry = routes[routeRef];
    if ((entry.disqualification_reasons || []).includes(STALE_REASON)) staleStillCompleted += 1;
  }

  const pendingStale =
    Object.keys(checkpoint.stale_lookup_failures || {}).length + staleStillCompleted;
  return {
    reconciliation_passed: staleStillCompleted === 0,
    routes_with_phase2_pose_checkpoint: withPhase2Poses,
    routes_with_loadable_poses: loadablePoses,
    stale_lookup_failures_still_marked_completed: staleStillCompleted,
    archived_stale_lookup_failures: Object.keys(checkpoint.stale_lookup_failures || {}).length,
    last_reconciliation: checkpoint.reconciliation ?? null,
  };
}
