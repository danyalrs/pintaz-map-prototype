export const PAGINATION_LIMITS = {
  maxPages: 100,
  maxTotalBytes: 500 * 1024 * 1024,
  minDelayMs: 250,
  maxRetriesTransient: 3,
  maxSingleResponseBytes: 120 * 1024 * 1024,
};

const TRANSIENT_HTTP = new Set([500, 502, 503, 504]);

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP.has(status);
}

export function shouldNeverRetryStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

/**
 * @returns {{ stop: boolean, reason?: string }}
 */
export function evaluatePaginationStep({
  truncated,
  nextAfterSeg,
  previousAfterSeg,
  seenAfterSegs,
}) {
  if (truncated === false) return { stop: true, reason: 'truncated_false' };
  if (nextAfterSeg == null) return { stop: true, reason: 'next_after_seg_absent' };
  if (seenAfterSegs.has(nextAfterSeg)) return { stop: true, reason: 'next_after_seg_repeated' };
  if (previousAfterSeg != null && Number(nextAfterSeg) <= Number(previousAfterSeg)) {
    return { stop: true, reason: 'next_after_seg_backward' };
  }
  return { stop: false };
}

export function backoffMs(attempt) {
  return Math.min(8000, 400 * 2 ** attempt);
}
