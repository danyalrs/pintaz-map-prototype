/**
 * Route completeness classification from stored Maps Read GeoJSON metadata.
 * Does not rewrite raw responses.
 */

export function classifyRouteCompleteness(metadata = {}) {
  const truncated = metadata.truncated;
  const next = metadata.next_after_seg;
  const nextAbsent = next === null || next === undefined;
  if (truncated === false && nextAbsent) {
    return 'complete_single_response_route';
  }
  if (truncated === true || !nextAbsent) {
    return 'partial_response_requires_pagination';
  }
  return 'unknown_response_shape';
}

export function classifyFailedDownload(stopReason) {
  if (stopReason === 'response_too_large') return 'unmeasured_response_too_large';
  return 'unmeasured_request_failed';
}
