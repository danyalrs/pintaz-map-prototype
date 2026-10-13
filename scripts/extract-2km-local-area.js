import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLocalAreaRoads } from '../src/lib/extract-local-area.js';
import {
  loadLocalAreaConfig,
  localAreaGeojsonPath,
  localAreaMetaPath,
  resolveAreaId,
  isConfiguredAreaId,
} from '../src/lib/local-areas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const areaArg = process.argv[2];
  const normalized = areaArg ? normalizeAreaIdArg(areaArg) : null;
  if (areaArg && (!normalized || !isConfiguredAreaId(normalized))) {
    console.error(`Invalid or unknown area: ${areaArg}`);
    process.exit(1);
  }
  const areaId = resolveAreaId(normalized);

  const cfg = loadLocalAreaConfig(areaId);
  const { geojson, stats, contentHash } = await extractLocalAreaRoads(cfg.bounds);
  const outDir = path.dirname(localAreaGeojsonPath(areaId));
  fs.mkdirSync(outDir, { recursive: true });
  const geoPath = localAreaGeojsonPath(areaId);
  const metaPath = localAreaMetaPath(areaId);
  fs.writeFileSync(geoPath, JSON.stringify(geojson));
  const meta = {
    generatedAt: new Date().toISOString(),
    areaId,
    label: cfg.subtitle,
    displayName: cfg.displayName,
    centre: { lon: cfg.centre.lon, lat: cfg.centre.lat },
    bounds: cfg.bounds,
    dimensions: cfg.dimensions,
    extraction: stats,
    contentHash,
    source: 'data/processed/roads.geojsonseq',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(
    JSON.stringify(
      {
        areaId,
        features: stats.emitted,
        lengthKm: stats.lengthKm.toFixed(2),
        widthM: cfg.dimensions.widthM.toFixed(2),
        heightM: cfg.dimensions.heightM.toFixed(2),
        hash: contentHash.slice(0, 16),
      },
      null,
      2
    )
  );
}

function normalizeAreaIdArg(raw) {
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  if (!/^[a-z][a-z0-9-]*$/.test(id)) return null;
  return id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
