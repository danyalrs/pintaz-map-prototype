import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import {
  loadDocumentedApiSpec,
  buildEndpointMatrix,
  documentedGeometryCapabilities,
  summarizeGeojsonFile,
  classifyVerdict,
} from '../src/lib/maps-read-lane-geometry-capability-audit/index.js';
import { probeRawPath } from '../src/lib/bukit-page1-probe-paths.js';

test('documented Maps Read endpoints include only geojson for lane geometry', () => {
  const { document } = loadDocumentedApiSpec();
  assert.ok(document);
  const matrix = buildEndpointMatrix(document);
  const paths = matrix.map((e) => e.path);
  assert.ok(paths.includes('/v1/geojson'));
  assert.ok(!paths.some((p) => /qlog|download/i.test(p)));
});

test('documented capabilities deny ordered polylines and qlog download', () => {
  const { document } = loadDocumentedApiSpec();
  const cap = documentedGeometryCapabilities(document);
  assert.equal(cap.ordered_polyline_arrays_documented, false);
  assert.equal(cap.qlog_download_endpoint_documented, false);
});

test('local drive-005 geojson matches point-only upstream schema', () => {
  const p = probeRawPath('drive-005');
  if (!fs.existsSync(p)) return;
  const summary = summarizeGeojsonFile(p, { maxFeaturesScan: 3000 });
  assert.equal(summary.max_vertices_per_lane_index_per_frame, 1);
  assert.equal(summary.has_linestring_lane_edge, false);
  const verdict = classifyVerdict({
    documented: documentedGeometryCapabilities(loadDocumentedApiSpec().document),
    geojsonSummary: summary,
    liveProbesOk: false,
  });
  assert.equal(verdict, 'UPSTREAM_POINT_ONLY');
});

test('audit reports directory can be generated', () => {
  const report = path.join(ROOT_DIR, 'reports', 'maps_read_lane_geometry_capability_audit', 'capability_verdict.json');
  if (!fs.existsSync(report)) return;
  const v = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(v.lane_count_inferred, false);
  assert.ok(['UPSTREAM_POINT_ONLY', 'UNKNOWN_DOCUMENTED_CAPABILITY'].includes(v.verdict));
});
