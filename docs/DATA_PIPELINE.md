# Data pipeline

## Selected toolchain (approved)

| Option | Decision |
|--------|----------|
| A. tilemaker (native Windows) | **Selected** — official release asset `tilemaker-windows.zip` |
| B. Tippecanoe via WSL | Not used (WSL not installed; ask before enabling) |
| Unofficial tippecanoe.exe | **Rejected** |

**Tool:** [tilemaker](https://github.com/systemed/tilemaker) **v2.4.0**
**Asset:** https://github.com/systemed/tilemaker/releases/download/v2.4.0/tilemaker-windows.zip
**Install path:** `tools/tilemaker-v2/` (gitignored)
**Input:** existing Geofabrik PBF (`data/raw/malaysia-singapore-brunei-latest.osm.pbf`) — **not re-downloaded**
**Config:** `config/tilemaker-roads-v2.json` + `config/tilemaker-process-v2.lua`
**Output:** `data/tiles/roads.mbtiles` (57,294 vector tiles, layer `roads`, zoom **10–14** in this build)
**Serve:** Express serves `/tiles/roads/{z}/{x}/{y}.pbf` using **XYZ** `{y}` in the URL. Directory tiles and MBTiles lookups convert to TMS row with `y_tms = (2^z - 1) - y_xyz` (`src/lib/tile-encoding.js`, `src/lib/mbtiles-reader.js`).
**Compression:** Payloads are usually **gzip** (`1f 8b`); responses include `Content-Encoding: gzip` and `Content-Type: application/vnd.mapbox-vector-tile`.
**Optional:** post-build extract to `data/tiles/roads/{z}/{x}/{y}.pbf` (XYZ paths) via `scripts/extract-mbtiles-to-dir.js`.

> **Zoom note:** A full z4–14 build of ~1.96M highway ways was attempted but tile emission at z4–9 is extremely slow on this workstation. The current production MBTiles uses **z10–14** so city-scale review works; extending to z4–9 is planned via WSL + Tippecanoe or a longer tilemaker run.

## Stages

1. **Download** — `npm run download:osm` (skipped in this session; PBF already validated).
2. **Verify** — `npm run verify:osm`.
3. **Extract (audit)** — `npm run extract:roads` → `roads.geojsonseq` + `extraction-meta.json` (1,962,847 ways, 0 rejected).
4. **Tile** — `npm run build:tiles` → tilemaker → `roads.mbtiles` + `dataset-meta.json`.
5. **Serve** — `npm start` → Mapbox GL JS vector source `osm-baseline-roads`, layers `osm-baseline-*`.

## Pilot area vs regional extract

| Scope | Meaning |
|-------|---------|
| Geofabrik PBF + extraction | Malaysia, Singapore, Brunei (full source) |
| Generated tiles (current build) | **57,294** files, z10–14, **patchy** across the extract |
| **Pilot prototype** | Verified **Bandar Kinrara–Puchong** bounds in `config/pilot-area.json` |

The UI does **not** claim full-country coloured road coverage. Regional completeness requires a separate tile rebuild or investigation — **not** performed during pilot scoping. See `docs/PILOT_AREA.md` and `reports/pilot_area/coverage_audit.json`.

## Layer separation

| Layer ID | Role |
|----------|------|
| Mapbox `light-v11` | Hosted basemap only |
| `osm-baseline-roads` | Local OSM highway tiles |
| `qlog-observations` | Reserved |
| `accepted-updates` | Reserved |
