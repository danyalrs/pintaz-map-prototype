export const DEFAULT_AREA_ID = 'bukit-bintang-imbi';
export const FALLBACK_AREA_ID = 'bandar-kinrara';

const SAFE_AREA_ID = /^[a-z][a-z0-9-]*$/;

export function sanitizeAreaId(raw) {
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  if (!SAFE_AREA_ID.test(id)) return null;
  return id;
}

export function parseAreaFromLocation(search = window.location.search, knownIds = null) {
  const params = new URLSearchParams(search);
  const raw = params.get('area');
  if (!raw || !String(raw).trim()) return DEFAULT_AREA_ID;
  const id = sanitizeAreaId(raw);
  if (!id) return DEFAULT_AREA_ID;
  if (knownIds && !knownIds.includes(id)) return DEFAULT_AREA_ID;
  return id;
}

export function setAreaInUrl(areaId, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (areaId === DEFAULT_AREA_ID) {
    url.searchParams.delete('area');
  } else {
    url.searchParams.set('area', areaId);
  }
  const state = { areaId };
  if (replace) {
    history.replaceState(state, '', url);
  } else {
    history.pushState(state, '', url);
  }
}

export function bindAreaHistory(onAreaChange) {
  window.addEventListener('popstate', () => {
    onAreaChange(parseAreaFromLocation(), { updateUrl: false });
  });
}

export function areaSubtitle(displayName) {
  return `${displayName} · 2 km × 2 km`;
}
