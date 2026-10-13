import { LIMITS, CANDIDATE_TYPE } from './constants.js';
import { signatureToFeatureVector } from './signature.js';
import { signatureQualityResult, selectBestQualityFrame } from './quality.js';
import { l2Distance } from './prototypes.js';

export function classifySignatureVector(vector, { prototypes, labels }) {
  const effectiveLabels = (labels || []).filter((label) => prototypes?.[label]);
  if (!effectiveLabels.length) {
    return {
      abstained: true,
      reason: 'insufficient_reference_prototypes',
      best: { label: null, distance: null },
      second: { label: null, distance: Infinity },
      margin: 0,
      distances: [],
    };
  }
  const distances = effectiveLabels
    .map((label) => ({
      label,
      distance: l2Distance(vector, prototypes[label]),
    }))
    .sort((a, b) => a.distance - b.distance);
  const best = distances[0];
  const second = distances[1] || { distance: Infinity, label: null };
  const margin = second.distance - best.distance;
  return { best, second, margin, distances };
}

export function predictFromFrames(frames, model, { mode = 'single' } = {}) {
  const qualityFrames = frames
    .map((fr) => ({ fr, q: signatureQualityResult(fr.signature) }))
    .filter((x) => x.q.pass);

  if (!qualityFrames.length) {
    return {
      predicted_lane_count: null,
      candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
      score_margin: 0,
      best_distance: null,
      signature_quality: { pass: false, failures: ['no_quality_frames'] },
      out_of_domain: false,
    };
  }

  if (mode === 'multi') {
    const preds = qualityFrames.map(({ fr }) => {
      const vector = signatureToFeatureVector(fr.signature);
      const { best, margin } = classifySignatureVector(vector, model);
      return { frame_id: fr.frame_id, label: best.label, distance: best.distance, margin };
    });
    const freq = new Map();
    for (const p of preds) freq.set(p.label, (freq.get(p.label) || 0) + 1);
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const [modeLabel, modeCount] = sorted[0];
    const agreement = modeCount / preds.length;
    if (modeCount < LIMITS.multiFrameMinFrames || agreement < LIMITS.multiFrameAgreementFraction) {
      return {
        predicted_lane_count: null,
        candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
        score_margin: 0,
        best_distance: null,
        signature_quality: { pass: true, failures: ['multi_frame_no_agreement'] },
        out_of_domain: false,
      };
    }
    const rep = preds.find((p) => p.label === modeLabel);
    const vector = signatureToFeatureVector(
      qualityFrames.find((x) => x.fr.frame_id === rep.frame_id).fr.signature
    );
    return finalizePrediction(vector, model, CANDIDATE_TYPE.MULTI_FRAME);
  }

  const bestFrame = selectBestQualityFrame(frames);
  if (!bestFrame) {
    return {
      predicted_lane_count: null,
      candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
      score_margin: 0,
      best_distance: null,
      signature_quality: signatureQualityResult(frames[0]?.signature || {}),
      out_of_domain: false,
    };
  }
  const vector = signatureToFeatureVector(bestFrame.signature);
  const q = signatureQualityResult(bestFrame.signature);
  const out = finalizePrediction(vector, model, CANDIDATE_TYPE.SINGLE_POINT);
  return { ...out, signature_quality: q };
}

function finalizePrediction(vector, model, candidateType) {
  const classified = classifySignatureVector(vector, model);
  if (classified.abstained || classified.best.distance == null) {
    return {
      predicted_lane_count: null,
      candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
      score_margin: 0,
      best_distance: null,
      signature_quality: {
        pass: false,
        failures: [classified.reason || 'insufficient_reference_prototypes'],
      },
      out_of_domain: false,
    };
  }
  const { best, second, margin } = classified;
  const outOfDomain = best.distance >= LIMITS.outOfDomainMinDistance;
  if (
    outOfDomain ||
    best.distance > LIMITS.abstainMaxBestDistance ||
    margin < LIMITS.abstainMargin
  ) {
    return {
      predicted_lane_count: null,
      candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
      score_margin: Math.round(margin * 1000) / 1000,
      best_distance: Math.round(best.distance * 1000) / 1000,
      signature_quality: { pass: true, failures: outOfDomain ? ['out_of_domain'] : ['low_margin_or_distance'] },
      out_of_domain: outOfDomain,
      nearest_label: best.label,
    };
  }
  return {
    predicted_lane_count: best.label,
    candidate_type: candidateType,
    score_margin: Math.round(margin * 1000) / 1000,
    best_distance: Math.round(best.distance * 1000) / 1000,
    signature_quality: { pass: true, failures: [] },
    out_of_domain: false,
    runner_up_label: second.label,
  };
}
