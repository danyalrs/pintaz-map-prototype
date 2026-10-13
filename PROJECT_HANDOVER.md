# Pintaz Map — Full Maps Read route enrichment discovery (handover)

Read-only handover for the Bukit Bintang / Imbi pilot. **No OSM lane counts were inferred or written.** Point-only Maps Read layers (`lane_point`, `edge_point`, `lane_index`, green markers) are **not** treated as physical lane inventory.

---

## 1. Project goal and scope

**Goal:** Discover which Maps Read catalogue routes credibly cover **unknown-lane** OSM ways in the pilot bbox, screen each route on **known-lane** one-way OSM ways on the **same drive** (no cross-route pooling), and produce a **future-geometry shortlist** — not an OSM enrichment result.

**In scope (completed):**

- Phase 0–2: catalogue seed, vehicle-pose index, unknown-lane way × route coverage (`discovery-progress.json`).
- Phase 3: per-route qualification checkpoint, unknown-lane pair shortlist, final read-only reports.
- Supporting audits: pose-index reconciliation, geometry source capability, qualified-route lane-edge export inventory.

**Out of scope (not done):**

- OSM edits, production Maps Read writes, route activation, lane-count tags on unknown ways.
- Ordered lane-boundary / road-edge polyline enrichment (blocked on upstream export).
- Old qlog ingestion.

---

## 2. Completed phases and final counts

Validated against `data/maps-read/full-route-enrichment-discovery-v1/phase3-route-qualification.json` (1,597 checkpoint rows, 0 pending).

| Metric | Count |
|--------|------:|
| Relevant routes screened (Phase 3) | **1,597** |
| Routes qualified for future geometry (`route_verdict: route_qualified_for_experiment`) | **198** |
| Qualified route × unknown-way pairs **before geometry gates** | **1,123** |
| Qualified pairs with pose minimum + geometry evaluation (`future_geometry` + `not_geometry_eligible`) | **430** |
| **Future geometry candidate** pairs **after geometry gates** | **90** |
| Unknown-lane OSM ways with ≥1 post-gate candidate pair | **46** |
| Phase 2 route × unknown-way index rows | 8,828 |
| Unknown-lane ways with any route coverage | 1,154 |
| Retryable Phase 3 failures | **0** |

**Label note:** Checkpoint stores `route_qualified_for_experiment`; reports use **qualified for future geometry** / `routes_qualified_for_future_geometry` for the same 198 routes (`final_phase3_summary.json` → `route_verdict_label_mapping`).

---

## 3. Main scripts, reports, regeneration

### Data (gitignored)

`data/maps-read/full-route-enrichment-discovery-v1/` — checkpoint, pose raw, `qualification-raw/`, `discovery-progress.json`.

### Reports

`reports/public/` (full development tree: `reports/full_maps_read_route_enrichment_discovery_v1/` — not shipped)

| Artifact | Purpose |
|----------|---------|
| `FINAL_PHASE3_RESULTS.md` | Executive final summary |
| `final_phase3_summary.json` | Machine-readable final counts |
| `qualified_route_unknown_way_shortlist.redacted.json` | **90** post-gate pairs only |
| `top_20_future_geometry_pairs.md` | Ranked top 20 |
| `PHASE3_GEOMETRY_SOURCE_CAPABILITY_AUDIT.md` | Maps Read geometry vs export contract |
| `phase3_geometry_source_capability_audit.json` | Audit JSON |
| `qualified_route_lane_edge_export_audit.json` | 198-route lane-edge file classification |
| `PHASE3_POSE_LOOKUP_RECONCILIATION.md` | Stale `no_vehicle_pose_index` reconciliation |
| `PHASE3_COMPLETION_ABSTENTION_ANALYSIS.md` | Abstention synthesis (read-only) |

### Regeneration (no API fetch required)

```bash
node scripts/reconcile-phase3-pose-lookup-v1.js          # only if reconciling stale pose lookup rows
node scripts/build-final-phase3-results.js
node scripts/build-phase3-geometry-source-capability-audit.js
node scripts/audit-qualified-route-lane-edge-exports-v1.js
node scripts/build-phase3-completion-abstention-analysis.js
```

Phase 3 batch (requires `MAPS_READ_TOKEN` in `.env`; **complete** — do not re-run unless re-screening):

```bash
node scripts/run-full-maps-read-phase3-unknown-lane-shortlist-v1.js
```

Discovery Phase 0–2 (historical; uses API unless resuming from checkpoint):

```bash
node scripts/run-full-maps-read-route-enrichment-discovery-v1.js
```

### Validation

```bash
npm run test:public
node --check src/server.js
npm run validate:data   # full OSM/tile tree — not on public clone
```

See [docs/TESTING.md](docs/TESTING.md). Public clone: **`npm run test:public`** validates committed fixtures and redacted `reports/public/` aggregates. Full `npm test` and `validate:data` need additional local datasets.

---

## 4. Completed work vs proposed cross-section lane-count method

| Area | Status |
|------|--------|
| Route catalogue + pose index + OSM way coverage | **Done** (Phase 1–2) |
| Same-route hold-out qualification on known-lane one-way ways (point-only signatures) | **Done** (Phase 3) |
| Unknown-lane pair shortlist + geometry gates | **Done** (90 candidates) |
| **Cross-section lane-count inference on unknown ways** | **Not implemented / not applied** |
| `lane-enrichment-algorithm-core` (cross-section, boundary evidence, lane-count candidate) | **Prototype library + fixtures only** — requires polyline observations |
| `maps-read-polyline-adapter` | **Fixture / synthetic routes only** — rejects current point-only exports |
| `lane-enrichment-geometry-v2` / v3 source audit | **Diagnosis on local observation routes** — documents inability to intersect degenerate one-point “lines” |

Phase 3 deliberately **abstains** from emitting `selected_lane_count` on unknown ways. The cross-section pipeline remains a **proposed** path once Maps Read supplies ordered polylines per `src/lib/maps-read-lane-geometry-capability-audit/export-contract.js`.

---

## 5. Geometry limitations and export contract

**Current Maps Read `/v1/geojson` (saved `data/maps-read/docs.safe.json`):**

- Schema `kommu.maps.visualization-point-cloud` — **Point** features only for `lane_point`, `edge_point`, `vehicle_pose`.
- WGS84 coordinates; per-sample `model_y_m` lateral offset; `frame_id` / `log_mono_time` for association.
- **Not** ordered polylines; `lane_index` / `edge_index` are visualization slots, not lane inventory.

**Required for future geometry work** (`export-contract.js` → `UPSTREAM_EXPORT_REQUEST`):

- Per frame: `feature_type` `lane_boundary` | `road_edge`, stable `line_id`, `probability`, **`coordinates_local_m`** ordered vertex chains, documented `coordinate_frame`, vehicle pose / timestamp.

**Qualified-route lane-edge audit (saved files only):** see §6.

---

## 6. Lane-edge export audit (198 qualified routes)

Command: `node scripts/audit-qualified-route-lane-edge-exports-v1.js`  
Output: `reports/.../qualified_route_lane_edge_export_audit.json`  
Logic: `src/lib/full-maps-read-route-enrichment-discovery/audit-qualified-lane-edge-exports.js`

| Classification | Count (handover) |
|----------------|-----------------:|
| **point_only** | **198** |
| polyline_containing | 0 |
| mixed | 0 |
| missing | 0 |
| unreadable | 0 |
| unknown | 0 |

Every saved `qualification-raw/{route_ref}/lane-edge.geojson` for qualified routes matches the point-only visualization pattern (≤1 vertex per `frame_id` × `lane_index` / `edge_index`; no `coordinates_local_m` chains). **Do not assume drive-267 is unique** — the audit scanned all 198.

---

## 7. Jalan Kamuning 39914067 × drive-267 (evidence walkthrough)

**OSM context:** Way `39914067` is **lane_count_unknown** in the pilot unknown-lane set (`missing-lane-ways` / baseline).

**Phase 2 coverage** (`discovery-progress.json` way row):

- `route_ref`: `drive-267`
- `matched_pose_count`: **13**
- `median_distance_m`: ~6.48 m, `median_heading_diff_deg`: ~5.4°
- `direction_compatible_fraction`: ~0.92
- `continuous_covered_length_m`: ~43.4 m

**Phase 3 route screen** (`phase3-route-qualification.json`):

- `route_verdict`: **`route_qualified_for_experiment`** (report label: qualified for future geometry)
- Passed same-route hold-out evaluation on labelled one-way ways; **no** `selected_lane_count` on unknown ways.

**Pair shortlist** (`buildPairShortlistRows` / `final_phase3_summary.json`):

- Status: **`future_geometry_candidate`** (one of **90** post-gate pairs)
- `shortlist_ranking_score` combines pose support, distance/heading quality, direction fraction, and continuous length after `PHASE3_GEOMETRY_GATES` (`phase3-constants.js`).

**Saved observation files (read-only):**

- `qualification-raw/drive-267/lane-edge.geojson` — lane/edge **points** only (11,472 features in file; point-only audit class).
- `vehicle-pose-raw/drive-267/` — vehicle poses with `frame_id`, `heading_deg`, `log_mono_time`.

**Why it is a candidate:** The **route** passed the labelled-way reliability screen; **spatial** pose coverage on the unknown way passes geometry gates. That supports **future** geometry work along this drive segment.

**Why no lane count can be inferred:** Exports lack ordered lane-boundary and road-edge **polylines** in a stable metre frame. Point samples and `lane_index` ordering are model visualization artifacts, not validated lane counts. Phase 3 sets `selected_lane_count: null` on all shortlist rows.

---

## 8. Unresolved / follow-up

1. **Upstream:** Deliver Maps Read polyline export per `export-contract.js` before any cross-section enrichment on the 90 pairs.
2. **Re-screening:** Only needed if qualification rules or checkpoint rows change; current checkpoint is complete (0 pending).
3. **Lorong Kuda 706737045:** No rows in Phase 2 coverage index — no candidate pairs (documented in `final_phase3_summary.json`).

---

## 9. Principles (carry forward)

- No cross-route prototype pooling for qualification.
- No lane-count inference from point-only GeoJSON.
- Shortlist rows are **future geometry candidates only**, not confirmed OSM lane tags.
- Regenerate reports from checkpoint + `discovery-progress.json`; avoid new Maps Read fetches for documentation-only updates.
