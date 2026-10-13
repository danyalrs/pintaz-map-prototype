import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../../config.js';
import { mapsReadRootDir } from '../maps-read-root.js';

const SAVED_DOCS_PATHS = [
  path.join(mapsReadRootDir(), 'docs.safe.json'),
  path.join(mapsReadRootDir(), 'docs-response.json'),
  path.join(ROOT_DIR, 'data', 'maps-read', 'docs.safe.json'),
];

export function loadDocumentedApiSpec() {
  for (const p of SAVED_DOCS_PATHS) {
    if (fs.existsSync(p)) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { source_path: path.relative(ROOT_DIR, p).replace(/\\/g, '/'), document: doc };
    }
  }
  return { source_path: null, document: null };
}

export function buildEndpointMatrix(document) {
  if (!document?.endpoints) return [];
  return document.endpoints.map((ep) => ({
    method: ep.method,
    path: ep.path,
    auth: ep.auth,
    purpose: ep.purpose,
    query: ep.query || null,
    response_fields: ep.response_fields || null,
    feature_layers: ep.feature_layers || null,
    geometry_note: ep.geometry || null,
    paging: ep.paging || null,
    relevance: classifyRelevance(ep),
  }));
}

function classifyRelevance(ep) {
  const p = ep.path || '';
  if (p === '/v1/geojson') return 'primary_route_geometry_export';
  if (p === '/v1/routes') return 'route_listing';
  if (p === '/v1/coverage') return 'aggregate_counts_only';
  if (p === '/docs' || p === '/health') return 'service_metadata';
  return 'other';
}

export function documentedGeometryCapabilities(document) {
  const geo = document?.endpoints?.find((e) => e.path === '/v1/geojson');
  const summary = document?.summary || '';
  return {
    documented_schema: 'kommu.maps.visualization-point-cloud (via /v1/geojson)',
    geometry_in_docs: geo?.geometry || null,
    feature_layer_semantics: geo?.feature_layers || null,
    qlog_download_endpoint_documented: document?.endpoints?.some((e) =>
      /qlog|download|raw/i.test(`${e.path} ${e.purpose}`)
    ),
    service_summary: summary,
    ordered_polyline_arrays_documented: false,
    linestring_geometry_documented: false,
  };
}
