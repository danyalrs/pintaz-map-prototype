import fs from 'node:fs';
import path from 'node:path';
import { curlGetToFile } from '../selected-route-curl.js';
import { MAPS_READ_API_BASE } from '../selected-route-paths.js';

export async function probeEndpoint({ label, url, token, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  const bodyPath = path.join(workDir, `${label}.body`);
  const headerPath = path.join(workDir, `${label}.headers`);
  if (fs.existsSync(bodyPath)) fs.unlinkSync(bodyPath);
  if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
  const { status } = await curlGetToFile(url, {
    token: token || '',
    outPath: bodyPath,
    headerPath,
    maxFilesizeBytes: 12_000_000,
  });
  const headerText = fs.existsSync(headerPath) ? fs.readFileSync(headerPath, 'utf8') : '';
  const contentType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || null;
  let topLevel = null;
  let parseError = null;
  if (fs.existsSync(bodyPath) && status === 200) {
    try {
      const text = fs.readFileSync(bodyPath, 'utf8').slice(0, 2_000_000);
      const json = JSON.parse(text);
      topLevel = Array.isArray(json)
        ? { type: 'array', length: json.length }
        : { type: typeof json, keys: Object.keys(json).slice(0, 30) };
    } catch (e) {
      parseError = e.message;
    }
  }
  const bodyBytes = fs.existsSync(bodyPath) ? fs.statSync(bodyPath).size : 0;
  try {
    if (fs.existsSync(bodyPath)) fs.unlinkSync(bodyPath);
    if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
  } catch {
    /* ignore cleanup */
  }
  return {
    label,
    url_redacted: url.replace(/dongle=[^&]+/, 'dongle=[REDACTED]').replace(/route=[^&]+/, 'route=[REDACTED]'),
    http_status: status,
    content_type: contentType,
    body_bytes: bodyBytes,
    top_level: topLevel,
    parse_error: parseError,
  };
}

export function buildProbeUrls({ bbox, dongle, route }) {
  const base = MAPS_READ_API_BASE;
  return [
    { label: 'health', url: `${base}/health`, auth: false },
    { label: 'docs', url: `${base}/docs`, auth: false },
    {
      label: 'coverage',
      url: `${base}/v1/coverage?bbox=${encodeURIComponent(bbox)}`,
      auth: true,
    },
    {
      label: 'routes',
      url: `${base}/v1/routes?bbox=${encodeURIComponent(bbox)}&limit=5`,
      auth: true,
    },
    {
      label: 'geojson_drive',
      url: `${base}/v1/geojson?${new URLSearchParams({
        dongle,
        route,
        layers: 'vehicle_pose,lane_point,edge_point',
        max_features: '800',
      }).toString()}`,
      auth: true,
    },
  ];
}
