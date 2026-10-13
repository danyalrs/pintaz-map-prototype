# Bandar Kinrara–Puchong pilot area

## Why a pilot area?

The Geofabrik source PBF covers **Malaysia, Singapore, and Brunei**, and road extraction produced **1,962,847** highway ways. The current **tilemaker** build produced **57,294** vector tiles at zoom **10–14**, but **does not provide continuous regional coverage** across the full extract. Large areas outside the Klang Valley corridor have no local coloured overlay even though the Mapbox basemap still renders.

This prototype therefore scopes **verified local OSM road tiles** to a measured **Bandar Kinrara–Puchong** footprint instead of implying nationwide overlay coverage.

## Measured bounds

Configuration: `config/pilot-area.json` (`pilotAreaId`: `bandar-kinrara-puchong`).

Bounds are the geographic union of **served z14 road tiles** inside the Kinrara–Puchong search window (see `reports/pilot_area/coverage_audit.json`).

| Edge | Value (°) |
|------|-----------|
| West | 101.513671875 |
| South | 2.899152698504301 |
| East | 101.79931640625 |
| North | 3.184394492338734 |

At zoom **10**, a **2×2** tile block fully covers this window. At zoom **14**, the axis-aligned rectangle includes **27** missing tile files (sparse edges / no emitted geometry) — documented in the audit; the urban core (Kinrara, Puchong) has tiles and coloured roads.

## Map behaviour

- Initial view: pilot `defaultCenter` / `defaultZoom` (≥ 10).
- **Fit pilot area** — bounds from config.
- **Fit full region (extract scope)** — Geofabrik-wide bounds only; **does not** imply road overlay coverage.
- **maxBounds** — pilot bounds plus **0.035°** padding so users can pan slightly outside and see the warning.
- Detailed coloured roads require zoom **≥ 10**.

## What this does not prove

- Missing overlay outside the pilot is **not** evidence that OSM source data is absent.
- **Regional tile completeness** needs a separate investigation or rebuild (not done in the pilot scoping task).
