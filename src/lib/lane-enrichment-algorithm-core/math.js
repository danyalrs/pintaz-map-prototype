export function norm2(x, y) {
  return Math.hypot(x, y) || 1;
}

export function unit(dx, dy) {
  const l = norm2(dx, dy);
  return { x: dx / l, y: dy / l };
}

/** Signed lateral metres from point to cross-section anchor along left normal of tangent. */
export function signedLateral(point, crossSection) {
  const [ax, ay] = crossSection.anchor;
  const t = unit(crossSection.tangent[0], crossSection.tangent[1]);
  const nx = -t.y;
  const ny = t.x;
  const vx = point[0] - ax;
  const vy = point[1] - ay;
  return vx * nx + vy * ny;
}

export function segmentIntersection(a, b, c, d) {
  const x1 = a[0];
  const y1 = a[1];
  const x2 = b[0];
  const y2 = b[1];
  const x3 = c[0];
  const y3 = c[1];
  const x4 = d[0];
  const y4 = d[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t, u };
}

export function centrelineTurnDeg(p0, p1, p2) {
  const u1 = unit(p1[0] - p0[0], p1[1] - p0[1]);
  const u2 = unit(p2[0] - p1[0], p2[1] - p1[1]);
  const dot = u1.x * u2.x + u1.y * u2.y;
  const ang = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  return ang;
}
