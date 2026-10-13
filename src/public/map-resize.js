/**
 * Keep Mapbox canvas size in sync with its container (sidebar/layout changes, fitBounds, window resize).
 * @param {import('mapbox-gl').Map} map
 * @param {HTMLElement} container
 * @returns {() => void} disconnect cleanup
 */
export function attachMapResize(map, container) {
  let lastWidth = 0;
  let lastHeight = 0;
  let scheduled = false;

  const applyResize = () => {
    scheduled = false;
    const width = Math.round(container.clientWidth);
    const height = Math.round(container.clientHeight);
    if (width <= 0 || height <= 0) return;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    map.resize();
  };

  const scheduleResize = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyResize);
  };

  map.on('load', scheduleResize);
  scheduleResize();
  requestAnimationFrame(scheduleResize);

  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(scheduleResize);
    observer.observe(container);
  }

  const onWindowResize = () => scheduleResize();
  window.addEventListener('resize', onWindowResize);

  return () => {
    if (observer) observer.disconnect();
    window.removeEventListener('resize', onWindowResize);
  };
}

/** @internal test helper */
export function shouldApplyMapResize(lastWidth, lastHeight, width, height) {
  if (width <= 0 || height <= 0) return false;
  return width !== lastWidth || height !== lastHeight;
}
