import zlib from 'node:zlib';
import { isGzipTile } from './tile-encoding.js';

export const TILE_COVERAGE_CLASS = {
  MISSING: 'missing',
  DECODE_FAIL: 'decode_fail',
  NO_ROADS: 'no_roads',
  ROADS: 'roads',
  SPARSE: 'sparse',
};

let vectorTileModule = null;
let pbfModule = null;

async function loadDecodeDeps() {
  if (!vectorTileModule) {
    vectorTileModule = await import('@mapbox/vector-tile');
    pbfModule = (await import('pbf')).default;
  }
  return { VectorTile: vectorTileModule.VectorTile, Pbf: pbfModule };
}

/**
 * @param {Buffer} buffer raw tile bytes (gzip or raw MVT)
 * @param {{ sparseThreshold?: number }} options
 */
export async function analyzeRoadMvtTile(buffer, options = {}) {
  const sparseThreshold = options.sparseThreshold ?? 3;
  if (!buffer || !buffer.length) {
    return {
      class: TILE_COVERAGE_CLASS.MISSING,
      roadCount: 0,
      highwayCounts: {},
      sourceLayers: [],
      error: 'empty_buffer',
    };
  }
  let raw = buffer;
  try {
    if (isGzipTile(buffer)) raw = zlib.gunzipSync(buffer);
  } catch (e) {
    return {
      class: TILE_COVERAGE_CLASS.DECODE_FAIL,
      roadCount: 0,
      highwayCounts: {},
      sourceLayers: [],
      error: `gzip:${e.message}`,
    };
  }
  let VectorTile;
  let Pbf;
  try {
    ({ VectorTile, Pbf } = await loadDecodeDeps());
  } catch (e) {
    return {
      class: TILE_COVERAGE_CLASS.DECODE_FAIL,
      roadCount: 0,
      highwayCounts: {},
      sourceLayers: [],
      error: `deps:${e.message}`,
    };
  }
  try {
    const vt = new VectorTile(new Pbf(raw));
    const layerNames = Object.keys(vt.layers);
    const roadsLayer = vt.layers.roads;
    if (!roadsLayer) {
      return {
        class: TILE_COVERAGE_CLASS.NO_ROADS,
        roadCount: 0,
        highwayCounts: {},
        sourceLayers: layerNames,
        error: null,
      };
    }
    const roadCount = roadsLayer.length;
    const highwayCounts = {};
    const sampleLimit = Math.min(roadCount, 500);
    for (let i = 0; i < sampleLimit; i++) {
      const hw = roadsLayer.feature(i).properties?.highway;
      if (hw) highwayCounts[hw] = (highwayCounts[hw] || 0) + 1;
    }
    if (roadCount === 0) {
      return {
        class: TILE_COVERAGE_CLASS.NO_ROADS,
        roadCount: 0,
        highwayCounts: {},
        sourceLayers: layerNames,
        error: null,
      };
    }
    const className =
      roadCount < sparseThreshold ? TILE_COVERAGE_CLASS.SPARSE : TILE_COVERAGE_CLASS.ROADS;
    return {
      class: className,
      roadCount,
      highwayCounts,
      sourceLayers: layerNames,
      error: null,
    };
  } catch (e) {
    return {
      class: TILE_COVERAGE_CLASS.DECODE_FAIL,
      roadCount: 0,
      highwayCounts: {},
      sourceLayers: [],
      error: `mvt:${e.message}`,
    };
  }
}
