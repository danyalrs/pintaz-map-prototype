import { createHash } from 'node:crypto';
import { haversineMetres } from './geo-square.js';
import { median, percentile, headingDifferenceDeg } from './geo-segment.js';

export const CLASSIFICATIONS = [
  'alignment_consistent',
  'possible_centerline_offset',
  'possible_lane_geometry_difference',
  'possible_missing_osm_road',
  'ambiguous_parallel_road',
  'ambiguous_junction_or_flyover',
  'insufficient_evidence',
];

export function confidenceScore(inputs) {
  const {
    frameCount = 0,
    sectionLengthM = 0,
    medianDistanceM = 99,
    medianHeadingDiff = 90,
    continuityBreaks = 0,
    ambiguityFlags = 0,
    laneStability = 0,
  } = inputs;
  let score = 0;
  score += Math.min(0.25, frameCount / 80);
  score += Math.min(0.2, sectionLengthM / 200);
  score += Math.max(0, 0.2 * (1 - medianDistanceM / 20));
  score += Math.max(0, 0.15 * (1 - medianHeadingDiff / 45));
  score -= continuityBreaks * 0.05;
  score -= ambiguityFlags * 0.12;
  score += Math.min(0.1, laneStability);
  return Math.max(0, Math.min(1, score));
}

export function classifySection(metrics) {
  const reasons = [];
  if (metrics.frameCount < 10 || metrics.sectionLengthM < 25) {
    reasons.push('Too few vehicle frames or short section length for reliable review.');
    return { classification: 'insufficient_evidence', reasons };
  }
  if (metrics.ambiguousParallel) {
    reasons.push('Multiple OSM roads scored similarly along this section.');
    return { classification: 'ambiguous_parallel_road', reasons };
  }
  if (metrics.ambiguousJunction) {
    reasons.push('Junction, bridge or flyover context made matching ambiguous.');
    return { classification: 'ambiguous_junction_or_flyover', reasons };
  }
  if (metrics.medianDistanceM > 22 && metrics.medianHeadingDiff < 35) {
    reasons.push('Vehicle path is offset from OSM but heading agrees — possible missing OSM geometry.');
    return { classification: 'possible_missing_osm_road', reasons };
  }
  if (metrics.laneOffsetSpreadM > 2.5 && metrics.laneCount >= 8) {
    reasons.push('Lane observation lateral spread suggests geometry difference, not centreline error alone.');
    return { classification: 'possible_lane_geometry_difference', reasons };
  }
  if (metrics.medianDistanceM >= 9 && metrics.medianDistanceM <= 18) {
    reasons.push(`Median vehicle-to-OSM distance ${metrics.medianDistanceM.toFixed(1)} m.`);
    return { classification: 'possible_centerline_offset', reasons };
  }
  if (metrics.medianDistanceM < 9 && metrics.medianHeadingDiff < 28) {
    reasons.push('Distance and heading agree with OSM centreline along this section.');
    return { classification: 'alignment_consistent', reasons };
  }
  reasons.push('Mixed distance/heading signals — treated as insufficient for edit proposals.');
  return { classification: 'insufficient_evidence', reasons };
}

export function groupMatchedPosesIntoSections(matchedPoses, attachedObs, gpsFeatures) {
  const sections = [];
  if (!matchedPoses.length) return sections;

  let run = [];
  const flush = () => {
    if (!run.length) return;
    sections.push(buildSection(run, attachedObs, gpsFeatures, sections.length));
    run = [];
  };

  for (const f of matchedPoses) {
    const osm = String(f.properties.osm_id);
    if (!run.length) {
      run.push(f);
      continue;
    }
    const prev = run[run.length - 1];
    const prevOsm = String(prev.properties.osm_id);
    const gap = haversineMetres(
      prev.geometry.coordinates[0],
      prev.geometry.coordinates[1],
      f.geometry.coordinates[0],
      f.geometry.coordinates[1]
    );
    if (osm !== prevOsm || gap > 35) {
      flush();
    }
    run.push(f);
  }
  flush();
  return sections;
}

function buildSection(poseRun, attachedObs, gpsFeatures, sectionIndex) {
  const osmId = String(poseRun[0].properties.osm_id);
  const distances = poseRun.map((p) => p.properties.distance_m);
  const headings = poseRun.map((p) => p.properties.heading_diff_deg);
  let lengthM = 0;
  for (let i = 1; i < poseRun.length; i += 1) {
    lengthM += haversineMetres(
      poseRun[i - 1].geometry.coordinates[0],
      poseRun[i - 1].geometry.coordinates[1],
      poseRun[i].geometry.coordinates[0],
      poseRun[i].geometry.coordinates[1]
    );
  }
  const frameIds = new Set(poseRun.map((p) => p.properties.frame_id));
  const obs = attachedObs.filter((o) => String(o.properties.osm_id) === osmId);
  const lane = obs.filter((o) => o.properties.layer === 'lane_point');
  const edge = obs.filter((o) => o.properties.layer === 'edge_point');
  const laneOffsets = lane.map((o) => o.properties.lateral_offset_m).filter(Number.isFinite);
  const edgeOffsets = edge.map((o) => o.properties.lateral_offset_m).filter(Number.isFinite);
  const laneSpread =
    laneOffsets.length > 1 ? Math.max(...laneOffsets) - Math.min(...laneOffsets) : 0;

  const coords = poseRun.map((p) => p.geometry.coordinates);
  const line = { type: 'LineString', coordinates: coords };

  const metrics = {
    frameCount: poseRun.length,
    sectionLengthM: lengthM,
    medianDistanceM: median(distances) ?? 99,
    p90DistanceM: percentile(distances, 90) ?? 99,
    medianHeadingDiff: median(headings) ?? 90,
    laneCount: lane.length,
    edgeCount: edge.length,
    gpsCount: gpsFeatures.length,
    laneOffsetSpreadM: laneSpread,
    ambiguousParallel: false,
    ambiguousJunction: poseRun.some((p) => p.properties.bridge || p.properties.tunnel),
    continuityBreaks: 0,
  };

  const { classification, reasons } = classifySection(metrics);
  const confidence = confidenceScore({
    frameCount: metrics.frameCount,
    sectionLengthM: metrics.sectionLengthM,
    medianDistanceM: metrics.medianDistanceM,
    medianHeadingDiff: metrics.medianHeadingDiff,
    laneStability: laneSpread < 1.5 ? 0.08 : 0,
  });

  const proposalId = createHash('sha256')
    .update(`${osmId}:${sectionIndex}:${coords[0].join(',')}`)
    .digest('hex')
    .slice(0, 16);

  const geometryHash = createHash('sha256').update(JSON.stringify(line)).digest('hex');

  return {
    type: 'Feature',
    geometry: line,
    properties: {
      proposal_id: proposalId,
      section_index: sectionIndex,
      osm_id: osmId,
      highway: poseRun[0].properties.highway,
      name: poseRun[0].properties.name,
      classification,
      confidence: Math.round(confidence * 1000) / 1000,
      section_length_m: Math.round(lengthM * 10) / 10,
      vehicle_frames: poseRun.length,
      lane_observations: lane.length,
      edge_observations: edge.length,
      gps_observations: 0,
      median_distance_m: metrics.medianDistanceM,
      p90_distance_m: metrics.p90DistanceM,
      median_heading_diff_deg: metrics.medianHeadingDiff,
      lane_left_count: lane.filter((o) => o.properties.side === 'left').length,
      lane_right_count: lane.filter((o) => o.properties.side === 'right').length,
      edge_left_count: edge.filter((o) => o.properties.side === 'left').length,
      edge_right_count: edge.filter((o) => o.properties.side === 'right').length,
      reasons,
      partial_page_scope: 'maps-read-page-1-truncated',
      geometry_hash: geometryHash,
      review_only: true,
      proposal_eligible: proposalPassesDisplayGate({
        type: 'Feature',
        properties: {
          classification,
          confidence: Math.round(confidence * 1000) / 1000,
          vehicle_frames: poseRun.length,
          section_length_m: lengthM,
        },
      }),
    },
  };
}

export function proposalPassesDisplayGate(section) {
  const p = section.properties;
  const okClass = [
    'alignment_consistent',
    'possible_centerline_offset',
    'possible_lane_geometry_difference',
  ].includes(p.classification);
  return (
    okClass &&
    p.confidence >= 0.5 &&
    p.vehicle_frames >= 15 &&
    p.section_length_m >= 35
  );
}
