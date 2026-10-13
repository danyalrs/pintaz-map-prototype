/** Slippy-map (XYZ) tile math — y increases southward (Web Mercator). */

export function tileBBox(z, x, y) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west, south, east, north };
}

export function tilePolygon(z, x, y) {
  const b = tileBBox(z, x, y);
  return {
    type: 'Polygon',
    coordinates: [
      [
        [b.west, b.south],
        [b.east, b.south],
        [b.east, b.north],
        [b.west, b.north],
        [b.west, b.south],
      ],
    ],
  };
}

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { z, x, y };
}

export function bboxAreaKm2(bounds) {
  const latMid = (bounds.south + bounds.north) / 2;
  const latKm = 111.32;
  const lonKm = 111.32 * Math.cos((latMid * Math.PI) / 180);
  const w = Math.max(0, bounds.east - bounds.west) * lonKm;
  const h = Math.max(0, bounds.north - bounds.south) * latKm;
  return w * h;
}

/** Rough country label from tile centre (offline, bbox-based). */
export function countryFromLonLat(lon, lat) {
  if (lon >= 103.55 && lon <= 104.15 && lat >= 1.1 && lat <= 1.5) return 'SG';
  if (lon >= 113.9 && lon <= 115.6 && lat >= 4.0 && lat <= 5.2) return 'BN';
  if (lon >= 99.4 && lon <= 119.6 && lat >= 0.5 && lat <= 7.9) return 'MY';
  return 'OTHER';
}

export function aggregateBounds(tiles) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const t of tiles) {
    const b = tileBBox(t.z, t.x, t.y);
    west = Math.min(west, b.west);
    south = Math.min(south, b.south);
    east = Math.max(east, b.east);
    north = Math.max(north, b.north);
  }
  return { west, south, east, north };
}
