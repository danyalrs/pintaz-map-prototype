import fs from 'node:fs';
import path from 'node:path';
import { MAPS_READ_API_BASE } from '../selected-route-paths.js';
import { curlGetToFile } from '../selected-route-curl.js';
import { redactDongle, redactRoute } from '../update-preview-prepare.js';
import { DATA_DIR, POSE_FETCH } from './constants.js';

const ROUTES_RAW = path.join(DATA_DIR, 'routes-list-raw', 'page-000-offset-0.json');

function pickProbeRoute() {
  if (!fs.existsSync(ROUTES_RAW)) return null;
  const page = JSON.parse(fs.readFileSync(ROUTES_RAW, 'utf8'));
  const r = page.routes?.[0];
  if (!r?.dongle || !r?.route) return null;
  return r;
}

/**
 * One GET /health and one bounded GET /v1/geojson (vehicle_pose, max_features=10).
 */
export async function probeLiveMapsReadApi(token) {
  const probedAt = new Date().toISOString();
  const probeDir = path.join(DATA_DIR, 'probe');
  fs.mkdirSync(probeDir, { recursive: true });
  const serverRequests = [];

  const healthPath = path.join(probeDir, 'health.json.part');
  const { status: healthStatus } = await curlGetToFile(`${MAPS_READ_API_BASE}/health`, {
    token,
    outPath: healthPath,
    headerPath: `${healthPath}.hdr`,
  });
  serverRequests.push({ method: 'GET', path: '/health', status: healthStatus, phase: 'phase2_probe' });

  const routeRec = pickProbeRoute();
  let geojsonStatus = null;
  let geojsonPath = null;
  if (routeRec) {
    const q = new URLSearchParams({
      dongle: routeRec.dongle,
      route: routeRec.route,
      layers: POSE_FETCH.layers,
      max_features: '10',
    });
    geojsonPath = `/v1/geojson?dongle=${redactDongle(routeRec.dongle)}&route=${redactRoute(routeRec.route)}&layers=${POSE_FETCH.layers}&max_features=10`;
    const geoOut = path.join(probeDir, 'geojson-probe.json.part');
    const url = `${MAPS_READ_API_BASE}/v1/geojson?${q.toString()}`;
    const res = await curlGetToFile(url, { token, outPath: geoOut, headerPath: `${geoOut}.hdr` });
    geojsonStatus = res.status;
    serverRequests.push({
      method: 'GET',
      path: geojsonPath,
      status: geojsonStatus,
      phase: 'phase2_probe',
    });
  }

  const healthy = healthStatus >= 200 && healthStatus < 300 && geojsonStatus >= 200 && geojsonStatus < 300;

  const record = {
    probed_at: probedAt,
    stop_reason: healthy ? 'live_api_available' : 'live_geojson_unavailable',
    health_http_status: healthStatus,
    geojson_probe_http_status: geojsonStatus,
    geojson_probe_path_redacted: geojsonPath,
    live_api_healthy: healthy,
    server_requests: serverRequests,
  };

  fs.writeFileSync(path.join(DATA_DIR, 'phase2_live_probe.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function loadPhase2ProgressSummary() {
  const progressPath = path.join(DATA_DIR, 'discovery-progress.json');
  const catalogCount = 1706;
  let completed = [];
  if (fs.existsSync(progressPath)) {
    const p = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    completed = p.completed_route_refs || [];
  }
  return {
    catalog_route_count: catalogCount,
    routes_indexed_in_checkpoint: completed.length,
    routes_not_yet_indexed: catalogCount - completed.length,
    completed_route_refs: completed,
  };
}
