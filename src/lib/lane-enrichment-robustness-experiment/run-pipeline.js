import { validateLaneEnrichmentInputContract, OUTCOME as CONTRACT_OUTCOME } from '../lane-enrichment-input-contract/index.js';
import { toAlgorithmCoreBundle } from '../lane-enrichment-input-contract/to-algorithm-core.js';
import {
  runLaneEnrichmentCore,
  DECISION,
  CONFIDENCE_BAND,
  SUPPORT_TYPE,
} from '../lane-enrichment-algorithm-core/index.js';

function blockedRow(contractOutcome, trueLaneCount, rawContract, extra = {}) {
  const unsupported = contractOutcome === CONTRACT_OUTCOME.UNSUPPORTED_POINT_ONLY;
  return {
    contract_outcome: contractOutcome,
    algorithm_decision: extra.algorithm_decision ?? null,
    selected_lane_count: null,
    decision_score: null,
    confidence_band: unsupported
      ? CONFIDENCE_BAND.UNSUPPORTED_INPUT_GEOMETRY
      : CONFIDENCE_BAND.INSUFFICIENT_OR_CONFLICTING,
    support_type: SUPPORT_TYPE.NONE,
    true_lane_count: trueLaneCount,
    frame_count: rawContract.vehicle_frames?.length ?? rawContract.features?.length ?? 0,
    valid_frame_count: 0,
    rejected_frame_count: 0,
    classification: 'insufficient',
    blocked_before_core: true,
    ...extra,
  };
}

export function runScenarioPipeline(rawContract, trueLaneCount) {
  const contractValidation = validateLaneEnrichmentInputContract(rawContract);
  if (contractValidation.outcome !== CONTRACT_OUTCOME.VALID) {
    return blockedRow(contractValidation.outcome, trueLaneCount, rawContract);
  }
  const mapped = toAlgorithmCoreBundle(rawContract);
  if (!mapped.ok) {
    return blockedRow(mapped.validation?.outcome, trueLaneCount, rawContract, {
      algorithm_decision: DECISION.UNSUPPORTED_INPUT_GEOMETRY,
      confidence_band: CONFIDENCE_BAND.UNSUPPORTED_INPUT_GEOMETRY,
    });
  }
  const result = runLaneEnrichmentCore(mapped.bundle);
  const frameEvidence = result.frame_evidence || [];
  const valid_frame_count = frameEvidence.filter((f) => f.accepted).length;
  const rejected_frame_count = frameEvidence.length - valid_frame_count;

  let classification = 'insufficient';
  const cand = [DECISION.SINGLE_FRAME_REVIEW_CANDIDATE, DECISION.MULTI_FRAME_REVIEW_CANDIDATE];
  if (cand.includes(result.decision)) {
    classification = result.selected_lane_count === trueLaneCount ? 'correct' : 'incorrect';
  } else {
    classification = 'insufficient';
  }

  return {
    contract_outcome: CONTRACT_OUTCOME.VALID,
    algorithm_decision: result.decision,
    selected_lane_count: result.selected_lane_count,
    decision_score: result.decision_score ?? null,
    confidence_band: result.confidence_band ?? CONFIDENCE_BAND.INSUFFICIENT_OR_CONFLICTING,
    support_type: result.support_type ?? SUPPORT_TYPE.NONE,
    true_lane_count: trueLaneCount,
    frame_count: frameEvidence.length,
    valid_frame_count,
    rejected_frame_count,
    classification,
    blocked_before_core: false,
    note: result.note ?? null,
  };
}
