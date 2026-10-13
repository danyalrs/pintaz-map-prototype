export function isInsidePilotBounds(lon, lat, bounds) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
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

export const ZOOM_BELOW_DETAILED_MSG =
  'Zoom in to level 10 or higher to view detailed local OSM roads.';

export const PILOT_INSIDE_MSG = 'Detailed local OSM roads are available inside the pilot area.';

export const PILOT_OUTSIDE_MSG = 'Outside the current pilot road coverage';
