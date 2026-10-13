/** Development-only exposure of the live Mapbox map on window.__pintazMap. */

export function isLocalhostHostname(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1';
}

export function debugMapParamEnabled(search) {
  const raw = search == null ? '' : String(search);
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(q).get('debug-map') === '1';
}

export function shouldExposeDebugMap(hostname, search) {
  return isLocalhostHostname(hostname) && debugMapParamEnabled(search);
}

/**
 * @param {object} map - Mapbox GL map instance
 * @param {Window|undefined} windowObj
 * @param {string} hostname
 * @param {string} search - location.search
 */
export function applyDebugMapExposure(map, windowObj, hostname, search) {
  if (!windowObj) return;
  if (shouldExposeDebugMap(hostname, search)) {
    windowObj.__pintazMap = map;
  } else if ('__pintazMap' in windowObj) {
    delete windowObj.__pintazMap;
  }
}
