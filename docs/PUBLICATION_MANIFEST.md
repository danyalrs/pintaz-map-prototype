# Public publication manifest

This tree is a **clean export** for GitHub publication. It is not a fork of the development repository’s git history.

## Included

- Application server and viewer (`src/`)
- All CLI `scripts/` (discovery, enrichment prototypes, tile pipeline, audits)
- Full `tests/` including synthetic fixtures under `tests/fixtures/`
- `config/`, `docs/`, `pre_osm_lane_visual_repair_v1/`
- `package.json`, `package-lock.json`, `.gitignore`, `.env.example`
- `PROJECT_HANDOVER.md`, root `README.md`
- Redacted reports under `reports/public/`

## Excluded (not copied)

- `.git/` history
- `node_modules/`
- `.env` and secrets
- Entire `data/` tree (OSM PBF, tiles, maps-read caches, qualification raw GeoJSON, checkpoints, private `*.private.json` inventories)
- Full `reports/` tree from development (only `reports/public/` subset included)
- `.checkpoint_test_backup/`, `tools/`, build caches, `*.part` downloads, qlogs, videos

## Redaction

- Public reports use redacted way ids (`way-XXXXXX`) and dongle refs where applicable
- No bearer tokens, Mapbox `sk.` keys, or full 16-character dongle ids in committed reports
- Maps Read API base URL in code is the documented production hostname (not a secret)

## Regenerating reports

Requires private `data/maps-read/full-route-enrichment-discovery-v1/` artifacts on a development machine — not shipped here.
