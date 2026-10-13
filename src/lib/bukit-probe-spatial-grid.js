import { vehiclePoseGridCells } from './bukit-page1-coverage.js';

export function jaccardSimilarity(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const k of setA) {
    if (setB.has(k)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function setUnion(sets) {
  const u = new Set();
  for (const s of sets) {
    for (const k of s) u.add(k);
  }
  return u;
}

export function marginalNewCells(routeCells, coveredCells) {
  let n = 0;
  for (const c of routeCells) {
    if (!coveredCells.has(c)) n += 1;
  }
  return n;
}

export function cellsFromFeatures(features) {
  return vehiclePoseGridCells(features);
}

export function pairwiseOverlapReport(routeCellMap) {
  const refs = [...routeCellMap.keys()].sort();
  const pairs = [];
  for (let i = 0; i < refs.length; i += 1) {
    for (let j = i + 1; j < refs.length; j += 1) {
      const a = refs[i];
      const b = refs[j];
      const ca = routeCellMap.get(a);
      const cb = routeCellMap.get(b);
      let inter = 0;
      for (const k of ca) {
        if (cb.has(k)) inter += 1;
      }
      pairs.push({
        route_a: a,
        route_b: b,
        jaccard: jaccardSimilarity(ca, cb),
        shared_cells: inter,
        union_cells: ca.size + cb.size - inter,
      });
    }
  }
  return pairs;
}

export function combinationUnions(routeCellMap, refs) {
  const sets = refs.map((r) => routeCellMap.get(r)).filter(Boolean);
  return setUnion(sets).size;
}
