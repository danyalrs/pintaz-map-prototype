export function parseTileParams(zRaw, xRaw, yRaw) {
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, error: 'Tile coordinates must be integers' };
  }
  if (z < 0 || z > 22) {
    return { ok: false, error: 'Zoom level out of range' };
  }
  const max = 1 << z;
  if (x < 0 || y < 0 || x >= max || y >= max) {
    return { ok: false, error: 'Tile x/y out of range for zoom' };
  }
  return { ok: true, z, x, y };
}

/** Reject path traversal in user-supplied path segments. */
export function isSafePathSegment(segment) {
  if (!segment || typeof segment !== 'string') return false;
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(segment);
}
