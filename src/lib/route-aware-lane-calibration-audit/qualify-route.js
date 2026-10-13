import {
  MINIMUM_SUPPORT_POLICY,
  ROUTE_VERDICT,
  INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT,
} from './constants.js';
import {
  eligibleLabelledWaysOnRoute,
  labelledOneWayWaysOnRoute,
  routeSourceQualitySummary,
} from './route-corpus.js';

export function qualifyRoute({ routeKey, bundle_ok, waysMap, evaluation }) {
  const labelled = labelledOneWayWaysOnRoute(waysMap);
  const eligible = eligibleLabelledWaysOnRoute(waysMap);
  const quality = routeSourceQualitySummary(waysMap, { labelledOnly: true });
  const primary = evaluation.single_best_frame.metrics;

  const reasons = [];
  if (!bundle_ok) {
    reasons.push('missing_local_preview_or_matched_poses');
    return verdictRow(routeKey, ROUTE_VERDICT.NOT_EVALUABLE, {
      labelled,
      eligible,
      quality,
      primary,
      reasons,
    });
  }
  if (labelled.length < MINIMUM_SUPPORT_POLICY.min_labelled_one_way_ways_any_frames) {
    reasons.push('no_labelled_one_way_ways_on_route');
    return verdictRow(routeKey, ROUTE_VERDICT.NOT_EVALUABLE, {
      labelled,
      eligible,
      quality,
      primary,
      reasons,
    });
  }
  if (
    evaluation?.insufficient_same_route_labelled_support === true ||
    eligible.length < MINIMUM_SUPPORT_POLICY.min_eligible_labelled_one_way_ways
  ) {
    reasons.push(INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT);
    return verdictRow(routeKey, ROUTE_VERDICT.NOT_EVALUABLE, {
      labelled,
      eligible,
      quality,
      primary,
      reasons,
    });
  }
  if (
    quality.accepted_frame_fraction <
    MINIMUM_SUPPORT_POLICY.min_quality_accepted_frame_fraction_on_labelled_ways
  ) {
    reasons.push('point_only_signature_quality_insufficient');
    return verdictRow(routeKey, ROUTE_VERDICT.NOT_QUALIFIED, {
      labelled,
      eligible,
      quality,
      primary,
      reasons,
    });
  }
  if (
    MINIMUM_SUPPORT_POLICY.disqualify_if_high_margin_incorrect &&
    primary.high_margin_incorrect_count > 0
  ) {
    reasons.push(`high_margin_incorrect_predictions_${primary.high_margin_incorrect_count}`);
    return verdictRow(routeKey, ROUTE_VERDICT.NOT_QUALIFIED, {
      labelled,
      eligible,
      quality,
      primary,
      reasons,
    });
  }

  reasons.push('passed_provisional_minimum_support_policy');
  return verdictRow(routeKey, ROUTE_VERDICT.QUALIFIED, {
    labelled,
    eligible,
    quality,
    primary,
    reasons,
  });
}

function verdictRow(routeKey, verdict, ctx) {
  return {
    route_key: routeKey,
    route_verdict: verdict,
    minimum_support_policy: MINIMUM_SUPPORT_POLICY,
    labelled_one_way_ways: ctx.labelled.length,
    eligible_labelled_ways: ctx.eligible.length,
    source_quality: ctx.quality,
    held_out_single_best: ctx.primary,
    held_out_multi_frame: null,
    disqualification_reasons: ctx.reasons,
    evaluable: verdict !== ROUTE_VERDICT.NOT_EVALUABLE,
    reliable_for_experimental_method: verdict === ROUTE_VERDICT.QUALIFIED,
  };
}

export function attachMultiMetrics(qualificationRow, evaluation) {
  return {
    ...qualificationRow,
    held_out_multi_frame: evaluation.multi_frame_consensus.metrics,
  };
}
