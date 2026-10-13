/** Minimum clearance from the map panel edge to the fitted geographic bounds (px). */
export const MIN_FIT_MARGIN_PX = 20;

/** Inset so the dashed outline stroke stays inside the safe fit area. */
export const OUTLINE_STROKE_INSET_PX = 4;

const CONTROL_SELECTOR =
  '.mapboxgl-ctrl-group, .mapboxgl-ctrl-scale, .mapboxgl-ctrl-attrib, ' +
  '.mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-top-right, .mapboxgl-ctrl-top-left';

/**
 * @param {HTMLElement} container Mapbox map container
 * @param {number} [minMargin]
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function computeMapFitPadding(container, minMargin = MIN_FIT_MARGIN_PX) {
  const base = minMargin + OUTLINE_STROKE_INSET_PX;
  const pad = { top: base, right: base, bottom: base, left: base };
  if (!container?.getBoundingClientRect) return pad;

  const cRect = container.getBoundingClientRect();
  if (!cRect.width || !cRect.height) return pad;

  const ctrls = container.querySelectorAll(CONTROL_SELECTOR);
  for (const el of ctrls) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    const fromTop = r.top - cRect.top;
    const fromLeft = r.left - cRect.left;
    const fromRight = cRect.right - r.right;
    const fromBottom = cRect.bottom - r.bottom;

    if (fromBottom < cRect.height * 0.35) {
      const needBottom = cRect.height - fromTop + minMargin + OUTLINE_STROKE_INSET_PX;
      pad.bottom = Math.max(pad.bottom, needBottom);
    }
    if (fromTop < cRect.height * 0.35) {
      const needTop = r.bottom - cRect.top + minMargin + OUTLINE_STROKE_INSET_PX;
      pad.top = Math.max(pad.top, needTop);
    }
    if (fromLeft < cRect.width * 0.4) {
      const needLeft = r.right - cRect.left + minMargin + OUTLINE_STROKE_INSET_PX;
      pad.left = Math.max(pad.left, needLeft);
    }
    if (fromRight < cRect.width * 0.4) {
      const needRight = cRect.right - r.left + minMargin + OUTLINE_STROKE_INSET_PX;
      pad.right = Math.max(pad.right, needRight);
    }
  }

  return pad;
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {{ west: number, south: number, east: number, north: number }} bounds
 */
export function projectBoundsCorners(map, bounds) {
  const corners = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
  ];
  return corners.map(([lng, lat]) => map.project([lng, lat]));
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {{ west: number, south: number, east: number, north: number }} bounds
 * @param {{ top: number, right: number, bottom: number, left: number }} padding
 * @param {HTMLElement} container
 */
export function boundsCornersInsideSafeArea(map, bounds, padding, container) {
  const cRect = container.getBoundingClientRect();
  const safe = {
    left: padding.left,
    top: padding.top,
    right: cRect.width - padding.right,
    bottom: cRect.height - padding.bottom,
  };
  const pts = projectBoundsCorners(map, bounds);
  const eps = 0.5;
  return pts.every(
    (p) =>
      p.x >= safe.left - eps &&
      p.x <= safe.right + eps &&
      p.y >= safe.top - eps &&
      p.y <= safe.bottom + eps
  );
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {{ west: number, south: number, east: number, north: number }} bounds
 * @param {{ duration?: number, maxZoom?: number }} [options]
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function fitMapToBounds(map, bounds, options = {}) {
  const { duration = 0, maxZoom = 17 } = options;
  map.resize();
  const container = map.getContainer();
  const padding = computeMapFitPadding(container);
  map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], {
    padding,
    duration,
    maxZoom,
    essential: true,
  });
  return padding;
}
