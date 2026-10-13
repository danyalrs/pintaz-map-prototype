/**
 * Transparent confidence score in [0, 1]. High score cannot override failed mandatory gates.
 */
export function computeMismatchConfidence(inputs) {
  const {
    frameCount = 0,
    sectionLengthM = 0,
    headingAgreement = 1,
    temporalContinuity = 1,
    bothEdgeFrameRate = 0,
    dividerMatchStability = 0,
    spanStability = 0,
    sensitivityStable = false,
    junctionPenalty = 0,
    parallelPenalty = 0,
    partialCrossPenalty = 0,
    displayEstimatePenalty = 0,
  } = inputs;

  const contributions = {
    frames: Math.min(1, frameCount / 20) * 0.15,
    length: Math.min(1, sectionLengthM / 80) * 0.1,
    heading: Math.max(0, 1 - headingAgreement / 45) * 0.1,
    temporal: temporalContinuity * 0.1,
    both_edges: bothEdgeFrameRate * 0.15,
    divider_stability: dividerMatchStability * 0.1,
    span_stability: spanStability * 0.1,
    sensitivity: sensitivityStable ? 0.1 : 0,
  };
  const penalties =
    junctionPenalty * 0.15 +
    parallelPenalty * 0.15 +
    partialCrossPenalty * 0.2 +
    displayEstimatePenalty * 0.05;
  const raw =
    Object.values(contributions).reduce((a, b) => a + b, 0) - penalties;
  const score = Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000));
  return { score, contributions, penalties: Math.round(penalties * 1000) / 1000 };
}
