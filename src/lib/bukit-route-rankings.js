import { buildDriveReferenceMap, toRedactedRouteEntry } from './bukit-route-redaction.js';

function combined(r) {
  return (r.model_frames || 0) + (r.gps_fixes || 0);
}

function routeDateKey(route) {
  const m = String(route).match(/^(\d{4}-\d{2}-\d{2})--/);
  return m ? m[1] : 'unknown';
}

function routeTimeKey(route) {
  const m = String(route).match(/^(\d{4}-\d{2}-\d{2})--(\d{2})-(\d{2})-\d{2}$/);
  if (!m) return 'unknown';
  return `${m[1]}T${m[2]}:${m[3]}`;
}

export function buildAllRankings(records, { activeKeys = new Set(), limit = 25 } = {}) {
  const refMap = buildDriveReferenceMap(records);
  const dongleCounts = new Map();
  for (const r of records) {
    dongleCounts.set(r.dongle, (dongleCounts.get(r.dongle) || 0) + 1);
  }

  const wrap = (list) =>
    list.slice(0, limit).map((r) =>
      toRedactedRouteEntry(r, refMap, { activeKeys, dongleCounts })
    );

  const byModelFrames = [...records].sort((a, b) => b.model_frames - a.model_frames || a.route.localeCompare(b.route));
  const byGps = [...records].sort((a, b) => b.gps_fixes - a.gps_fixes || a.route.localeCompare(b.route));
  const byCombined = [...records].sort((a, b) => combined(b) - combined(a) || a.route.localeCompare(b.route));
  const byModelPerRecord = [...records].sort(
    (a, b) => b.model_frames / Math.max(1, b.segments) - a.model_frames / Math.max(1, a.segments) ||
      a.route.localeCompare(b.route)
  );

  const dongleBest = new Map();
  for (const r of records) {
    const cur = dongleBest.get(r.dongle);
    if (!cur || r.model_frames > cur.model_frames) dongleBest.set(r.dongle, r);
  }
  const dongleDiverse = [...dongleBest.values()].sort(
    (a, b) => b.model_frames - a.model_frames || a.dongle.localeCompare(b.dongle)
  );

  const dateBest = new Map();
  for (const r of records) {
    const dk = routeDateKey(r.route);
    const cur = dateBest.get(dk);
    if (!cur || r.model_frames > cur.model_frames) dateBest.set(dk, r);
  }
  const dateDiverse = [...dateBest.values()].sort(
    (a, b) => routeDateKey(a.route).localeCompare(routeDateKey(b.route)) || b.model_frames - a.model_frames
  );

  return {
    highest_model_frames: wrap(byModelFrames),
    highest_gps_fixes: wrap(byGps),
    highest_combined: wrap(byCombined),
    highest_model_frames_per_route_record: wrap(byModelPerRecord),
    dongle_diverse_candidates: wrap(dongleDiverse),
    date_time_diverse_candidates: wrap(dateDiverse),
  };
}
