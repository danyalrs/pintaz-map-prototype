import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveActivePreviewAbs,
  buildSourceFieldMatrix,
  buildExampleFrameTrace,
  assessCrossSectionFeasibility,
  computeVerdict,
  EXAMPLE_CROSS_SECTION_ID,
} from '../src/lib/lane-enrichment-v3-source-audit/index.js';

test('local preview has at most one point per lane_index per frame', () => {
  const previewAbs = resolveActivePreviewAbs();
  if (!fs.existsSync(previewAbs)) return;
  const matrix = buildSourceFieldMatrix(previewAbs);
  assert.equal(matrix.summary.max_vertices_lane_per_frame, 1);
  assert.equal(matrix.summary.any_ordered_polyline_lane_edge, false);
  const verdict = computeVerdict(matrix);
  assert.equal(verdict.code, 'V3_GEOMETRY_NOT_AVAILABLE');
});

test('example frame trace for Sultan Ismail section denies cross-section intersection', () => {
  const previewAbs = resolveActivePreviewAbs();
  if (!fs.existsSync(previewAbs)) return;
  const trace = buildExampleFrameTrace(previewAbs);
  assert.equal(trace.verdict, 'V3_GEOMETRY_NOT_AVAILABLE');
  assert.ok(trace.lines.length >= 6);
  for (const ln of trace.lines) {
    assert.equal(ln.vertex_count, 1);
    assert.equal(ln.can_intersect_cross_section, false);
  }
});

test('cross-section ef9afb2b3f9c4e37 feasibility on 252085334', () => {
  const previewAbs = resolveActivePreviewAbs();
  if (!fs.existsSync(previewAbs)) return;
  const feas = assessCrossSectionFeasibility(previewAbs, '252085334');
  assert.equal(feas.matches_v2_1_cross_section, true);
  assert.equal(feas.cross_section_id, EXAMPLE_CROSS_SECTION_ID);
  assert.equal(feas.can_compute_line_cross_section_intersection, false);
});

test('invariant: one source line per frame has one vertex in GeoJSON', () => {
  const previewAbs = resolveActivePreviewAbs();
  if (!fs.existsSync(previewAbs)) return;
  const g = JSON.parse(fs.readFileSync(previewAbs, 'utf8'));
  const seen = new Map();
  for (const f of g.features) {
    if (f.properties?.layer !== 'lane_point') continue;
    const k = `${f.properties.frame_id}|${f.properties.lane_index}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [, c] of seen) assert.equal(c, 1);
});
