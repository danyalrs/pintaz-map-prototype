# Future qlog integration (planned only)

This prototype does **not** process qlogs or run Pintaz update logic yet.

## Planned separation

```
raw qlogs (modelV2, gpsLocation / gpsLocationExternal)
    → raw GeoJSON update file (per-run export)
    → map layer: qlog-observations (visualization only at first)
    → future update validation + application algorithm
    → map layer: accepted-updates (approved changes)
```

## Rules

- **OSM baseline roads** (`osm-baseline-roads`) remain the imaginary Pintaz database baseline.
- **Qlog observations** are a separate layer; never baked into OSM baseline tiles automatically.
- **Accepted updates** are a separate layer after a future algorithm approves changes.
- Do not modify Mapbox hosted road data.

Implementation of the update algorithm and qlog parsers is out of scope for v0.1.
