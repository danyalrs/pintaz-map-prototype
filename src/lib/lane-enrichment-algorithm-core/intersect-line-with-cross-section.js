import { LIMITS } from './constants.js';
import { segmentIntersection, signedLateral, unit } from './math.js';

/**
 * Cross-section is infinite line through anchor perpendicular to tangent.
 * Polyline vertices in same local metre plane [x, y].
 */
export function intersectLineWithCrossSection(polylineVertices, crossSection) {
  if (!polylineVertices?.length || polylineVertices.length < LIMITS.minPolylineVertices) {
    return { ok: false, reason: 'invalid_line_geometry' };
  }
  const [ax, ay] = crossSection.anchor;
  const t = unit(crossSection.tangent[0], crossSection.tangent[1]);
  const nx = -t.y;
  const ny = t.x;
  const far = 200;
  const c = [ax - nx * far, ay - ny * far];
  const d = [ax + nx * far, ay + ny * far];

  const hits = [];
  for (let i = 0; i < polylineVertices.length - 1; i++) {
    const a = polylineVertices[i];
    const b = polylineVertices[i + 1];
    const hit = segmentIntersection(a, b, c, d);
    if (hit) {
      hits.push({ x: hit.x, y: hit.y, lateral_m: signedLateral([hit.x, hit.y], crossSection) });
    }
  }
  if (!hits.length) {
    return { ok: false, reason: 'no_intersection' };
  }
  const uniq = [];
  for (const h of hits) {
    const dup = uniq.find((u) => Math.abs(u.lateral_m - h.lateral_m) < LIMITS.lateralAmbiguityToleranceM);
    if (!dup) uniq.push(h);
  }
  if (uniq.length > 1) {
    return { ok: false, reason: 'ambiguous_multiple_intersections', hits: uniq };
  }
  return { ok: true, lateral_m: uniq[0].lateral_m, point: [uniq[0].x, uniq[0].y] };
}
