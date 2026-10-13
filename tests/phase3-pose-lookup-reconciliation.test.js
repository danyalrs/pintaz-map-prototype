import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isValidMapsReadObservationFeature,
  parseMapsReadGeoJsonFromUtf8,
} from '../src/lib/full-maps-read-route-enrichment-discovery/parse-maps-read-geojson.js';
import {
  isStalePhase3LookupFailure,
  reconcilePhase3StaleLookupFailures,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-reconcile.js';
import {
  loadPhase3Checkpoint,
  persistPhase3RouteResult,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-checkpoint.js';
import { phase2HasPoseEvidence } from '../src/lib/full-maps-read-route-enrichment-discovery/route-identity.js';
import { loadVehiclePosesFromRaw } from '../src/lib/full-maps-read-route-enrichment-discovery/fetch-vehicle-poses.js';

test('vehicle_pose with string log_mono_time is valid', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [101.72, 3.14] },
    properties: {
      layer: 'vehicle_pose',
      frame_id: 1,
      log_mono_time: '613771874348',
      heading_deg: 66,
    },
  };
  assert.equal(isValidMapsReadObservationFeature(feature), true);
  const parsed = parseMapsReadGeoJsonFromUtf8(
    JSON.stringify({ type: 'FeatureCollection', features: [feature] })
  );
  assert.equal(parsed.geojson.features.length, 1);
});

test('stale no_vehicle_pose_index requeued when phase2 has checkpoint', () => {
  const ckPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p3rec-')), 'phase3.json');
  const checkpoint = loadPhase3Checkpoint(ckPath);
  persistPhase3RouteResult(
    checkpoint,
    'drive-1261',
    {
      route_fetch_status: 'insufficient_route_coverage',
      route_verdict: null,
      disqualification_reasons: ['no_vehicle_pose_index'],
    },
    ckPath
  );

  assert.equal(
    isStalePhase3LookupFailure('drive-1261', loadPhase3Checkpoint(ckPath).routes['drive-1261'], {
      phase2HasPoses: true,
    }),
    true
  );
  const { requeued } = reconcilePhase3StaleLookupFailures(ckPath, {
    hasPoseEvidence: () => true,
  });
  assert.equal(requeued, 1);
  assert.equal(loadPhase3Checkpoint(ckPath).routes['drive-1261'], undefined);
  const archived = loadPhase3Checkpoint(ckPath).stale_lookup_failures['drive-1261'];
  assert.equal(archived.completion_status, 'stale_lookup_failure');
});

test('integration: drive-1261 loads poses when raw geojson exists', () => {
  const rawPath = path.join(
    process.cwd(),
    'data/maps-read/full-route-enrichment-discovery-v1/vehicle-pose-raw/drive-1261/page-000-first.geojson'
  );
  if (!fs.existsSync(rawPath)) return;
  assert.ok(phase2HasPoseEvidence('drive-1261'));
  const n = loadVehiclePosesFromRaw('drive-1261').length;
  assert.ok(n > 0, `expected poses for drive-1261, got ${n}`);
});
