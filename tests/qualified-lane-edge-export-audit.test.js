import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditQualifiedRouteLaneEdgeExports,
  classifyLaneEdgeExportFile,
  laneEdgeExportPath,
  LANE_EDGE_EXPORT_CLASS,
} from '../src/lib/full-maps-read-route-enrichment-discovery/audit-qualified-lane-edge-exports.js';

test('audit covers 198 qualified routes', () => {
  const audit = auditQualifiedRouteLaneEdgeExports();
  assert.equal(audit.qualified_route_count, 198);
  const sum = Object.values(audit.counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, 198);
});

test('drive-267 lane-edge is point-only when present', () => {
  const p = laneEdgeExportPath('drive-267');
  const r = classifyLaneEdgeExportFile(p);
  if (r.classification === LANE_EDGE_EXPORT_CLASS.MISSING) return;
  assert.equal(r.classification, LANE_EDGE_EXPORT_CLASS.POINT_ONLY);
});
