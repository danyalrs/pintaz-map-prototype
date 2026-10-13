import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TILES, ROOT_DIR, REGION_BOUNDS } from '../src/config.js';
import {
  ensureDataDirs,
  pbfPath,
  datasetMetaPath,
  extractionMetaPath,
} from '../src/lib/paths.js';
import { tilesRootDir, countTileFiles, tilesDiskSizeBytes } from '../src/lib/tile-files.js';
import { resolveTilemaker, printTilemakerInstallHelp } from './resolve-tilemaker.js';

const TILEMAKER_VERSION = 'v2.4.0';
const TILEMAKER_SOURCE = `https://github.com/systemed/tilemaker/releases/tag/${TILEMAKER_VERSION}`;

function runTilemaker(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tilemaker exited with code ${code}`));
    });
  });
}

async function main() {
  ensureDataDirs();
  const input = pbfPath();
  if (!fs.existsSync(input)) {
    console.error('Missing PBF. Run npm run download:osm');
    process.exit(1);
  }

  const exe = resolveTilemaker();
  if (!exe) {
    printTilemakerInstallHelp();
    process.exit(1);
  }

  const configPath = path.join(ROOT_DIR, 'config', 'tilemaker-roads-v2.json');
  const processPath = path.join(ROOT_DIR, 'config', 'tilemaker-process-v2.lua');
  const outputDir = tilesRootDir();
  const mbtilesFile = path.join(path.dirname(outputDir), 'roads.mbtiles');
  const storeDir = path.join(ROOT_DIR, 'data', 'processed', 'tilemaker-store');
  fs.mkdirSync(storeDir, { recursive: true });
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  if (fs.existsSync(mbtilesFile)) {
    fs.unlinkSync(mbtilesFile);
  }

  const bbox = `${REGION_BOUNDS.west},${REGION_BOUNDS.south},${REGION_BOUNDS.east},${REGION_BOUNDS.north}`;
  const started = Date.now();
  const memBefore = process.memoryUsage().rss;
  const inputSize = fs.statSync(input).size;

  console.log(`tilemaker: ${exe}`);
  console.log(`source: ${input} (${inputSize} bytes)`);
  console.log(`output: ${mbtilesFile}`);

  const args = [
    `--input=${input}`,
    `--output=${mbtilesFile}`,
    `--config=${configPath}`,
    `--process=${processPath}`,
    `--store=${storeDir}`,
  ];

  await runTilemaker(exe, args);

  const mbtilesSize = fs.statSync(mbtilesFile).size;
  let tileCount = 0;
  try {
    const { extractMbtilesToDirectory } = await import('./extract-mbtiles-to-dir.js');
    tileCount = await extractMbtilesToDirectory(mbtilesFile, outputDir);
  } catch (err) {
    console.warn('MBTiles→directory extract skipped (server can read MBTiles directly):', err.message);
    tileCount = 0;
  }
  if (tileCount === 0) {
    const { mbtilesTileCount } = await import('../src/lib/mbtiles-reader.js');
    tileCount = await mbtilesTileCount();
  }
  const sizeBytes = mbtilesSize + tilesDiskSizeBytes();
  const extraction = fs.existsSync(extractionMetaPath())
    ? JSON.parse(fs.readFileSync(extractionMetaPath(), 'utf8'))
    : null;

  const datasetMeta = {
    format: TILES.storageFormat,
    layer: 'roads',
    sourceId: TILES.sourceId,
    minZoom: TILES.minZoom,
    maxZoom: TILES.maxZoom,
    tileCount,
    sizeBytes,
    outputDir,
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    peakMemoryRss: Math.max(memBefore, process.memoryUsage().rss),
    toolchain: {
      name: 'tilemaker',
      version: TILEMAKER_VERSION,
      sourceUrl: TILEMAKER_SOURCE,
      executable: path.basename(exe),
      inputBytes: inputSize,
      geojsonSeqWays: extraction?.totalWays ?? null,
      warnings: [],
      featureDropNote:
        'Tilemaker may simplify geometries per layer config; all highway=* ways are emitted to layer roads without class-based exclusion.',
    },
  };
  fs.writeFileSync(datasetMetaPath(), JSON.stringify(datasetMeta, null, 2));
  console.log(`Tiles: ${tileCount} files, ${sizeBytes} bytes, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
