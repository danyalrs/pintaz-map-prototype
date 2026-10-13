const FT_TO_M = 0.3048;

export function parsePositiveInt(raw) {
  if (raw == null || raw === '') return { kind: 'missing', value: null, raw: null };
  const s = String(raw).trim();
  if (!s) return { kind: 'missing', value: null, raw: s };
  if (/[;|]/.test(s) || /[(@:]/.test(s)) {
    return { kind: 'conditional_or_multiple', value: null, raw: s };
  }
  const m = s.match(/^(\d+)$/);
  if (!m) return { kind: 'invalid', value: null, raw: s };
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 16) return { kind: 'outlier', value: n, raw: s };
  return { kind: 'valid_numeric', value: n, raw: s };
}

export function parseWidthMetres(raw) {
  if (raw == null || raw === '') return { kind: 'missing', metres: null, raw: null };
  const s = String(raw).trim().toLowerCase().replace(/,/g, '.');
  if (!s) return { kind: 'missing', metres: null, raw: s };
  let m = s.match(/^([\d.]+)\s*m$/);
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 && v < 200
      ? { kind: 'valid_metres', metres: v, raw: s }
      : { kind: 'invalid', metres: null, raw: s };
  }
  m = s.match(/^([\d.]+)\s*ft$/);
  if (m) {
    const v = Number(m[1]) * FT_TO_M;
    return Number.isFinite(v) && v > 0 && v < 200
      ? { kind: 'valid_feet_converted', metres: v, raw: s }
      : { kind: 'invalid', metres: null, raw: s };
  }
  m = s.match(/^([\d.]+)$/);
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 && v < 200
      ? { kind: 'valid_metres', metres: v, raw: s }
      : { kind: 'invalid', metres: null, raw: s };
  }
  return { kind: 'invalid', metres: null, raw: s };
}

export function parseOneway(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'no' || s === 'false' || s === '0') {
    return { isOneway: false, reverse: false, raw: s || null };
  }
  if (s === '-1') return { isOneway: true, reverse: true, raw: s };
  if (s === 'yes' || s === 'true' || s === '1') return { isOneway: true, reverse: false, raw: s };
  return { isOneway: false, reverse: false, raw: s, ambiguous: true };
}
