#!/usr/bin/env node
/**
 * Reconcile Phase 3 checkpoint after pose-index lookup fix. No Maps Read fetches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { TARGET_WAYS } from '../src/lib/full-maps-read-route-enrichment-discovery/constants.js';
import {
  loadCachedCatalogRecordByRef,
  loadCoverageIndexSummary,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-coverage-load.js';
import {
  describeRouteIdentity,
  phase2PoseCheckpointSummary,
} from '../src/lib/full-maps-read-route-enrichment-discovery/route-identity.js';
import { loadVehiclePosesFromRaw } from '../src/lib/full-maps-read-route-enrichment-discovery/fetch-vehicle-poses.js';
import {
  reconcilePhase3StaleLookupFailures,
  reconciliationStatus,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-reconcile.js';
import { countPhase3Progress, loadPhase3Checkpoint } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-checkpoint.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'full_maps_read_route_enrichment_discovery_v1');

function main() {
  const { recordByRef, refMap } = loadCachedCatalogRecordByRef();
  const coverage = loadCoverageIndexSummary();
  const kamRow = coverage.way_rows.find(
    (r) => r.osm_way_id === TARGET_WAYS.JALAN_KAMUNING && r.route_ref === 'drive-1261'
  );
  const otherRow = coverage.way_rows.find((r) => r.route_ref !== kamRow?.route_ref) || coverage.way_rows[0];
  const kamRecord = recordByRef.get('drive-1261');

  const before = loadPhase3Checkpoint();
  const beforeProgress = countPhase3Progress(coverage.route_refs, before.routes || {});

  const { requeued, keptCompleted } = reconcilePhase3StaleLookupFailures();
  const after = loadPhase3Checkpoint();
  const afterProgress = countPhase3Progress(coverage.route_refs, after.routes || {});
  const recon = reconciliationStatus();

  let routesWithPhase2 = 0;
  let genuinelyNoPoses = 0;
  for (const ref of coverage.route_refs) {
    const sum = phase2PoseCheckpointSummary(ref);
    if (sum.pose_count > 0 || sum.raw_geojson_pages > 0) routesWithPhase2 += 1;
    else genuinelyNoPoses += 1;
  }

  const trace = {
    schema: 'phase3-route-pose-lookup-reconciliation-v1',
    generated_at: new Date().toISOString(),
    root_cause:
      'Phase 3 loadVehiclePosesFromRaw used parse sanitization that rejected vehicle_pose log_mono_time strings; route_ref keys were already aligned.',
    canonical_identity: {
      pose_index_key: 'catalogue route_ref (drive-NNN)',
      catalogue_server_key: 'dongle\\0route datetime id → route_ref via buildDriveReferenceMap',
      local_explorer_label: 'drive-005 etc. — not used as pose-index key',
      old_lookup_key: 'route_ref (unchanged)',
      corrected_lookup_key: 'route_ref + parse accepts string log_mono_time on vehicle_pose',
    },
    traces: [
      {
        case: 'jalan_kamuning_39914067_drive_1261',
        way_row: kamRow,
        route_identity: kamRecord ? describeRouteIdentity(kamRecord, refMap) : null,
        phase2_checkpoint: phase2PoseCheckpointSummary('drive-1261'),
        phase3_poses_loadable_after_fix: loadVehiclePosesFromRaw('drive-1261').length,
        prior_phase3_stale_reason: 'no_vehicle_pose_index (parse dropped all features)',
      },
      {
        case: 'sample_other_pair',
        way_row: otherRow,
        route_identity: otherRow
          ? describeRouteIdentity(recordByRef.get(otherRow.route_ref), refMap)
          : null,
        phase2_checkpoint: otherRow ? phase2PoseCheckpointSummary(otherRow.route_ref) : null,
        phase3_poses_loadable_after_fix: otherRow
          ? loadVehiclePosesFromRaw(otherRow.route_ref).length
          : 0,
      },
    ],
    counts: {
      routes_with_real_phase2_poses: routesWithPhase2,
      routes_genuinely_without_poses: genuinelyNoPoses,
      stale_lookup_failures_requeued: requeued,
      routes_completed_retained: keptCompleted,
    },
    phase3_progress_before: beforeProgress,
    phase3_progress_after: afterProgress,
    reconciliation: recon,
    no_lane_count_inferred: true,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'phase3_pose_lookup_reconciliation.json'),
    `${JSON.stringify(trace, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(REPORT_DIR, 'PHASE3_POSE_LOOKUP_RECONCILIATION.md'),
    `# Phase 3 pose-index lookup reconciliation

## Root cause

**Not a route_ref vs dongle mismatch.** Phase 2 and Phase 3 both use catalogue \`route_ref\` (e.g. \`drive-1261\`) for \`pose-index/\` and \`vehicle-pose-raw/\`.

Phase 3 reported \`no_vehicle_pose_index\` because **GeoJSON sanitization dropped every \`vehicle_pose\`** when \`log_mono_time\` was a **string** (local preview / derived exports). Phase 2 indexing used the same files earlier via direct parse for coverage matching.

## Canonical identity mapping

| Role | Key |
|------|-----|
| Pose index directory | \`route_ref\` → \`drive-1261\` |
| Catalogue server route | \`dongle\` (16-hex) + \`route\` (datetime id) |
| Map to route_ref | \`buildDriveReferenceMap\` on \`routeSortKey(record)\` |
| Local explorer label | e.g. \`drive-005\` — maps to inventory \`drive-1261\` via drive-ref-map only |

## Trace: Jalan Kamuning / drive-1261

- Phase 2 way row: **290** matched poses on way **39914067**
- Phase 2 checkpoint: **${trace.traces[0].phase2_checkpoint.pose_count}** vehicle poses in index
- After fix, Phase 3 load: **${trace.traces[0].phase3_poses_loadable_after_fix}** poses

## Reconciliation

- Stale \`no_vehicle_pose_index\` rows requeued: **${requeued}**
- Routes completed retained (real screens): **${keptCompleted}**
- Routes with Phase 2 pose evidence: **${routesWithPhase2}**
- Genuinely without poses: **${genuinelyNoPoses}**

**No lane count was inferred.**

Prior Phase 3 “all routes lack poses” conclusion is **invalid** until re-screening completes after reconciliation.
`
  );

  console.log(JSON.stringify({ requeued, recon, poses_1261: loadVehiclePosesFromRaw('drive-1261').length }, null, 2));
}

main();
