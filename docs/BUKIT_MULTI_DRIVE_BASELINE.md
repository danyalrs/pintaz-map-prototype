# Bukit Bintang multi-drive OSM mismatch baseline

## Purpose

The **Bukit Bintang–Imbi** 2 km pilot is the first area where Pintaz compares **four independent drives** against **local OSM** inside a fixed pilot bbox. The goal is to find **cross-drive agreement** on possible map issues without exposing device identifiers or changing committed OSM geometry from the viewer.

## Four redacted drives (pilot vehicle poses)

| Redacted drive | Total route poses | Inside pilot | Outside pilot |
|----------------|------------------:|-------------:|--------------:|
| active | 1,209 | 591 | 618 |
| probe-008 | 3,340 | 1,293 | 2,047 |
| probe-010 | 4,272 | 1,250 | 3,022 |
| probe-001 | 2,678 | 2,452 | 226 |

Each drive maps to a **dongle group** label only (`dongle-group-A` … `dongle-group-D`). Four groups means four distinct devices in the private manifest; public outputs never include full dongle IDs or fingerprints.

## Processing order (OSM-first, per drive)

1. Load **Bukit OSM** roads and **lane baseline** (surfaces/dividers) for the 2 km area.
2. Build a **derived preview** per drive from gitignored route GeoJSON (active preview + three probe page-1 extracts).
3. **Match vehicle poses inside the pilot bbox only** to OSM (poses outside the pilot are excluded before matching).
4. Run **mismatch V1.1** per drive with pilot-scoped outside-coverage (exact pilot rectangle, not the active-route hull).
5. **Aggregate** sections by OSM way and span across drives (independent dongle groups required for multi-drive candidates).

## Cross-drive aggregation (summary)

- **Multi-drive candidate**: same OSM span, actionable mismatch class, stable sensitivity, **≥2 distinct dongle groups**.
- **Single-drive consistent**: one support-eligible centreline section classified `consistent_with_osm_lanes` on one drive only — **not** cross-drive agreement.
- **Consistent across drives**: requires consistent class on **≥2 dongle groups** on the same span.
- **Insufficient combined evidence**: spans that do not meet multi-drive or cross-drive consistent rules (expected for most OSM ways in this sample).

## Current baseline result

| Metric | Count |
|--------|------:|
| Support-eligible centreline | 1 |
| Support-eligible lane/edge | 0 |
| Single-drive consistent (OSM) | 1 (probe-001) |
| Consistent across drives | 0 |
| Multi-drive candidates | 0 |
| Insufficient combined evidence | 187 |

**Zero multi-drive candidates is a valid outcome** when no span has actionable mismatch evidence from two or more independent dongle groups under the frozen V1.1 thresholds.

## Limitations

- Pilot bbox only; poses and sections outside Bukit pilot are excluded from matcher input.
- Page-1 probe extracts are partial routes, not full pagination.
- No automatic OSM edits; viewer decisions on candidates are simulated only.
- No Maps Read API calls during offline regeneration.
- Logical OSM road chaining across parallel ways is not implemented.

## Regeneration (production)

From a **clean tracked** git tree on a commit **descended from** the multi-drive baseline (`18bb638…`):

```bash
node scripts/build-bukit-multi-drive-mismatch-v1.js
```

The guard checks: baseline ancestry, clean tracked tree, required input files, and frozen SHA-256 hashes for OSM, lane-baseline summary, and the four route inputs. Generated outputs under gitignored `data/maps-read/multi-drive-mismatch-v1/` may be rewritten.

Optional diagnosis reports (same guard):

```bash
node scripts/build-multi-drive-pilot-scope-diagnosis-v1.js
```

## Local viewer

```bash
npm start
```

Open **http://127.0.0.1:3901** — select **Bukit Bintang–Imbi** for the multi-drive panel and layers. Bandar Kinrara hides multi-drive layers.

## Privacy

Public docs and redacted JSON use **dongle-group-*** labels and **probe-*** / **active** drive refs only. Private manifests and route files stay gitignored.
