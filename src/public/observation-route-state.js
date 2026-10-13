let selectedRouteKey = 'active';

export function getObservationRouteKey() {
  return selectedRouteKey;
}

export function setObservationRouteKey(routeKey) {
  selectedRouteKey = routeKey || 'active';
}

export function isDiagnosticObservationRoute() {
  return selectedRouteKey !== 'active';
}
