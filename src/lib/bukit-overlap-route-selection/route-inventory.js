import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { ROUTE_RESULTS_PRIVATE_PATH } from '../bukit-page1-probe-paths.js';
import { probeRawPath } from '../bukit-page1-probe-paths.js';
import { resolveUpdatePreviewPaths, updateEnvelopePath } from '../update-preview-paths.js';
import { countByLayer, insideOutsideCounts } from '../update-preview-stats.js';
import { loadBukitPilotBbox, pointInsideBukitPilot } from '../bukit-pilot-bounds.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from '../update-preview-paths.js';
import { parseBboxString } from '../update-preview-stats.js';
import { EXPECTED_RAW_SHA256 } from '../multi-drive-mismatch-config.js';
import { AUDIT_ROUTE_REFS } from './config.js';

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function dongleGroupMap(routeResults) {
  const dongles = [...new Set(routeResults.routes.filter((r) => r.dongle).map((r) => r.dongle))].sort();
  const m = new Map();
  dongles.forEach((d, i) => m.set(d, `dongle-group-${String.fromCharCode(65 + i)}`));
  return m;
}

function pilotBbox() {
  if (fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)) {
    const b = parseBboxString(JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8')).bbox);
    if (b) return b;
  }
  return loadBukitPilotBbox();
}

function pathLengthM(poses) {
  let sum = 0;
  for (let i = 1; i < poses.length; i++) {
    const [a0, a1] = poses[i - 1].geometry.coordinates;
    const [b0, b1] = poses[i].geometry.coordinates;
    const R = 6371000;
    const dLat = ((b1 - a1) * Math.PI) / 180;
    const dLon = ((b0 - a0) * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a1 * Math.PI) / 180) * Math.cos((b1 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    sum += 2 * R * Math.asin(Math.sqrt(x));
  }
  return sum;
}

export function validateCompleteRoute(routeKey, probeRef, routeResultsByProbe, groupMap) {
  const bbox = pilotBbox();
  if (routeKey === 'active') {
    const previewPath = resolveUpdatePreviewPaths().previewPath;
    const envelope = JSON.parse(fs.readFileSync(updateEnvelopePath(), 'utf8'));
    const sha = sha256File(previewPath);
    const expected = EXPECTED_RAW_SHA256['drive-active'];
    const ok = sha === expected && envelope.truncated === false;
    const geo = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
    const layers = countByLayer(geo.features || []);
    const { inside_area_count, outside_area_count } = insideOutsideCounts(geo.features || [], bbox);
    const poses = (geo.features || []).filter((f) => f.properties?.layer === 'vehicle_pose');
    const insidePoses = poses.filter((f) => pointInsideBukitPilot(f.geometry.coordinates[0], f.geometry.coordinates[1], bbox));
    return {
      route_key: routeKey,
      redacted_route_ref: 'active',
      complete: ok && (envelope.next_after_seg == null || envelope.next_after_seg === undefined),
      validation: {
        http_ok: true,
        truncated: envelope.truncated,
        next_after_seg: envelope.next_after_seg ?? null,
        sha256_matches_manifest: sha === expected,
        feature_count: geo.features?.length ?? 0,
      },
      private: { sha256: sha, source_path_kind: 'active_preview' },
      public: {
        redacted_route_ref: 'active',
        dongle_group: 'dongle-group-active',
        role: 'active_selected',
        feature_count: geo.features?.length ?? 0,
        vehicle_poses: layers.vehicle_pose || 0,
        lane_points: layers.lane_point || 0,
        edge_points: layers.edge_point || 0,
        gps_points: layers.gps_point || 0,
        inside_pilot_features: inside_area_count,
        outside_pilot_features: outside_area_count,
        inside_pilot_vehicle_poses: insidePoses.length,
        pilot_vehicle_path_length_m: Math.round(pathLengthM(insidePoses) * 10) / 10,
      },
    };
  }

  const meta = routeResultsByProbe.get(probeRef);
  const rawPath = probeRawPath(probeRef);
  if (!meta || !fs.existsSync(rawPath)) {
    return { route_key: routeKey, complete: false, error: 'missing_meta_or_raw' };
  }
  const sha = sha256File(rawPath);
  const complete =
    meta.ok &&
    meta.http_status === 200 &&
    meta.truncated === false &&
    (meta.next_after_seg == null || meta.next_after_seg === undefined) &&
    sha === meta.sha256;
  const expected = EXPECTED_RAW_SHA256[probeRef];
  if (expected && sha !== expected) {
    return { route_key: routeKey, complete: false, error: 'sha_mismatch_expected' };
  }
  const buf = fs.readFileSync(rawPath);
  const text = buf.toString('utf8');
  const literalNan = (text.match(/\bNaN\b/g) || []).length;
  const geo = JSON.parse(text.replace(/\bNaN\b/g, 'null'));
  const layers = countByLayer(geo.features || []);
  const { inside_area_count, outside_area_count } = insideOutsideCounts(geo.features || [], bbox);
  const poses = (geo.features || []).filter((f) => f.properties?.layer === 'vehicle_pose');
  const insidePoses = poses.filter((f) => pointInsideBukitPilot(f.geometry.coordinates[0], f.geometry.coordinates[1], bbox));
  const dongleGroup = meta.dongle ? groupMap.get(meta.dongle) : null;
  return {
    route_key: routeKey,
    redacted_route_ref: probeRef.replace('drive-', 'probe-'),
    complete,
    validation: {
      http_ok: meta.http_status === 200,
      truncated: meta.truncated,
      next_after_seg: meta.next_after_seg,
      sha256_matches_manifest: sha === meta.sha256,
      literal_nan_in_raw: literalNan,
      feature_count: geo.features?.length ?? 0,
      manifest_feature_count: meta.feature_count,
    },
    private: {
      sha256: sha,
      dongle: meta.dongle,
      route: meta.route,
      inventory_drive_ref: meta.inventory_drive_ref,
    },
    public: {
      redacted_route_ref: probeRef.replace('drive-', 'probe-'),
      dongle_group: dongleGroup,
      dongle_redacted: meta.dongle_redacted,
      route_redacted: meta.route_redacted,
      role: AUDIT_ROUTE_REFS.find((r) => r.probe_ref === probeRef)?.role || 'stored_complete',
      feature_count: meta.feature_count,
      vehicle_poses: layers.vehicle_pose || 0,
      lane_points: layers.lane_point || 0,
      edge_points: layers.edge_point || 0,
      gps_points: layers.gps_point || 0,
      inside_pilot_features: inside_area_count,
      outside_pilot_features: outside_area_count,
      inside_pilot_vehicle_poses: insidePoses.length,
      pilot_vehicle_path_length_m: Math.round(pathLengthM(insidePoses) * 10) / 10,
      route_completeness: complete ? 'complete' : 'incomplete',
    },
  };
}

export function buildRouteInventory() {
  const results = JSON.parse(fs.readFileSync(ROUTE_RESULTS_PRIVATE_PATH, 'utf8'));
  const byProbe = new Map(results.routes.map((r) => [r.probe_ref, r]));
  const groupMap = dongleGroupMap(results);
  const activeDongle = JSON.parse(fs.readFileSync(updateEnvelopePath(), 'utf8')).source_dongle;
  if (activeDongle) {
    groupMap.set(activeDongle, 'dongle-group-active');
  }
  const routes = [];
  const privateRecords = [];
  for (const spec of AUDIT_ROUTE_REFS) {
    const rec = validateCompleteRoute(spec.route_key, spec.probe_ref, byProbe, groupMap);
    routes.push(rec);
    if (rec.private) privateRecords.push({ route_key: spec.route_key, ...rec.private });
  }
  const completeCount = routes.filter((r) => r.complete).length;
  return {
    schema: 'pintaz.bukit-overlap.route-inventory.v1',
    complete_route_count: completeCount,
    routes,
    private_records: privateRecords,
    redacted_public: routes.map((r) => ({
      route_key: r.route_key,
      redacted_route_ref: r.redacted_route_ref || r.public?.redacted_route_ref,
      ...r.public,
      complete: r.complete,
    })),
  };
}
