/** MBTiles / tilemaker payloads are often gzip-compressed MVT. */
export function isGzipTile(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 2 &&
    buffer[0] === 0x1f &&
    buffer[1] === 0x8b
  );
}

/**
 * @returns {{ headers: Record<string, string>, body: Buffer }}
 */
export function prepareVectorTileResponse(buffer) {
  const headers = {
    'Content-Type': 'application/vnd.mapbox-vector-tile',
    'Cache-Control': 'public, max-age=300',
  };
  if (isGzipTile(buffer)) {
    headers['Content-Encoding'] = 'gzip';
  }
  return { headers, body: buffer };
}

/** Mapbox GL requests XYZ row; MBTiles stores TMS row. */
export function xyzYToTmsRow(z, y) {
  return (1 << z) - 1 - y;
}

export function tmsRowToXyzY(z, tileRow) {
  return (1 << z) - 1 - tileRow;
}
