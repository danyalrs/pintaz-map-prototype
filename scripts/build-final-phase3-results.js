#!/usr/bin/env node
/**
 * Read-only final Phase 3 synthesis from completed checkpoint.
 */
import {
  buildFinalPhase3Results,
  writeFinalPhase3Results,
  REPORT_DIR,
} from '../src/lib/full-maps-read-route-enrichment-discovery/build-final-phase3-results.js';

function main() {
  const artifacts = buildFinalPhase3Results();
  if (!artifacts.validation.matches_user_facts) {
    console.warn('Checkpoint validation warning:', artifacts.validation);
  }
  writeFinalPhase3Results(artifacts);
  console.log('Wrote final Phase 3 results to', REPORT_DIR);
  console.log(
    JSON.stringify(
      {
        qualified_routes: artifacts.summary.scope.routes_qualified_for_future_geometry,
        future_geometry_pairs: artifacts.summary.pair_shortlist.future_geometry_candidate_pairs,
        unknown_ways_with_qualified_route: artifacts.summary.pair_shortlist.unknown_lane_ways_with_at_least_one_qualified_route,
        validation: artifacts.validation,
      },
      null,
      2
    )
  );
}

main();
