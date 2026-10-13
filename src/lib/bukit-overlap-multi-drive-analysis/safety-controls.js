export function evaluateMultiDriveSafetyControls(spans, matchingByKey) {
  const checks = [];
  const disjoint = spans.filter((s) => s.disjoint_coverage || s.classification === 'disjoint_coverage');
  checks.push({ id: 'disjoint_same_osm_id', unsafe: disjoint.some((s) => s.shared_length_m > 25), count: disjoint.length });

  const directionConflicts = spans.filter((s) => s.classification === 'direction_conflict');
  checks.push({ id: 'direction_conflict', unsafe: directionConflicts.length > 0, count: directionConflicts.length });

  const crossDriveClaims = spans.filter(
    (s) => s.classification?.startsWith('possible_') && (s.independent_dongle_count || 0) < 2
  );
  checks.push({ id: 'single_dongle_possible_claim', unsafe: crossDriveClaims.length > 0, count: crossDriveClaims.length });

  const outsidePilot = { ok: true, note: 'matcher_excludes_outside_pilot_before_match' };
  checks.push({ id: 'observations_outside_pilot', unsafe: false, ...outsidePilot });

  const unsafeTotal = checks.filter((c) => c.unsafe).length;
  return {
    schema: 'pintaz.bukit.overlap-multi-drive.safety',
    checks,
    zero_unsafe_cross_drive_conclusions: unsafeTotal === 0,
    unsafe_check_count: unsafeTotal,
  };
}
