import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildWayStore } from '../src/lib/osm-logical-road-feasibility/way-store.js';
import { classifyOsmWayTransition } from '../src/lib/osm-logical-road-feasibility/continuation.js';
import { logicalRoadId } from '../src/lib/osm-logical-road-feasibility/logical-chains.js';
import { groupSectionsContiguous } from '../src/lib/mismatch-section-group.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';

function miniRoads(features) {
  return { type: 'FeatureCollection', features };
}

function line(osmId, coords, props = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { osm_id: osmId, highway: 'residential', ...props },
  };
}

describe('osm logical road chaining feasibility', () => {
  it('protected hash/digest checks', () => {
    const v = verifyProtectedInputHashes();
    assert.equal(v.ok, true, JSON.stringify(v.mismatches));
  });

  it('exact shared endpoints classify as safe when unique', () => {
    const roads = miniRoads([
      line('1', [[0, 0], [0.0001, 0]], { name: 'A' }),
      line('2', [[0.0001, 0], [0.0002, 0]], { name: 'A' }),
    ]);
    const store = buildWayStore(roads);
    const r = classifyOsmWayTransition('1', '2', store, { toleranceM: 0, maxHeadingDeg: 20 });
    assert.equal(r.classification, 'safe_unique_continuation');
  });

  it('ambiguous junction rejects fork with two continuations', () => {
    const roads = miniRoads([
      line('1', [[0, 0], [0.0001, 0]], { name: 'Fork' }),
      line('2', [[0.0001, 0], [0.0002, 0.0001]], { name: 'Fork' }),
      line('3', [[0.0001, 0], [0.0002, -0.0001]], { name: 'Fork' }),
    ]);
    const store = buildWayStore(roads);
    const r = classifyOsmWayTransition('1', '2', store, { toleranceM: 1, maxHeadingDeg: 45 });
    assert.notEqual(r.classification, 'safe_unique_continuation');
  });

  it('lane semantics conflict', () => {
    const roads = miniRoads([
      line('1', [[0, 0], [0.0001, 0]], { lanes: '2' }),
      line('2', [[0.0001, 0], [0.0002, 0]], { lanes: '4' }),
    ]);
    const store = buildWayStore(roads);
    const r = classifyOsmWayTransition('1', '2', store, { toleranceM: 0, maxHeadingDeg: 30 });
    assert.equal(r.classification, 'lane_semantics_mismatch');
  });

  it('roundabout rejection', () => {
    const roads = miniRoads([
      line('1', [[0, 0], [0.0001, 0]], { junction: 'roundabout' }),
      line('2', [[0.0001, 0], [0.0002, 0]]),
    ]);
    const store = buildWayStore(roads);
    const r = classifyOsmWayTransition('1', '2', store, { toleranceM: 0, maxHeadingDeg: 45 });
    assert.equal(r.classification, 'roundabout_transition');
  });

  it('deterministic logical chain ids and osm id preservation in grouping hook', () => {
    const id1 = logicalRoadId(['2', '1']);
    const id2 = logicalRoadId(['1', '2']);
    assert.equal(id1, id2);
    const poses = [
      { properties: { pose_index: 0, osm_id: '1', logical_road_id: id1, bridge: null, tunnel: null, log_mono_time: 1 }, geometry: { coordinates: [0, 0] } },
      { properties: { pose_index: 1, osm_id: '2', logical_road_id: id1, bridge: null, tunnel: null, log_mono_time: 2 }, geometry: { coordinates: [0.00001, 0] } },
    ];
    const legacy = groupSectionsContiguous(poses);
    const logical = groupSectionsContiguous(poses, { osmGroupingKey: (p) => String(p.logical_road_id ?? p.osm_id) });
    assert.equal(legacy.length, 2);
    assert.equal(logical.length, 1);
    assert.equal(poses[0].properties.osm_id, '1');
    assert.equal(poses[1].properties.osm_id, '2');
  });

  it('default groupSectionsContiguous unchanged without osmGroupingKey', () => {
    const poses = [
      { properties: { pose_index: 0, osm_id: 'a', bridge: null, tunnel: null, log_mono_time: 1 }, geometry: { coordinates: [0, 0] } },
      { properties: { pose_index: 1, osm_id: 'b', bridge: null, tunnel: null, log_mono_time: 2 }, geometry: { coordinates: [0.0001, 0] } },
    ];
    assert.equal(groupSectionsContiguous(poses).length, 2);
  });

  it('bukit osm geojson hash unchanged', () => {
    const p = localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID);
    const h = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.equal(h, PROTECTED_INPUT_SHA256.bukit_osm);
  });
});
