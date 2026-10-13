import fs from 'node:fs';
import readline from 'node:readline';
import through from 'through2';
import osm from 'osm-pbf-parser';
import { pbfPath, roadsGeojsonSeqPath, extractionMetaPath } from '../src/lib/paths.js';
import { ensureDataDirs, DATA_DIRS } from '../src/lib/paths.js';
import path from 'node:path';
import { isValidLonLat, pickTags } from '../src/lib/road-tags.js';

const TAG = '[extract-roads]';

function streamPbf(onBatch) {
  return new Promise((resolve, reject) => {
    const parser = osm();
    const stream = fs
      .createReadStream(pbfPath())
      .pipe(parser)
      .pipe(
        through.obj(function (items, _enc, cb) {
          try {
            onBatch(items);
            cb();
          } catch (e) {
            cb(e);
          }
        })
      );
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function passCollectHighwayWays(waysPath, neededNodeIds) {
  const out = fs.createWriteStream(waysPath);
  let wayCount = 0;
  await streamPbf((items) => {
    for (const item of items) {
      if (item.type !== 'way' || !item.tags?.highway) continue;
      const refs = item.refs || [];
      for (const ref of refs) neededNodeIds.add(ref);
      out.write(`${JSON.stringify({ id: item.id, tags: item.tags, refs })}\n`);
      wayCount += 1;
    }
  });
  await new Promise((r) => out.end(r));
  return wayCount;
}

async function passCollectNodes(neededNodeIds, nodesPath) {
  const out = fs.createWriteStream(nodesPath);
  let stored = 0;
  await streamPbf((items) => {
    for (const item of items) {
      if (item.type !== 'node') continue;
      if (!neededNodeIds.has(item.id)) continue;
      if (!isValidLonLat(item.lon, item.lat)) continue;
      out.write(`${JSON.stringify({ id: item.id, lon: item.lon, lat: item.lat })}\n`);
      stored += 1;
    }
  });
  await new Promise((r) => out.end(r));
  return stored;
}

async function loadNodesMap(nodesPath) {
  const nodes = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(nodesPath) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    nodes.set(row.id, [row.lon, row.lat]);
  }
  return nodes;
}

async function passWriteGeojsonSeq(waysPath, nodes, outPath, stats) {
  const out = fs.createWriteStream(outPath);
  const rl = readline.createInterface({ input: fs.createReadStream(waysPath) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const way = JSON.parse(line);
    const highway = way.tags?.highway;
    const coords = [];
    for (const ref of way.refs || []) {
      const pt = nodes.get(ref);
      if (!pt) {
        stats.reject('missing_node_ref');
        coords.length = 0;
        break;
      }
      if (!isValidLonLat(pt[0], pt[1])) {
        stats.reject('invalid_node_coord');
        coords.length = 0;
        break;
      }
      coords.push(pt);
    }
    if (coords.length < 2) {
      if (coords.length > 0) stats.reject('too_few_vertices');
      continue;
    }
    for (const [lon, lat] of coords) stats.bumpBounds(lon, lat);
    const properties = {
      osm_id: String(way.id),
      ...pickTags(way.tags),
      highway: String(highway),
    };
    out.write(
      `${JSON.stringify({
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates: coords },
      })}\n`
    );
    stats.accept(highway);
  }
  await new Promise((r) => out.end(r));
}

async function main() {
  ensureDataDirs();
  const input = pbfPath();
  if (!fs.existsSync(input)) {
    console.error(`${TAG} Missing PBF. Run npm run download:osm`);
    process.exit(1);
  }

  const started = Date.now();
  const waysPath = path.join(DATA_DIRS.processed, 'highway-ways.tmp.jsonl');
  const nodesPath = path.join(DATA_DIRS.processed, 'highway-nodes.tmp.jsonl');

  console.log(`${TAG} pass 1/3 — collect highway ways and node refs`);
  const neededNodeIds = new Set();
  const rawWayCount = await passCollectHighwayWays(waysPath, neededNodeIds);
  console.log(`${TAG} highway ways=${rawWayCount} needed nodes=${neededNodeIds.size}`);

  console.log(`${TAG} pass 2/3 — collect coordinates for referenced nodes`);
  const nodeRows = await passCollectNodes(neededNodeIds, nodesPath);
  console.log(`${TAG} stored node coordinates=${nodeRows}`);

  console.log(`${TAG} pass 3/3 — resolve geometries → GeoJSONSeq`);
  const nodes = await loadNodesMap(nodesPath);
  const stats = {
    totalWays: 0,
    rejected: 0,
    rejectReasons: {},
    byHighway: {},
    bounds: { west: Infinity, south: Infinity, east: -Infinity, north: Infinity },
    reject(reason) {
      this.rejected += 1;
      this.rejectReasons[reason] = (this.rejectReasons[reason] || 0) + 1;
    },
    accept(highway) {
      this.totalWays += 1;
      this.byHighway[highway] = (this.byHighway[highway] || 0) + 1;
    },
    bumpBounds(lon, lat) {
      this.bounds.west = Math.min(this.bounds.west, lon);
      this.bounds.south = Math.min(this.bounds.south, lat);
      this.bounds.east = Math.max(this.bounds.east, lon);
      this.bounds.north = Math.max(this.bounds.north, lat);
    },
  };

  await passWriteGeojsonSeq(waysPath, nodes, roadsGeojsonSeqPath(), stats);

  try {
    fs.unlinkSync(waysPath);
    fs.unlinkSync(nodesPath);
  } catch {
    /* ignore */
  }

  const durationMs = Date.now() - started;
  const mem = process.memoryUsage();
  const meta = {
    pipeline: 'node-osm-pbf-parser-3pass',
    inputFile: input,
    outputFile: roadsGeojsonSeqPath(),
    rawHighwayWays: rawWayCount,
    totalWays: stats.totalWays,
    rejected: stats.rejected,
    rejectReasons: stats.rejectReasons,
    byHighway: stats.byHighway,
    bounds: Number.isFinite(stats.bounds.west) ? stats.bounds : null,
    durationMs,
    peakMemory: { heapUsed: mem.heapUsed, rss: mem.rss },
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(extractionMetaPath(), JSON.stringify(meta, null, 2));
  console.log(`${TAG} ways=${stats.totalWays} rejected=${stats.rejected} duration=${(durationMs / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
