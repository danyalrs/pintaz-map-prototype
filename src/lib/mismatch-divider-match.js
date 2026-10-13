/**
 * Greedy monotonic lane-divider matching in road-relative lateral metres.
 * One observation ↔ one divider per frame.
 */
export function matchDividersMonotonic(obsLaterals, dividerOffsets, maxResidualM) {
  const obs = [...obsLaterals]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d - b.d);
  const divs = [...dividerOffsets]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d - b.d);
  const pairs = [];
  const usedObs = new Set();
  const usedDiv = new Set();
  let oi = 0;
  for (let di = 0; di < divs.length && oi < obs.length; di++) {
    while (oi < obs.length && usedObs.has(obs[oi].i)) oi += 1;
    if (oi >= obs.length) break;
    let best = null;
    for (let j = oi; j < obs.length; j++) {
      if (usedObs.has(obs[j].i)) continue;
      const residual = obs[j].d - divs[di].d;
      if (Math.abs(residual) > maxResidualM) continue;
      if (!best || Math.abs(residual) < Math.abs(best.residual)) {
        best = { obsIndex: obs[j].i, divIndex: divs[di].i, residual, obsD: obs[j].d, divD: divs[di].d };
      }
    }
    if (best) {
      pairs.push(best);
      usedObs.add(best.obsIndex);
      usedDiv.add(best.divIndex);
    }
  }
  const unmatchedObs = obs.filter((o) => !usedObs.has(o.i)).map((o) => o.i);
  const unmatchedDiv = divs.filter((d) => !usedDiv.has(d.i)).map((d) => d.i);
  return { pairs, unmatchedObs, unmatchedDiv };
}

export function estimateCommonCentreShift(edgeLeftD, edgeRightD) {
  const shifts = [];
  for (let i = 0; i < edgeLeftD.length; i++) {
    const l = edgeLeftD[i];
    const r = edgeRightD[i];
    if (l == null || r == null) continue;
    if (r <= l) continue;
    shifts.push((l + r) / 2);
  }
  if (!shifts.length) return null;
  shifts.sort((a, b) => a - b);
  const mid = Math.floor(shifts.length / 2);
  return shifts.length % 2 ? shifts[mid] : (shifts[mid - 1] + shifts[mid]) / 2;
}
