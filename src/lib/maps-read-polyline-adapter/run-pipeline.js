import { validateLaneEnrichmentInputContract, toAlgorithmCoreBundle, OUTCOME } from '../lane-enrichment-input-contract/index.js';
import { runLaneEnrichmentCore, DECISION, CONFIDENCE_BAND } from '../lane-enrichment-algorithm-core/index.js';
import { adaptMapsReadPolylineExport } from './adapt.js';
import { REJECTION } from './constants.js';

export function runMapsReadPolylineEndToEnd(serverExport, osmEnrichmentContext = undefined) {
  const adapted = adaptMapsReadPolylineExport(serverExport, osmEnrichmentContext);
  if (!adapted.ok) {
    const outcome =
      adapted.outcome ??
      (adapted.rejection === REJECTION.UNSUPPORTED_POINT_ONLY
        ? OUTCOME.UNSUPPORTED_POINT_ONLY
        : adapted.rejection === REJECTION.MISSING_OSM_ENRICHMENT_CONTEXT
          ? 'missing_osm_enrichment_context'
          : null);
    return {
      adapter_ok: false,
      adapter_rejection: adapted.rejection,
      contract_outcome: outcome,
      algorithm_decision: null,
      selected_lane_count: null,
      confidence_band:
        adapted.rejection === REJECTION.UNSUPPORTED_POINT_ONLY
          ? CONFIDENCE_BAND.UNSUPPORTED_INPUT_GEOMETRY
          : null,
      blocked_before_core: true,
      validation_errors: adapted.errors ?? null,
    };
  }

  const contractValidation = validateLaneEnrichmentInputContract(adapted.contract);
  if (contractValidation.outcome !== OUTCOME.VALID) {
    return {
      adapter_ok: true,
      contract_outcome: contractValidation.outcome,
      algorithm_decision: null,
      selected_lane_count: null,
      confidence_band:
        contractValidation.outcome === OUTCOME.UNSUPPORTED_POINT_ONLY
          ? CONFIDENCE_BAND.UNSUPPORTED_INPUT_GEOMETRY
          : CONFIDENCE_BAND.INSUFFICIENT_OR_CONFLICTING,
      blocked_before_core: true,
      validation_errors: contractValidation.errors,
    };
  }

  const mapped = toAlgorithmCoreBundle(adapted.contract);
  if (!mapped.ok) {
    return {
      adapter_ok: true,
      contract_outcome: mapped.validation?.outcome,
      algorithm_decision: DECISION.UNSUPPORTED_INPUT_GEOMETRY,
      blocked_before_core: true,
    };
  }

  const core = runLaneEnrichmentCore(mapped.bundle);
  return {
    adapter_ok: true,
    contract_outcome: OUTCOME.VALID,
    algorithm_decision: core.decision,
    selected_lane_count: core.selected_lane_count,
    decision_score: core.decision_score,
    confidence_band: core.confidence_band,
    support_type: core.support_type,
    human_review_required: core.human_review_required,
    never_auto_apply: core.never_auto_apply,
    note: core.note ?? null,
    blocked_before_core: false,
  };
}

export { DECISION, OUTCOME, CONFIDENCE_BAND };
