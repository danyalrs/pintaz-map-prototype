# Pintaz Map Prototype

Open-source **miniature Pintaz Map** stack: Mapbox basemap, local OSM road vector tiles, route comparison tooling, and **read-only** Maps Read discovery pipelines for a Kuala Lumpur pilot area. This repository is application code, geometry-processing libraries, validation, and tests — **not** a lane-counting product.

## What this project does (implemented)

| Area | Status |
|------|--------|
| Web map viewer (`src/server.js`, Mapbox + MVT roads) | **Implemented** |
| OSM download → extract → tile build pipeline | **Implemented** (requires local data) |
| Local route explorer / comparison bundles | **Implemented** (optional local derived previews) |
| Point-only lane signature calibration & route-aware audits | **Implemented** (synthetic / local bundles when present) |
| Full Maps Read route enrichment discovery Phases 0–3 | **Implemented** (requires Maps Read token + cached exports for full replay) |
| Maps Read polyline adapter & lane-enrichment algorithm core | **Prototype libraries** (synthetic fixtures; rejects point-only exports) |
| Cross-section lane **count** on unknown OSM ways | **Not implemented** — proposed only |
| OSM lane tag writes | **Not performed** |

**Important:** `lane_point`, `edge_point`, `lane_index`, and green markers in Maps Read GeoJSON are **visualization samples**, not verified physical lane inventory. Phase 3 **does not infer lane counts** and does not edit OSM.

### Final screening results (Bukit pilot, read-only synthesis)

From completed Phase 3 checkpoint (see `reports/public/final_phase3_summary.json`):

| Metric | Count |
|--------|------:|
| Relevant routes screened | **1,597** |
| Routes qualified for future geometry | **198** |
| Qualified route × unknown-way pairs **before geometry gates** | **1,123** |
| Pairs reaching geometry evaluation | **430** |
| Future-geometry **candidate** pairs (after gates) | **90** |
| Unknown-lane roads with ≥1 candidate pair | **46** |

All **198** qualified saved `lane-edge` exports audited in development were **point-only** geometry (no ordered polylines). Cross-section lane counting remains **proposed** and needs ordered lane-boundary / road-edge polylines per `src/lib/maps-read-lane-geometry-capability-audit/export-contract.js`.

## Requirements

- **Node.js** 20+
- **npm** 10+
- **Mapbox** public token (`pk.…`) for the map UI
- **tilemaker** (optional) for rebuilding road tiles — see `docs/DATA_PIPELINE.md`

## Installation

```bash
git clone https://github.com/danyalrs/pintaz-map-prototype.git
cd pintaz-map-prototype
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

### Configuration (placeholders)

Edit `.env`:

```env
MAPBOX_ACCESS_TOKEN=pk.your_public_mapbox_token_here
# Optional — only for live Maps Read API scripts (not required for map server or most unit tests):
# MAPS_READ_TOKEN=your_maps_read_bearer_token_here
```

Never commit `.env`. Secret Mapbox `sk.` tokens are rejected by the server.

## Run the map server

```bash
npm start
```

Open **http://127.0.0.1:3901** (pilot area; road overlay needs built tiles under `data/tiles/`).

## What works without private datasets

- **Unit tests** that use synthetic fixtures (`tests/maps-read-polyline-adapter.test.js`, lane-enrichment core fixtures, Phase 3 shortlist logic, etc.)
- **Static analysis** / `node --check` on entry scripts
- **Reading** discovery libraries and report regeneration logic (outputs require checkpoint files you must generate or obtain separately)

## What requires local / private data

| Need | Purpose |
|------|---------|
| `data/raw/`, `data/processed/`, `data/tiles/` | Map road overlay |
| `data/maps-read/` | Full discovery replay, qualification raw GeoJSON, Phase 3 checkpoint |
| `data/local-area/`, comparison bundles | Route-aware calibration integration tests |
| `MAPS_READ_TOKEN` | Live `/v1/geojson` fetch scripts |

This public repo **does not ship** those datasets.

## Architecture (main folders)

```
src/
  server.js              Express app, Mapbox map, tile API
  lib/
    full-maps-read-route-enrichment-discovery/   Phase 0–3 discovery + final reports
    point-only-lane-signature-calibration/      Signature + LOO calibration
    route-aware-lane-calibration-audit/         Per-route qualification policy
    maps-read-lane-geometry-capability-audit/   Docs vs saved GeoJSON capability
    maps-read-polyline-adapter/                 Future polyline export adapter (fixtures)
    lane-enrichment-algorithm-core/             Cross-section prototype (not production)
    lane-enrichment-geometry-v2*/                 Geometry experiments + diagnosis
    …                                           OSM tiles, comparison, local routes
scripts/                   CLI runners (discovery, audits, tile pipeline)
tests/                     Node test runner suite
config/                    Road style taxonomy
docs/                      Pilot notes, data pipeline, future qlog notes
reports/public/            Redacted aggregate reports (no raw drives)
PROJECT_HANDOVER.md        Operator handover (counts, regen commands)
```

## Tests and validation

```bash
npm test
node --check src/server.js
npm run validate:data    # requires built road dataset under data/ — fails on clone-only checkout
```

**Publication validation (typical clone):**

- `npm test` — many tests pass; integration tests **skip** when comparison bundles or `data/maps-read/` are absent.
- `npm run validate:data` — **blocked** without `data/processed` / tiles (documented, not a failure of code integrity).

Regenerate public report aggregates (requires local checkpoint + `discovery-progress.json`):

```bash
node scripts/build-final-phase3-results.js
node scripts/audit-qualified-route-lane-edge-exports-v1.js
```

## Proposed future work (not claimed as shipped)

- Maps Read **polyline export** (`kommu.maps.lane_polyline_export` / `export-contract.js`)
- Cross-section boundary evidence → lane-count **candidates** on unknown ways (algorithm core exists as research code only)
- Raw qlog integration (`docs/FUTURE_QLOG_INTEGRATION.md`)

## Documentation

- **`PROJECT_HANDOVER.md`** — phases, scripts, exclusions, Kamuning × drive-267 walkthrough
- **`docs/PILOT_AREA.md`**, **`docs/DATA_PIPELINE.md`**, **`docs/BUKIT_MULTI_DRIVE_BASELINE.md`**
- **`reports/public/`** — redacted Phase 3 final evidence

## Licensing & attribution

Map data © OpenStreetMap contributors. Mapbox © Mapbox. No license file is included in this repository; use and redistribution are at your own discretion until an explicit license is added by the owner.
