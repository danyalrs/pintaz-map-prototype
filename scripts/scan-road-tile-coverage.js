import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFullCoverageScan, pickRecommendations } from '../src/lib/tile-coverage-scan.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV_DIR = path.join(ROOT, 'data', 'coverage');
const REP_DIR = path.join(ROOT, 'reports', 'coverage');

async function main() {
  console.log('Scanning served road tiles (read-only, no rebuild)...');
  const started = Date.now();
  const scan = await runFullCoverageScan({
    onProgress: (p) => {
      if (p.done) console.log(`Scanned ${p.scanned} tile files.`);
      else if (p.scanned % 10000 === 0) console.log(`  …${p.scanned} files`);
    },
  });

  fs.mkdirSync(COV_DIR, { recursive: true });
  fs.mkdirSync(REP_DIR, { recursive: true });

  for (const z of [10, 12, 14]) {
    const out = path.join(COV_DIR, `road-tile-coverage-z${z}.geojson`);
    fs.writeFileSync(out, JSON.stringify(scan.geojsonByZoom[z]));
    console.log(`Wrote ${out} (${scan.geojsonByZoom[z].features.length} features)`);
  }

  const componentsFlat = [];
  for (const z of [10, 12, 14]) {
    for (const c of scan.componentsByZoom[z] || []) {
      componentsFlat.push(c);
    }
  }
  fs.writeFileSync(path.join(COV_DIR, 'coverage-components.json'), JSON.stringify(componentsFlat, null, 2));

  const recommendations = pickRecommendations(scan.rankedByZoom);
  const rankedOut = {
    generatedAt: scan.scannedAt,
    zoom12: scan.rankedByZoom[12]?.malaysia?.slice(0, 25) || [],
    zoom14: scan.rankedByZoom[14]?.malaysia?.slice(0, 25) || [],
    recommendations,
  };
  fs.writeFileSync(path.join(REP_DIR, 'ranked_candidate_areas.json'), JSON.stringify(rankedOut, null, 2));

  const summary = {
    generatedAt: scan.scannedAt,
    durationMs: Date.now() - started,
    inventoryFileCount: scan.inventoryFileCount,
    scannedRecords: scan.scannedRecords,
    summaryByZoom: scan.summaryByZoom,
    malaysiaComponentCounts: {
      z10: (scan.rankedByZoom[10]?.malaysia || []).length,
      z12: (scan.rankedByZoom[12]?.malaysia || []).length,
      z14: (scan.rankedByZoom[14]?.malaysia || []).length,
    },
    tmsVerification: scan.tmsCheck,
    recommendations,
  };
  fs.writeFileSync(path.join(REP_DIR, 'coverage_summary.json'), JSON.stringify(summary, null, 2));

  const md = buildMarkdown(scan, recommendations);
  fs.writeFileSync(path.join(REP_DIR, 'MALAYSIA_COVERAGE_REPORT.md'), md);

  fs.writeFileSync(
    path.join(REP_DIR, 'commands.txt'),
    [
      'node scripts/scan-road-tile-coverage.js',
      'npm test',
      'npm run validate:data',
    ].join('\n')
  );

  console.log('Done.', JSON.stringify(summary.summaryByZoom, null, 2));
}

function buildMarkdown(scan, recommendations) {
  const lines = [
    '# Malaysia road-tile coverage report',
    '',
    `Generated: ${scan.scannedAt}`,
    '',
    '## Inventory',
    `- Tile files on disk: **${scan.inventoryFileCount}**`,
    `- Records scanned (z10–14): **${scan.scannedRecords}**`,
    '',
    '## By zoom',
  ];
  for (const [z, s] of Object.entries(scan.summaryByZoom)) {
    lines.push(
      `- z${z}: total=${s.total} renderable=${s.renderable} roads=${s.roads} sparse=${s.sparse} empty=${s.no_roads} decode_fail=${s.decode_fail} roadFeatures=${s.roadFeatures}`
    );
  }
  lines.push('', '## Malaysia component counts', '');
  lines.push(`- z10: ${(scan.rankedByZoom[10]?.malaysia || []).length}`);
  lines.push(`- z12: ${(scan.rankedByZoom[12]?.malaysia || []).length}`);
  lines.push(`- z14: ${(scan.rankedByZoom[14]?.malaysia || []).length}`);
  lines.push('', '## Recommendations', '');
  for (const [k, v] of Object.entries(recommendations)) {
    if (!v) {
      lines.push(`- **${k}**: none`);
      continue;
    }
    if (k === 'scoringNotes') continue;
    lines.push(
      `- **${k}**: ${v.componentId} — ${v.tileCount} tiles, ${v.roadFeatureCount} road features, ${v.areaKm2.toFixed(1)} km², completeness ${v.completenessPct.toFixed(1)}%, score ${(v.score ?? 0).toFixed(2)}`
    );
    lines.push(`  - centre: ${v.centre.lon.toFixed(5)}, ${v.centre.lat.toFixed(5)}`);
  }
  lines.push('', 'Place names: not extracted from PBF in this pass (use Mapbox labels at centre).');
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
