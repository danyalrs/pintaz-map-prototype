/** Display-only formatting — does not alter stored numeric values. */

export function formatMetres(value, { maxDecimals = 2, normalDecimals = 1 } = {}) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return 'Not provided';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not provided';
  const rounded =
    Math.abs(n - Math.round(n)) < 1e-9
      ? String(Math.round(n))
      : Number(n.toFixed(maxDecimals)).toString();
  const asNum = Number(rounded);
  const useNormal =
    normalDecimals < maxDecimals &&
    Math.abs(asNum * 10 - Math.round(asNum * 10)) < 1e-6;
  const display = useNormal ? asNum.toFixed(normalDecimals) : rounded;
  return `${display} m`;
}

export function formatDistanceMetres(value) {
  return formatMetres(value, { maxDecimals: 2, normalDecimals: 1 });
}

export function formatConfidence(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return 'Not provided';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not provided';
  return String(Number(n.toFixed(3)));
}

export function formatCount(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return 'Not provided';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not provided';
  return String(Math.round(n));
}

export function formatPlainNumber(value, decimals = 2) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return 'Not provided';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not provided';
  return String(Number(n.toFixed(decimals)));
}
