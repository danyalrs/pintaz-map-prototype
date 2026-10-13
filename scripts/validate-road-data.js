import fs from 'node:fs';
import readline from 'node:readline';
import { pbfPath, roadsGeojsonSeqPath, extractionMetaPath, datasetMetaPath } from '../src/lib/paths.js';
import { parseMd5Sidecar, validatePbfChecksum } from '../src/lib/checksum.js';
import { md5Path } from '../src/lib/paths.js';
import { countTileFiles, tilesRootDir } from '../src/lib/tile-files.js';
import { isValidLonLat } from '../src/lib/road-tags.js';

async function validateChecksum() {
  if (!fs.existsSync(pbfPath()) || !fs.existsSync(md5Path())) return { ok: false, reason: 'missing_pbf_or_md5' };
  const expected = parseMd5Sidecar(fs.readFileSync(md5Path(), 'utf8'));
  const check = await validatePbfChecksum(pbfPath(), expected);
  return { ok: check.valid, md5: check.actual, sizeBytes: fs.statSync(pbfPath()).size };
}

async function sampleGeojsonSeq(limit = 5000) {
  if (!fs.existsSync(roadsGeojsonSeqPath())) return { ok: false, reason: 'missing_geojsonseq' };
  const rl = readline.createInterface({ input: fs.createReadStream(roadsGeojsonSeqPath()) });
  let n = 0;
  let bad = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    n += 1;
    const f = JSON.parse(line);
    if (!f.properties?.osm_id || !f.properties?.highway) bad += 1;
    for (const [lon, lat] of f.geometry.coordinates) {
      if (!isValidLonLat(lon, lat)) bad += 1;
    }
    if (n >= limit) break;
  }
  return { ok: bad === 0, sampled: n, bad };
}

function validateTiles() {
  const root = tilesRootDir();
  if (!fs.existsSync(root)) return { ok: false, reason: 'missing_tile_dir' };
  const count = countTileFiles();
  return { ok: count > 0, tileCount: count };
}

async function main() {
  const results = {
    checksum: await validateChecksum(),
    extractionMeta: fs.existsSync(extractionMetaPath()),
    geojsonSample: await sampleGeojsonSeq(),
    tiles: validateTiles(),
    datasetMeta: fs.existsSync(datasetMetaPath()),
  };
  console.log(JSON.stringify(results, null, 2));
  const failed = !results.checksum.ok || !results.extractionMeta || !results.geojsonSample.ok || !results.tiles.ok;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
