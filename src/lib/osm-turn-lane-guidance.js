import { haversineMetres } from './geo-square.js';
import { bearingDeg, dedupeCoordinates, lineLengthM } from './lane-geometry.js';
import { interpretOsmRoadProperties } from './lane-interpret.js';
import {
  hasUsableOsmLaneCount,
  propTag,
  propsForLaneCountInterpretation,
} from './osm-lane-semantics.js';
import { parseOneway } from './lane-tag-parse.js';

/** Supported OSM turn:lanes movement tokens (lowercase). */
export const SUPPORTED_TURN_MOVEMENTS = new Set([
  'left',
  'slight_left',
  'through',
  'slight_right',
  'right',
  'merge_to_left',
  'merge_to_right',
  'reverse',
  'u_turn',
]);

/** Degrees added to road bearing (glyph default points along road at 0°). */
export const MOVEMENT_BEARING_OFFSET = {
  through: 0,
  left: -90,
  slight_left: -45,
  right: 90,
  slight_right: 45,
  merge_to_left: -60,
  merge_to_right: 60,
  reverse: 180,
  u_turn: 180,
};

/** Distinct schematic glyphs per OSM movement (not a single rotated triangle). */
export const MOVEMENT_DISPLAY_GLYPH = {
  left: '⬅',
  slight_left: '↖',
  through: '↑',
  slight_right: '↗',
  right: '➡',
  merge_to_left: '↰',
  merge_to_right: '↱',
  reverse: '↩',
  u_turn: '↩',
};

export function turnGuidanceGlyphForMovement(movement) {
  const key = String(movement ?? '').trim().toLowerCase();
  return MOVEMENT_DISPLAY_GLYPH[key] ?? '↑';
}

const LANE_LATERAL_SPACING_M = 2.8;
const MIN_PLACEMENT_SPACING_M = 90;
const MAX_PLACEMENTS_PER_WAY = 3;

function normalizeMovementToken(token) {
  const t = String(token ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'uturn') return 'u_turn';
  return t;
}

/**
 * Parse one pipe-separated turn:lanes string into per-lane movement lists.
 * Returns { ok: true, lanes } or { ok: false, reason }.
 */
export function parseTurnLanesTag(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, reason: 'empty_turn_tag' };
  }
  const parts = String(raw).split('|');
  if (!parts.length) return { ok: false, reason: 'empty_turn_tag' };

  const lanes = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) return { ok: false, reason: 'empty_lane_slot' };
    const movements = trimmed
      .split(';')
      .map((m) => normalizeMovementToken(m))
      .filter(Boolean);
    if (!movements.length) return { ok: false, reason: 'empty_lane_slot' };
    const unsupported = movements.filter((m) => !SUPPORTED_TURN_MOVEMENTS.has(m));
    if (unsupported.length) {
      return { ok: false, reason: 'unsupported_movement', tokens: unsupported };
    }
    lanes.push(movements);
  }
  return { ok: true, lanes };
}

/**
 * Select turn-lane tag sources safe to render for this road.
 * @returns {{ tagKey: string, raw: string, orientation: 'forward'|'backward' }[]}
 */
export function selectEligibleTurnLaneTags(props) {
  const oneway = parseOneway(propTag(props, 'oneway'));
  const turnLanes = propTag(props, 'turn:lanes');
  const turnForward = propTag(props, 'turn:lanes:forward');
  const turnBackward = propTag(props, 'turn:lanes:backward');

  const selected = [];
  const exclusions = [];

  if (turnForward) {
    selected.push({ tagKey: 'turn:lanes:forward', raw: turnForward, orientation: 'forward' });
  }
  if (turnBackward) {
    selected.push({ tagKey: 'turn:lanes:backward', raw: turnBackward, orientation: 'backward' });
  }
  if (oneway.isOneway && turnLanes) {
    selected.push({ tagKey: 'turn:lanes', raw: turnLanes, orientation: 'forward' });
  } else if (turnLanes && !oneway.isOneway) {
    exclusions.push('two_way_ambiguous_turn_lanes');
  }

  if (!selected.length && !exclusions.length && (turnLanes || turnForward || turnBackward)) {
    exclusions.push('no_eligible_turn_tag');
  }

  return { selected, exclusions };
}

function orientedCoords(coords, orientation) {
  if (orientation === 'backward') return [...coords].reverse();
  return coords;
}

function pointAlongLine(coords, targetDistM) {
  if (!coords?.length) return null;
  if (targetDistM <= 0) {
    const [lon, lat] = coords[0];
    const br =
      coords.length > 1 ? bearingDeg(coords[0][0], coords[0][1], coords[1][0], coords[1][1]) : 0;
    return { lon, lat, bearing: br };
  }
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMetres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    if (acc + seg >= targetDistM) {
      const remain = targetDistM - acc;
      const ratio = seg > 0 ? remain / seg : 0;
      const lon = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * ratio;
      const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * ratio;
      const bearing = bearingDeg(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
      return { lon, lat, bearing };
    }
    acc += seg;
  }
  const last = coords[coords.length - 1];
  const prev = coords[coords.length - 2] ?? last;
  return {
    lon: last[0],
    lat: last[1],
    bearing: bearingDeg(prev[0], prev[1], last[0], last[1]),
  };
}

function placementDistancesM(totalLen) {
  if (totalLen < MIN_PLACEMENT_SPACING_M * 1.5) return [totalLen / 2];
  const count = Math.min(MAX_PLACEMENTS_PER_WAY, Math.max(2, Math.floor(totalLen / MIN_PLACEMENT_SPACING_M)));
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push((totalLen * i) / (count + 1));
  }
  return out;
}

function offsetLonLat(lon, lat, bearing, distanceM, sideSign) {
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const rad = ((bearing + sideSign * 90) * Math.PI) / 180;
  return [lon + (Math.sin(rad) * distanceM) / mPerDegLon, lat + (Math.cos(rad) * distanceM) / mPerDegLat];
}

function movementFeaturesAtPoint(ctx) {
  const { lon, lat, roadBearing, lanes, props, tagKey, orientation, placementIndex } = ctx;
  const features = [];
  const laneCount = lanes.length;
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
    const movements = lanes[laneIndex];
    const primary = movements[0];
    const offsetM = (laneIndex - (laneCount - 1) / 2) * LANE_LATERAL_SPACING_M;
    const sideSign = offsetM >= 0 ? 1 : -1;
    const [glon, glat] =
      offsetM === 0
        ? [lon, lat]
        : offsetLonLat(lon, lat, roadBearing, Math.abs(offsetM), sideSign);
    const bearing = (roadBearing + (MOVEMENT_BEARING_OFFSET[primary] ?? 0) + 360) % 360;
    features.push({
      type: 'Feature',
      properties: {
        osm_id: String(props.osm_id),
        movement: primary,
        glyph: turnGuidanceGlyphForMovement(primary),
        lane_index: laneIndex,
        lane_count: laneCount,
        bearing,
        tag_key: tagKey,
        orientation,
        placement_index: placementIndex,
        schematic: true,
      },
      geometry: { type: 'Point', coordinates: [glon, glat] },
    });
  }
  return features;
}

/**
 * Build point features for one road way (LineString) or empty array.
 */
export function buildTurnGuidanceFeaturesForWay(feature, highwayCategoryWidthM = 6) {
  if (feature?.geometry?.type !== 'LineString') return { features: [], exclusions: ['non_line_geometry'] };

  const props = feature.properties || {};
  const interp = interpretOsmRoadProperties(propsForLaneCountInterpretation(props), highwayCategoryWidthM);
  if (!hasUsableOsmLaneCount(interp)) {
    return { features: [], exclusions: ['no_usable_lane_count'] };
  }

  const { selected, exclusions: tagExclusions } = selectEligibleTurnLaneTags(props);
  if (!selected.length) {
    return { features: [], exclusions: tagExclusions.length ? tagExclusions : ['no_explicit_turn_tag'] };
  }

  const coords = dedupeCoordinates(feature.geometry.coordinates);
  const allFeatures = [];
  const exclusions = [...tagExclusions];

  for (const spec of selected) {
    const parsed = parseTurnLanesTag(spec.raw);
    if (!parsed.ok) {
      exclusions.push(`${spec.tagKey}:${parsed.reason}`);
      continue;
    }
    const oriented = orientedCoords(coords, spec.orientation);
    const len = lineLengthM(oriented);
    if (len < 1) {
      exclusions.push(`${spec.tagKey}:geometry_too_short`);
      continue;
    }
    for (const dist of placementDistancesM(len)) {
      const pt = pointAlongLine(oriented, dist);
      if (!pt) continue;
      const placementIndex = allFeatures.length;
      allFeatures.push(
        ...movementFeaturesAtPoint({
          lon: pt.lon,
          lat: pt.lat,
          roadBearing: pt.bearing,
          lanes: parsed.lanes,
          props,
          tagKey: spec.tagKey,
          orientation: spec.orientation,
          placementIndex,
        })
      );
    }
  }

  return { features: allFeatures, exclusions };
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function roadHasEligibleParsedTag(props) {
  const interp = interpretOsmRoadProperties(propsForLaneCountInterpretation(props), 6);
  if (!hasUsableOsmLaneCount(interp)) return false;
  const { selected } = selectEligibleTurnLaneTags(props);
  return selected.some((spec) => parseTurnLanesTag(spec.raw).ok);
}

/**
 * @param {{ type: string, features: object[] }} roadsGeojson
 */
export function buildTurnLaneGuidanceCollection(roadsGeojson) {
  const features = [];
  const exclusionCounts = {};
  let roadsEligible = 0;
  let roadsWithFeatures = 0;

  for (const f of roadsGeojson?.features || []) {
    const props = f.properties || {};
    const { features: wayFeatures, exclusions } = buildTurnGuidanceFeaturesForWay(f);
    for (const ex of exclusions) bump(exclusionCounts, ex);

    if (roadHasEligibleParsedTag(props)) roadsEligible += 1;
    if (wayFeatures.length) {
      roadsWithFeatures += 1;
      features.push(...wayFeatures);
    }
  }

  return {
    type: 'FeatureCollection',
    features,
    metrics: {
      guidance_point_features: features.length,
      eligible_roads: roadsEligible,
      roads_rendering_guidance: roadsWithFeatures,
      exclusion_counts: exclusionCounts,
    },
  };
}

export function loadTurnLaneGuidanceForArea(areaId, roadsGeojson) {
  if (!roadsGeojson) return { type: 'FeatureCollection', features: [], metrics: { area_id: areaId } };
  const collection = buildTurnLaneGuidanceCollection(roadsGeojson);
  collection.metrics.area_id = areaId;
  return collection;
}
