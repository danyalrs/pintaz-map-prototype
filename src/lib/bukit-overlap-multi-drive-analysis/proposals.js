import { createHash } from 'node:crypto';

export function buildDiagnosticProposals(spans) {
  const stable = spans.filter(
    (s) =>
      s.classification?.startsWith('possible_') &&
      s.stability?.stable &&
      (s.independent_dongle_count || 0) >= 2
  );
  if (!stable.length) {
    return { count: 0, proposals: [], reason: 'no_stable_possible_multi_drive_span' };
  }
  const proposals = stable.map((s, i) => {
    const id = createHash('sha256')
      .update(`${s.osm_id}:${s.span_start_s}:${s.span_end_s}:${i}`)
      .digest('hex')
      .slice(0, 16);
    return {
      proposal_id: `diag-bukit-md-${id}`,
      original_osm_id: s.osm_id,
      span_start_s: s.span_start_s,
      span_end_s: s.span_end_s,
      redacted_contributing_routes: s.redacted_routes || s.route_keys,
      dongle_group_count: s.independent_dongle_count,
      support_metrics: {
        shared_length_m: s.shared_length_m,
        classification: s.classification,
      },
      osm_value: s.osm_baseline?.osm_confirmed || null,
      server_observed_value: s.evidence?.equal_weight_bins || null,
      confidence_components: { stability: s.stability },
      safety_gates: { diagnostic_only: true, production_update: false },
      decision_state: 'pending',
      diagnostic_only: true,
    };
  });
  return { count: proposals.length, proposals };
}
