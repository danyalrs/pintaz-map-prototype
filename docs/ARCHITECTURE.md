# Architecture overview

High-level map of the repository. For operator runbooks and Phase 3 counts, see [PROJECT_HANDOVER.md](../PROJECT_HANDOVER.md).

## Runtime (map viewer)

| Piece | Location |
|-------|----------|
| HTTP server | [`src/server.js`](../src/server.js) |
| Browser UI | [`src/public/`](../src/public/) |
| Road MVT tiles | Served from `data/tiles/` (built locally) |
| Styles & pilot config | [`config/`](../config/) |

## Data pipeline (local OSM)

```
download-osm → verify-osm → extract:roads → build:tiles → validate:data
```

Scripts live under [`scripts/`](../scripts/). Details: [DATA_PIPELINE.md](DATA_PIPELINE.md).

## Maps Read discovery (read-only libraries)

| Phase | Library / scripts |
|-------|-------------------|
| Catalogue & poses | `src/lib/full-maps-read-route-enrichment-discovery/` |
| Route qualification | `src/lib/route-aware-lane-calibration-audit/` |
| Point-only signatures | `src/lib/point-only-lane-signature-calibration/` |
| Final reports | `scripts/build-final-phase3-results.js` |

Outputs are designed for **reporting only** — no OSM writes. Public aggregates: [`reports/public/`](../reports/public/).

## Experimental (not production lane counting)

| Module | Role |
|--------|------|
| `maps-read-polyline-adapter/` | Future polyline export ingestion (fixtures) |
| `lane-enrichment-algorithm-core/` | Cross-section prototype on synthetic geometry |
| `lane-enrichment-geometry-v2*` | Geometry experiments & diagnosis |
| `maps-read-lane-geometry-capability-audit/` | Docs vs saved GeoJSON capability |

Current Maps Read `/v1/geojson` exports are **point-only**; see [export-contract.js](../src/lib/maps-read-lane-geometry-capability-audit/export-contract.js).

## Tests

[`tests/`](../tests/) — Node built-in test runner (`npm test`). Fixture-only tests run without private `data/maps-read/` trees.
