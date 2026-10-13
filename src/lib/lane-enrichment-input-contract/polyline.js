export function validatePolylineVertices(coordinates_local_m) {
  if (!Array.isArray(coordinates_local_m)) {
    return { ok: false, reason: 'not_array' };
  }
  if (coordinates_local_m.length < 2) {
    return { ok: false, reason: 'one_vertex' };
  }
  const parsed = [];
  for (const v of coordinates_local_m) {
    if (!Array.isArray(v) || v.length < 2) return { ok: false, reason: 'bad_vertex' };
    const f = Number(v[0]);
    const l = Number(v[1]);
    if (!Number.isFinite(f) || !Number.isFinite(l)) return { ok: false, reason: 'non_numeric' };
    parsed.push([f, l]);
  }
  const allSame = parsed.every(
    (p) => p[0] === parsed[0][0] && p[1] === parsed[0][1]
  );
  if (allSame) return { ok: false, reason: 'repeated_identical_vertices' };
  return { ok: true, vertices: parsed };
}
