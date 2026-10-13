/**
 * Transport-only normalization: bare JSON `NaN` tokens → `null` outside quoted strings.
 */

import { createHash } from 'node:crypto';

function tokenBoundaryOk(text, i, len) {
  const prev = i > 0 ? text[i - 1] : '';
  const next = i + len < text.length ? text[i + len] : '';
  const prevOk = i === 0 || /[\s,:{}\[\]]/.test(prev);
  const nextOk = i + len >= text.length || /[\s,:{}\[\]]/.test(next);
  return prevOk && nextOk;
}

function isBareNanStart(text, i) {
  if (text.slice(i, i + 3) !== 'NaN') return false;
  return tokenBoundaryOk(text, i, 3);
}

function isBareNegativeInfinityStart(text, i) {
  if (text.slice(i, i + 9) !== '-Infinity') return false;
  return tokenBoundaryOk(text, i, 9);
}

function isBareInfinityStart(text, i) {
  if (text.slice(i, i + 8) !== 'Infinity') return false;
  return tokenBoundaryOk(text, i, 8);
}

/**
 * @returns {{ normalized: string, replacementCount: number, affectedPropertyNames: string[] }}
 */
function scanReplaceNonStandardNumericTokens(text, { nan = true, infinity = true } = {}) {
  const parts = [];
  let chunk = '';
  let inString = false;
  let escape = false;
  let replacementCount = 0;
  let nanCount = 0;
  let infinityCount = 0;
  let negativeInfinityCount = 0;
  const affectedNames = new Set();

  const flush = () => {
    if (chunk) {
      parts.push(chunk);
      chunk = '';
    }
  };
  const pushChar = (ch) => {
    chunk += ch;
    if (chunk.length >= 65536) flush();
  };
  const replaceTokenAt = (tokenLen, label) => {
    const lookback = (parts.length ? parts[parts.length - 1] : '') + chunk;
    const propMatch = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*$/.exec(lookback.trimEnd());
    if (propMatch?.[1]) affectedNames.add(propMatch[1]);
    flush();
    parts.push('null');
    replacementCount += 1;
    if (label === 'nan') nanCount += 1;
    else if (label === 'neg_inf') negativeInfinityCount += 1;
    else infinityCount += 1;
    return tokenLen - 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      pushChar(ch);
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      pushChar(ch);
      continue;
    }

    if (infinity && isBareNegativeInfinityStart(text, i)) {
      i += replaceTokenAt(9, 'neg_inf');
      continue;
    }
    if (nan && isBareNanStart(text, i)) {
      i += replaceTokenAt(3, 'nan');
      continue;
    }
    if (infinity && isBareInfinityStart(text, i)) {
      i += replaceTokenAt(8, 'inf');
      continue;
    }

    pushChar(ch);
  }
  flush();

  return {
    normalized: parts.join(''),
    replacementCount,
    nanCount,
    infinityCount,
    negativeInfinityCount,
    affectedPropertyNames: [...affectedNames].sort(),
  };
}

export function normalizeBareNanInJson(text) {
  const r = scanReplaceNonStandardNumericTokens(text, { nan: true, infinity: false });
  return {
    normalized: r.normalized,
    replacementCount: r.replacementCount,
    affectedPropertyNames: r.affectedPropertyNames,
  };
}

/**
 * Bare NaN / Infinity / -Infinity (outside strings) → JSON null.
 */
export function normalizeNonStandardJsonNumericTokens(text) {
  const r = scanReplaceNonStandardNumericTokens(text, { nan: true, infinity: true });
  return {
    normalized: r.normalized,
    replacementCount: r.replacementCount,
    nanCount: r.nanCount,
    infinityCount: r.infinityCount,
    negativeInfinityCount: r.negativeInfinityCount,
    affectedPropertyNames: r.affectedPropertyNames,
  };
}

export function sha256Hex(bufferOrString) {
  const buf = typeof bufferOrString === 'string' ? Buffer.from(bufferOrString, 'utf8') : bufferOrString;
  return createHash('sha256').update(buf).digest('hex');
}
