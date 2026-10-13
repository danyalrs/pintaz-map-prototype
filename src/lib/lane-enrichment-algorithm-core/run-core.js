import { insufficientSemantics, unsupportedSemantics } from './result-semantics.js';
import { validateGeometryInput } from './validate-geometry-input.js';
import { selectCrossSection } from './select-cross-section.js';
import { buildFrameBoundaryEvidence } from './build-frame-boundary-evidence.js';
import { buildSameRouteConsensus } from './build-same-route-consensus.js';
import { inferLaneCountCandidate } from './infer-lane-count-candidate.js';

export function runLaneEnrichmentCore(bundle) {
  const validation = validateGeometryInput(bundle);
  if (!validation.ok) {
    const base = validation.unsupported ? unsupportedSemantics() : insufficientSemantics();
    return {
      ...base,
      validation_errors: validation.errors,
    };
  }
  const section = selectCrossSection(bundle);
  if (!section.ok) {
    return {
      ...insufficientSemantics(),
      cross_section_exclusions: section.exclusions,
    };
  }
  const frameEvidence = buildFrameBoundaryEvidence(bundle.frames, section.cross_section);
  const consensus = buildSameRouteConsensus(frameEvidence);
  const result = inferLaneCountCandidate({
    consensus,
    frameEvidence,
    centrelineSection: bundle.centreline_section,
  });
  return {
    ...result,
    cross_section_id: section.cross_section.cross_section_id,
    frame_evidence: frameEvidence,
    boundary_clusters: {
      lane_boundaries: consensus.lane_boundaries,
      road_edges: consensus.road_edges,
    },
  };
}
