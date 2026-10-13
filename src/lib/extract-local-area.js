import fs from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { roadsGeojsonSeqPath } from './paths.js';
import { isValidLonLat } from './road-tags.js';
import { OSM_LANE_SEMANTIC_TAG_KEYS } from './osm-lane-semantics.js';
import { lineIntersectsBounds, clipLineStringToBounds } from './bbox-clip.js';
import { haversineMetres } from './geo-square.js';

const PROP_KEYS = [
  'osm_id',
  'highway',
  'name',
  'ref',
  'lanes',
  ...OSM_LANE_SEMANTIC_TAG_KEYS,
  'maxspeed',
  'surface',
  'oneway',
  'bridge',
  'tunnel',
  'access',
  'service',
];

function lineLengthKm(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    m += haversineMetres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return m / 1000;
}

function featureBbox(coords) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of coords) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

function quickReject(coords, bounds) {
  const fb = featureBbox(coords);
  return fb.east < bounds.west || fb.west > bounds.east || fb.north < bounds.south || fb.south > bounds.north;
}

export async function extractLocalAreaRoads(bounds, options = {}) {
  const input = options.inputPath || roadsGeojsonSeqPath();
  if (!fs.existsSync(input)) {
    throw new Error(`Missing GeoJSONSeq: ${input}`);
  }

  const stats = {
    scanned: 0,
    emitted: 0,
    rejectedInvalid: 0,
    rejectReasons: {},
    byHighway: {},
    named: 0,
    unnamed: 0,
    withLanes: 0,
    withMaxspeed: 0,
    withOneway: 0,
    duplicateOsmIds: 0,
    crossesBoundary: 0,
    coordinateCount: 0,
    lengthKm: 0,
    clippedFeatures: 0,
    fullInsideFeatures: 0,
  };
  const seenIds = new Map();
  const features = [];

  const rl = readline.createInterface({ input: fs.createReadStream(input) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.scanned += 1;
    let feature;
    try {
      feature = JSON.parse(line);
    } catch {
      stats.rejectedInvalid += 1;
      stats.rejectReasons.parse_error = (stats.rejectReasons.parse_error || 0) + 1;
      continue;
    }
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) {
      stats.rejectedInvalid += 1;
      stats.rejectReasons.too_few_coords = (stats.rejectReasons.too_few_coords || 0) + 1;
      continue;
    }
    let badCoord = false;
    for (const [lon, lat] of coords) {
      if (!isValidLonLat(lon, lat)) badCoord = true;
    }
    if (badCoord) {
      stats.rejectedInvalid += 1;
      stats.rejectReasons.non_finite = (stats.rejectReasons.non_finite || 0) + 1;
      continue;
    }
    if (quickReject(coords, bounds)) continue;
    if (!lineIntersectsBounds(coords, bounds)) continue;

    const props = feature.properties || {};
    const osmId = String(props.osm_id || '');
    const highway = String(props.highway || '');
    if (!osmId || !highway) {
      stats.rejectedInvalid += 1;
      stats.rejectReasons.missing_id_or_highway = (stats.rejectReasons.missing_id_or_highway || 0) + 1;
      continue;
    }
    if (seenIds.has(osmId)) stats.duplicateOsmIds += 1;
    seenIds.set(osmId, true);

    const clipped = clipLineStringToBounds(coords, bounds);
    if (!clipped || clipped.length < 2) continue;

    const allInside = coords.every(
      ([lon, lat]) =>
        lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north
    );
    if (allInside) stats.fullInsideFeatures += 1;
    else {
      stats.clippedFeatures += 1;
      stats.crossesBoundary += 1;
    }

    const outProps = { osm_id: osmId, highway };
    for (const k of PROP_KEYS) {
      if (k === 'osm_id' || k === 'highway') continue;
      if (props[k] != null && props[k] !== '') outProps[k] = String(props[k]);
    }
    outProps.geometry_scope = allInside ? 'full_inside' : 'clipped_to_square';
    outProps.original_vertex_count = String(coords.length);

    features.push({
      type: 'Feature',
      properties: outProps,
      geometry: { type: 'LineString', coordinates: clipped },
    });

    stats.emitted += 1;
    stats.byHighway[highway] = (stats.byHighway[highway] || 0) + 1;
    stats.coordinateCount += clipped.length;
    stats.lengthKm += lineLengthKm(clipped);
    if (outProps.name) stats.named += 1;
    else stats.unnamed += 1;
    if (outProps.lanes) stats.withLanes += 1;
    if (outProps.maxspeed) stats.withMaxspeed += 1;
    if (outProps.oneway) stats.withOneway += 1;
  }

  features.sort((a, b) => a.properties.osm_id.localeCompare(b.properties.osm_id));

  const geojson = { type: 'FeatureCollection', features };
  const hash = crypto.createHash('sha256').update(JSON.stringify(geojson)).digest('hex');

  return { geojson, stats, contentHash: hash };
}
