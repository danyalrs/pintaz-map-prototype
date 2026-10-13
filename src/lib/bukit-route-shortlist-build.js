import fs from 'node:fs';
import path from 'node:path';
import {
  buildDriveReferenceMap,
  routeSortKey,
  toRedactedRouteEntry,
} from './bukit-route-redaction.js';

function combined(r) {
  return (r.model_frames || 0) + (r.gps_fixes || 0);
}

function routeDateKey(route) {
  const m = String(route).match(/^(\d{4}-\d{2}-\d{2})--/);
  return m ? m[1] : 'unknown';
}

/**
 * Deterministic shortlist (max 10): exclude active route, max 2 per dongle, prefer model_frames + diversity.
 */
export function buildDeterministicShortlist(records, { activeKey, maxRoutes = 10, maxPerDongle = 2 } = {}) {
  const candidates = records
    .filter((r) => routeSortKey(r) !== activeKey)
    .sort(
      (a, b) =>
        b.model_frames - a.model_frames ||
        b.gps_fixes - a.gps_fixes ||
        combined(b) - combined(a) ||
        routeSortKey(a).localeCompare(routeSortKey(b))
    );

  const picked = [];
  const perDongle = new Map();
  const dates = new Set();
  const dongles = new Set();

  for (const r of candidates) {
    if (picked.length >= maxRoutes) break;
    const dCount = perDongle.get(r.dongle) || 0;
    if (dCount >= maxPerDongle) continue;
    picked.push(r);
    perDongle.set(r.dongle, dCount + 1);
    dates.add(routeDateKey(r.route));
    dongles.add(r.dongle);
  }

  // Time diversity pass: add best remaining per unseen date up to cap
  if (picked.length < maxRoutes) {
    const pickedKeys = new Set(picked.map(routeSortKey));
    const byDate = new Map();
    for (const r of candidates) {
      if (pickedKeys.has(routeSortKey(r))) continue;
      const dk = routeDateKey(r.route);
      if (dates.has(dk)) continue;
      const cur = byDate.get(dk);
      if (!cur || r.model_frames > cur.model_frames) byDate.set(dk, r);
    }
    for (const r of [...byDate.values()].sort((a, b) => b.model_frames - a.model_frames)) {
      if (picked.length >= maxRoutes) break;
      if ((perDongle.get(r.dongle) || 0) >= maxPerDongle) continue;
      picked.push(r);
      perDongle.set(r.dongle, (perDongle.get(r.dongle) || 0) + 1);
      dates.add(routeDateKey(r.route));
      pickedKeys.add(routeSortKey(r));
    }
  }

  // Dongle diversity pass
  if (picked.length < maxRoutes) {
    const pickedKeys = new Set(picked.map(routeSortKey));
    for (const r of candidates) {
      if (picked.length >= maxRoutes) break;
      if (pickedKeys.has(routeSortKey(r))) continue;
      if (dongles.has(r.dongle)) continue;
      if ((perDongle.get(r.dongle) || 0) >= maxPerDongle) continue;
      picked.push(r);
      perDongle.set(r.dongle, 1);
      dongles.add(r.dongle);
      pickedKeys.add(routeSortKey(r));
    }
  }

  // Fill remaining slots by model_frames order
  if (picked.length < maxRoutes) {
    const pickedKeys = new Set(picked.map(routeSortKey));
    for (const r of candidates) {
      if (picked.length >= maxRoutes) break;
      if (pickedKeys.has(routeSortKey(r))) continue;
      if ((perDongle.get(r.dongle) || 0) >= maxPerDongle) continue;
      picked.push(r);
      perDongle.set(r.dongle, (perDongle.get(r.dongle) || 0) + 1);
      pickedKeys.add(routeSortKey(r));
    }
  }

  const sortedPicked = [...picked].sort(
    (a, b) =>
      b.model_frames - a.model_frames ||
      routeSortKey(a).localeCompare(routeSortKey(b))
  );

  const refMap = buildDriveReferenceMap(records);
  const dongleCounts = new Map();
  for (const r of sortedPicked) {
    dongleCounts.set(r.dongle, (dongleCounts.get(r.dongle) || 0) + 1);
  }
  const activeKeys = activeKey ? new Set([activeKey]) : new Set();

  const reasons = sortedPicked.map((r, i) => {
    const reasonsList = [];
    if (i === 0) reasonsList.push('highest model-frame count among eligible routes');
    else if (r.model_frames >= sortedPicked[0].model_frames * 0.85) {
      reasonsList.push('strong model-frame count');
    }
    if (r.gps_fixes >= 50) reasonsList.push('strong GPS support');
    if ((perDongle.get(r.dongle) || 0) <= 1 && dongles.size > 3) reasonsList.push('dongle diversity');
    if (dates.size > 3) reasonsList.push('time diversity');
    if (!reasonsList.length) reasonsList.push('high model-frame count');
    return reasonsList.join('; ');
  });

  const privateEntries = sortedPicked.map((r, i) => ({
    dongle: r.dongle,
    route: r.route,
    model_frames: r.model_frames,
    gps_fixes: r.gps_fixes,
    segments: r.segments,
    version: r.version,
    selection_reason: reasons[i],
    drive_ref: refMap.get(routeSortKey(r)),
  }));

  const redactedEntries = sortedPicked.map((r, i) => ({
    ...toRedactedRouteEntry(r, refMap, { activeKeys, dongleCounts }),
    selection_reason: reasons[i],
  }));

  return {
    private: {
      schema: 'pintaz.bukit-route-shortlist.private',
      version: 1,
      max_routes: maxRoutes,
      max_per_dongle: maxPerDongle,
      routes: privateEntries,
    },
    redacted: {
      schema: 'pintaz.bukit-route-shortlist.redacted',
      version: 1,
      count_scope_note: 'unknown per local API docs',
      routes: redactedEntries,
    },
  };
}

export function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}
