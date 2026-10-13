import fs from 'node:fs';
import { redactDongle, redactRoute } from './update-preview-prepare.js';
import { SHORTLIST_PRIVATE_PATH } from './bukit-route-shortlist-paths.js';
import { formatProbeRef, MAX_SHORTLIST_ROUTES } from './bukit-page1-probe-paths.js';

export function loadShortlistProbeCandidates() {
  if (!fs.existsSync(SHORTLIST_PRIVATE_PATH)) {
    throw new Error('shortlist_private_missing');
  }
  const doc = JSON.parse(fs.readFileSync(SHORTLIST_PRIVATE_PATH, 'utf8'));
  const routes = (doc.routes || []).slice(0, MAX_SHORTLIST_ROUTES);
  if (routes.length < MAX_SHORTLIST_ROUTES) {
    throw new Error(`shortlist_incomplete:${routes.length}`);
  }
  return routes.map((r, i) => {
    const probeRef = formatProbeRef(i + 1);
    return {
      probe_ref: probeRef,
      inventory_drive_ref: r.drive_ref,
      dongle: r.dongle,
      route: r.route,
      model_frames: r.model_frames,
      gps_fixes: r.gps_fixes,
      selection_reason: r.selection_reason,
      dongle_redacted: redactDongle(r.dongle),
      route_redacted: redactRoute(r.route),
    };
  });
}

export function buildDriveRefMapPrivate(candidates) {
  return {
    schema: 'pintaz.bukit-page1-probe.drive-ref-map.private',
    version: 1,
    mappings: candidates.map((c) => ({
      probe_ref: c.probe_ref,
      inventory_drive_ref: c.inventory_drive_ref,
      dongle_redacted: c.dongle_redacted,
      route_redacted: c.route_redacted,
      dongle: c.dongle,
      route: c.route,
    })),
  };
}
