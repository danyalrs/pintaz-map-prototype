/** Deterministic fit helpers for comparison section zoom. */

export function lineStringBounds(coordinates) {
  if (!coordinates?.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of coordinates) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return null;
  return [[west, south], [east, north]];
}

export function boundsForFeatures(features, { uiGroup = null } = {}) {
  const list = uiGroup
    ? features.filter((f) => f.properties?.ui_group === uiGroup)
    : features;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const f of list) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const b = lineStringBounds(coords);
    if (!b) continue;
    west = Math.min(west, b[0][0]);
    south = Math.min(south, b[0][1]);
    east = Math.max(east, b[1][0]);
    north = Math.max(north, b[1][1]);
  }
  if (!Number.isFinite(west)) return null;
  return [[west, south], [east, north]];
}

/** Padding for sidebar (left), selection card (right), controls (top), attribution (bottom). */
export const COMPARISON_FIT_PADDING = {
  top: 56,
  bottom: 48,
  left: 300,
  right: 340,
};

export function fitOptionsForSectionLength(sectionLengthM) {
  const maxZoom = sectionLengthM < 150 ? 17 : 16;
  return {
    padding: COMPARISON_FIT_PADDING,
    maxZoom,
    duration: 800,
  };
}
