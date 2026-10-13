const R = 6371008.8;

export function haversineMetres(lon1, lat1, lon2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Axis-aligned square centred on (lon, lat) with side `sideMetres` (default 2000).
 * Uses local meridian convergence for longitude spacing.
 */
export function squareFromCentreMetres(centreLon, centreLat, sideMetres = 2000) {
  const half = sideMetres / 2;
  const latRad = (centreLat * Math.PI) / 180;
  const metresPerDegLat =
    111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metresPerDegLon = metresPerDegLat * Math.cos(latRad);
  const dLat = half / metresPerDegLat;
  const dLon = half / metresPerDegLon;
  const bounds = {
    west: centreLon - dLon,
    east: centreLon + dLon,
    south: centreLat - dLat,
    north: centreLat + dLat,
  };
  const widthM = haversineMetres(bounds.west, centreLat, bounds.east, centreLat);
  const heightM = haversineMetres(centreLon, bounds.south, centreLon, bounds.north);
  return {
    centre: { lon: centreLon, lat: centreLat },
    bounds,
    sideMetres,
    widthM,
    heightM,
    areaKm2: (widthM * heightM) / 1_000_000,
  };
}

export function isInsideMalaysia(lon, lat) {
  return lon >= 99.5 && lon <= 119.5 && lat >= 0.85 && lat <= 7.5;
}

/** Adjust side length so haversine width/height land in 1995–2005 m. */
export function squareFromCentreExact2km(centreLon, centreLat) {
  let side = 2000;
  let square = squareFromCentreMetres(centreLon, centreLat, side);
  for (let i = 0; i < 24; i++) {
    const w = square.widthM;
    if (w >= 1995 && w <= 2005) return square;
    side *= 2000 / w;
    square = squareFromCentreMetres(centreLon, centreLat, side);
  }
  return square;
}

export function validateSquare(square) {
  const w = square.widthM;
  const h = square.heightM;
  const okSize = w >= 1995 && w <= 2005 && h >= 1995 && h <= 2005;
  const b = square.bounds;
  const okMalaysia =
    isInsideMalaysia(square.centre.lon, square.centre.lat) &&
    isInsideMalaysia(b.west, b.south) &&
    isInsideMalaysia(b.east, b.north);
  return { okSize, okMalaysia, widthM: w, heightM: h };
}

export function boundsPolygon(bounds) {
  const { west, south, east, north } = bounds;
  return {
    type: 'Feature',
    properties: { role: 'area-outline' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
  };
}
