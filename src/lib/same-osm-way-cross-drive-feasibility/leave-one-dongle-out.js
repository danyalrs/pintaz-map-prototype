import { classifyAccumulatedSpan } from './classify-spans.js';
import { uniqueFrames, chainLengthFromRecords } from './drive-evidence-loader.js';

export function leaveOneDongleOutAnalysis(spans) {
  const results = [];
  let stable = 0;
  let unstable = 0;
  let singleDominated = 0;

  for (const span of spans) {
    const base = classifyAccumulatedSpan(span);
    const removals = [];
    for (const removeGroup of span.dongle_groups) {
      const remaining = span.records.filter((r) => r.dongle_group !== removeGroup);
      const shrunk = {
        ...span,
        records: remaining,
        dongle_groups: span.dongle_groups.filter((g) => g !== removeGroup),
        combined_frames: uniqueFrames(remaining),
        supported_length_m: chainLengthFromRecords(remaining),
        overlap_length_m: span.overlap_length_m * 0.5,
        passes_support_gates:
          uniqueFrames(remaining) >= 8 && chainLengthFromRecords(remaining) >= 25,
        dominant_drive_failure: false,
      };
      const after = classifyAccumulatedSpan(shrunk, { neighbourhoodStable: true });
      removals.push({
        removed_dongle_group: removeGroup,
        classification_after: after.classification,
        combined_frames_after: shrunk.combined_frames,
        supported_length_m_after: shrunk.supported_length_m,
        classification_changed: after.classification !== base.classification,
      });
    }
    const compatibleRemain = removals.filter(
      (r) =>
        r.classification_after === base.classification ||
        r.classification_after === 'consistent_across_drives' ||
        r.classification_after === base.classification
    );
    const isStable =
      base.classification !== 'insufficient_independent_evidence' &&
      compatibleRemain.length >= 2 &&
      removals.filter((r) => r.classification_changed).length <= 1;
    if (isStable) stable += 1;
    else unstable += 1;
    if (span.dominant_drive_failure) singleDominated += 1;

    results.push({
      osm_id: span.osm_id,
      min_s: span.min_s,
      max_s: span.max_s,
      base_classification: base.classification,
      stable: isStable,
      removals,
    });
  }

  return {
    spans: results,
    summary: {
      stable_spans: stable,
      unstable_spans: unstable,
      single_dongle_dominated: singleDominated,
    },
  };
}
