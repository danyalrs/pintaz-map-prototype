export const ROUTES_LIST_LIMITS = {
  maxRecords: 2500,
  maxPages: 100,
  maxTotalBytes: 25 * 1024 * 1024,
  minDelayMs: 250,
  maxRetriesTransient: 3,
  defaultLimit: 500,
  maxLimit: 500,
};

const TRANSIENT_HTTP = new Set([500, 502, 503, 504]);

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP.has(status);
}

export function shouldNeverRetryRoutesStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

/**
 * @returns {{ stop: boolean, reason?: string }}
 */
export function evaluateRoutesOffsetStep({ returned, nextOffset, previousOffset, seenOffsets }) {
  if (returned === 0) return { stop: true, reason: 'returned_zero' };
  if (nextOffset == null) return { stop: true, reason: 'next_offset_absent' };
  if (seenOffsets.has(nextOffset)) return { stop: true, reason: 'next_offset_repeated' };
  if (previousOffset != null && Number(nextOffset) <= Number(previousOffset)) {
    return { stop: true, reason: 'next_offset_backward' };
  }
  return { stop: false };
}

export function backoffMs(attempt) {
  return Math.min(8000, 400 * 2 ** attempt);
}
