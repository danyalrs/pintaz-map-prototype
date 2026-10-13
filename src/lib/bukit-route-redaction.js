/**
 * Deterministic drive references (drive-001, drive-002, …) for browser-safe output.
 */

export function routeSortKey(record) {
  return `${record.dongle}\0${record.route}`;
}

export function buildDriveReferenceMap(records) {
  const sorted = [...records].sort((a, b) => routeSortKey(a).localeCompare(routeSortKey(b)));
  const map = new Map();
  let idx = 1;
  for (const r of sorted) {
    const key = routeSortKey(r);
    if (!map.has(key)) {
      map.set(key, `drive-${String(idx).padStart(3, '0')}`);
      idx += 1;
    }
  }
  return map;
}

export function redactRouteTime(routeId) {
  if (!routeId || typeof routeId !== 'string') return null;
  const m = routeId.match(/^(\d{4}-\d{2}-\d{2})--(\d{2})-(\d{2})-\d{2}$/);
  if (!m) return 'unknown';
  return `${m[1]} ${m[2]}:${m[3]} (local route id redacted)`;
}

export function toRedactedRouteEntry(record, refMap, { activeKeys, dongleCounts }) {
  const key = routeSortKey(record);
  const sameDongleOther = (dongleCounts.get(record.dongle) || 0) > 1;
  return {
    drive_ref: refMap.get(key),
    model_frames: record.model_frames,
    gps_fixes: record.gps_fixes,
    combined_count: (record.model_frames || 0) + (record.gps_fixes || 0),
    route_datetime_redacted: redactRouteTime(record.route),
    same_dongle_as_another_shortlisted_route: sameDongleOther ? 'yes' : 'no',
    existing_active_route: activeKeys.has(key) ? 'yes' : 'no',
    count_scope: 'unknown',
    segments: record.segments,
    version: record.version,
  };
}

function isolatedHex16Tokens(text) {
  const re = /(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])/gi;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) tokens.push(m[0]);
  return tokens;
}

export function containsFullDongle(text) {
  const s = String(text);
  if (/"dongle"\s*:\s*"[0-9a-f]{16}"/i.test(s)) return true;
  return isolatedHex16Tokens(s).some((tok) => /[a-f]/i.test(tok));
}
