import { redactRouteTime } from './bukit-route-redaction.js';

/**
 * Deterministic redacted dongle groups (dongle-group-A, …) from private dongle ids.
 * @param {Array<{ probe_ref: string, dongle: string, route: string, completeness_class?: string }>} entries
 */
export function buildRedactedDongleGroups(entries) {
  const uniqueDongles = [...new Set(entries.map((e) => e.dongle).filter(Boolean))].sort();
  const dongleToGroup = new Map();
  uniqueDongles.forEach((d, i) => {
    dongleToGroup.set(d, `dongle-group-${String.fromCharCode(65 + i)}`);
  });

  const routes = entries.map((e) => ({
    probe_ref: e.probe_ref,
    inventory_drive_ref: e.inventory_drive_ref ?? null,
    dongle_group: e.dongle ? dongleToGroup.get(e.dongle) : null,
    route_datetime_redacted: redactRouteTime(e.route),
    completeness_class: e.completeness_class ?? null,
    status_note: e.status_note ?? null,
  }));

  const groups = uniqueDongles.map((d, i) => ({
    dongle_group: `dongle-group-${String.fromCharCode(65 + i)}`,
    route_count: entries.filter((e) => e.dongle === d).length,
    probe_refs: entries.filter((e) => e.dongle === d).map((e) => e.probe_ref),
  }));

  return { dongleToGroup, groups, routes };
}
