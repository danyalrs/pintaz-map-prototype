# Testing

## `npm run test:public`

Runs an **explicit manifest** of tests that need only committed code and synthetic fixtures (`scripts/public-test-files.json` → `scripts/run-public-tests.js`).

Supported on a fresh public clone **without**:

- `data/maps-read/` checkpoints or qualification caches
- Local route comparison bundles
- `MAPS_READ_TOKEN`
- tilemaker binary under `tools/`
- OSM PBF / MVT tile trees

```bash
npm run test:public
```

## `npm test` (full suite)

Runs **all** files under `tests/`. Many cases **skip** when optional local artifacts are missing; others expect private datasets and may **fail** on a clone-only checkout.

## `npm run validate:data`

Requires a completed local road pipeline:

- `data/raw/*.osm.pbf`
- `data/processed/roads.geojsonseq`
- `data/tiles/roads.mbtiles` (or extracted PBF tiles)

This is **not** part of `test:public` and will report missing files until you run `download:osm` → `extract:roads` → `build:tiles`.
