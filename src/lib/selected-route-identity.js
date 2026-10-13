import fs from 'node:fs';
import { redactDongle, redactRoute } from './update-preview-prepare.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from './selected-route-paths.js';

export function loadRouteSelectionPrivate() {
  if (!fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)) {
    throw new Error('route_selection_missing');
  }
  const data = JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8'));
  const dongle = data?.selected?.dongle;
  const route = data?.selected?.route;
  if (!dongle || !route) throw new Error('route_selection_incomplete');
  return {
    bbox: data.bbox,
    dongle,
    route,
    dongle_redacted: redactDongle(dongle),
    route_redacted: redactRoute(route),
  };
}

export function routeIdentityFromCollection(collection) {
  const md = collection?.metadata ?? {};
  const dongle = md.dongle_id ?? md.dongle ?? null;
  let route = md.route ?? null;
  if (!route && Array.isArray(md.routes) && md.routes.length) route = md.routes[0];
  return { dongle, route, routes: md.routes ?? null };
}

export function assertRouteIdentityMatches(collection, expected) {
  const got = routeIdentityFromCollection(collection);
  const routeOk = got.route === expected.route || (Array.isArray(got.routes) && got.routes.includes(expected.route));
  if (got.dongle !== expected.dongle || !routeOk) {
    return {
      ok: false,
      reason: 'route_identity_mismatch',
      expected_redacted: {
        dongle: expected.dongle_redacted,
        route: expected.route_redacted,
      },
    };
  }
  return { ok: true };
}
