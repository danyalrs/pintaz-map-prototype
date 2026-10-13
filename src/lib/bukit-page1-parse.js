import { normalizeBareNanInJson } from './json-nan-normalize.js';

/** Parse validated Maps Read page bytes without O(n²) string rebuild when JSON is strict. */
export function parseProbePageCollection(buf) {
  const text = buf.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    const { normalized } = normalizeBareNanInJson(text);
    return JSON.parse(normalized);
  }
}
