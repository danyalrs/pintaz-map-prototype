import { signatureToFeatureVector } from './signature.js';

function meanVector(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

export function buildLaneCountPrototypes(trainingFrames, { laneCounts } = {}) {
  const byLabel = new Map();
  for (const fr of trainingFrames) {
    const label = fr.osm_lane_count;
    if (label == null) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(signatureToFeatureVector(fr.signature));
  }
  const labels = laneCounts?.length ? laneCounts : [...byLabel.keys()].sort((a, b) => a - b);
  const prototypes = {};
  for (const label of labels) {
    const vectors = byLabel.get(label) || [];
    prototypes[label] = vectors.length ? meanVector(vectors) : null;
  }
  return { prototypes, labels: labels.filter((l) => prototypes[l]) };
}

export function l2Distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}
