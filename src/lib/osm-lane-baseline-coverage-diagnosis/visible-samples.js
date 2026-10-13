import fs from 'node:fs';
import { parsePositiveInt, parseOneway } from '../lane-tag-parse.js';
import { interpretOsmRoadProperties } from '../lane-interpret.js';
import { dedupeCoordinates, lineLengthM } from '../lane-geometry.js';
import { CATEGORY_WIDTH } from './constants.js';
import { simulateFeaturePipeline } from './pipeline-simulate.js';
import { expectedDividerCount } from './lane-resolution-audit.js';
import { surfacesPath, dividersPath } from '../lane-baseline-paths.js';

function prop(props, key) {
  if (props[key] != null) return props[key];
  return props[key.replace(/:/g, '_')];
}

function redactOsmId(id) {
  const s = String(id ?? '');
  if (s.length <= 4) return `osm_${s}`;
  return `osm_…${s.slice(-4)}`;
}

function dividerCountForOsm(surfacesGeo, dividersGeo, osmId) {
  const sid = String(osmId);
  const surface = (surfacesGeo.features || []).find((f) => String(f.properties?.osm_id) === sid);
  const divs = (dividersGeo.features || []).filter((f) => String(f.properties?.osm_id) === sid);
  return {
    has_surface: Boolean(surface),
    surface_role: surface?.properties?.surface_role ?? null,
    divider_features: divs.length,
  };
}

function pickFirst(features, predicate) {
  return features.find(predicate) ?? null;
}

export function selectVisibleMapSamples(features) {
  const surfacesGeo = JSON.parse(fs.readFileSync(surfacesPath(), 'utf8'));
  const dividersGeo = JSON.parse(fs.readFileSync(dividersPath(), 'utf8'));

  const lineFeatures = features.filter((f) => f.geometry?.type === 'LineString');
  const withLanes = (n) =>
    pickFirst(lineFeatures, (f) => parsePositiveInt(prop(f.properties, 'lanes')).value === n);
  const withLanesGte = (n) =>
    pickFirst(lineFeatures, (f) => {
      const v = parsePositiveInt(prop(f.properties, 'lanes')).value;
      return v != null && v >= n;
    });

  const candidates = [
    { key: 'lanes_1', pick: () => withLanes(1) },
    { key: 'lanes_2', pick: () => withLanes(2) },
    { key: 'lanes_3', pick: () => withLanes(3) },
    { key: 'lanes_4_plus', pick: () => withLanesGte(4) },
    {
      key: 'oneway',
      pick: () => pickFirst(lineFeatures, (f) => parseOneway(f.properties?.oneway).isOneway),
    },
    {
      key: 'two_way',
      pick: () =>
        pickFirst(
          lineFeatures,
          (f) => !parseOneway(f.properties?.oneway).isOneway && parsePositiveInt(prop(f.properties, 'lanes')).value >= 2
        ),
    },
    {
      key: 'directional_lane_tags',
      pick: () =>
        pickFirst(lineFeatures, (f) => {
          const fwd = parsePositiveInt(prop(f.properties, 'lanes:forward'));
          return fwd.kind === 'valid_numeric';
        }),
    },
    {
      key: 'no_lane_tags',
      pick: () =>
        pickFirst(lineFeatures, (f) => parsePositiveInt(prop(f.properties, 'lanes')).kind === 'missing' && f.properties?.highway === 'residential'),
    },
    {
      key: 'curved',
      pick: () => {
        let best = null;
        let bestPts = 0;
        for (const f of lineFeatures) {
          const c = f.geometry.coordinates?.length ?? 0;
          if (c > bestPts && parsePositiveInt(prop(f.properties, 'lanes')).value >= 2) {
            bestPts = c;
            best = f;
          }
        }
        return best;
      },
    },
    {
      key: 'junction_adjacent',
      pick: () => pickFirst(lineFeatures, (f) => f.properties?.junction != null),
    },
  ];

  const samples = [];
  for (const { key, pick } of candidates) {
    const f = pick();
    if (!f) {
      samples.push({ category: key, status: 'no_candidate_in_pilot_osm' });
      continue;
    }
    const p = f.properties || {};
    const hw = p.highway;
    const interp = interpretOsmRoadProperties(p, CATEGORY_WIDTH[hw] ?? 6);
    const sim = simulateFeaturePipeline(f);
    const actual = dividerCountForOsm(surfacesGeo, dividersGeo, p.osm_id);
    const expectedDiv = expectedDividerCount(interp.lane_count_total, interp.direction_confidence);
    const coords = dedupeCoordinates(f.geometry.coordinates);
    const curved = coords.length >= 8;

    let classification = 'correct';
    if (!actual.has_surface && sim.terminal !== 'accepted') classification = 'geometry_failure';
    else if (!actual.has_surface) classification = 'missing';
    else if (actual.surface_role === 'unknown_lane_outline') classification = 'unknown_lane_data';
    else if (interp.lane_count_total && actual.divider_features !== expectedDiv && expectedDiv > 0) {
      classification = actual.divider_features === 0 ? 'missing' : 'incorrect_count';
    } else if (interp.direction_confidence === 'total_only' && key === 'two_way') {
      classification = 'correct';
    }

    samples.push({
      category: key,
      osm_ref: redactOsmId(p.osm_id),
      highway: hw,
      tags: {
        lanes: prop(p, 'lanes'),
        oneway: p.oneway ?? null,
        junction: p.junction ?? null,
        name: p.name ? String(p.name).slice(0, 40) : null,
      },
      resolved_lane_count: interp.lane_count_total,
      direction_confidence: interp.direction_confidence,
      expected_divider_count: expectedDiv,
      actual_divider_features: actual.divider_features,
      surface_role: actual.surface_role,
      pipeline_terminal: sim.terminal,
      curved_geometry: curved,
      visible_at_zoom_14_surfaces: actual.has_surface,
      visible_dividers_require_zoom_15: expectedDiv > 0,
      classification,
      screenshot_ref: `screenshots/sample_${key}.png`,
    });
  }

  return samples;
}
