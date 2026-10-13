export const PAGE1_PROBE_LIMITS = {
  maxRequests: 10,
  maxSingleResponseBytes: 25 * 1024 * 1024,
  maxTotalBytes: 150 * 1024 * 1024,
  minDelayMs: 500,
  maxRetriesTransient: 3,
  maxFeatures: 80000,
};

const TRANSIENT_HTTP = new Set([500, 502, 503, 504]);

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP.has(status);
}

export function shouldNeverRetryProbeStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

export function backoffMs(attempt) {
  return Math.min(8000, 400 * 2 ** attempt);
}
