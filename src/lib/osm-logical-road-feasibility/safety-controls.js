import { classifyOsmWayTransition } from './continuation.js';
import { exitEndpointForTransition } from './way-store.js';

/**
 * Representative topology controls derived from Bukit OSM metadata (read-only).
 */
export function buildSafetyControlCases(wayStore) {
  const cases = [];
  const ways = [...wayStore.ways.values()];

  const roundabouts = ways.filter((w) => w.junction === 'roundabout' || w.highway === 'mini_roundabout');
  for (const w of roundabouts.slice(0, 5)) {
    const neighbors = ways.filter((n) => n.osm_id !== w.osm_id).slice(0, 3);
    for (const n of neighbors) {
      cases.push({
        control_id: `roundabout_${w.osm_id}_${n.osm_id}`,
        category: 'roundabout',
        from_osm_id: w.osm_id,
        to_osm_id: n.osm_id,
        expect_reject: true,
      });
    }
  }

  const links = ways.filter((w) => String(w.highway || '').includes('_link'));
  for (const w of links.slice(0, 8)) {
    const n = ways.find((x) => x.osm_id !== w.osm_id && x.highway && !String(x.highway).includes('_link'));
    if (n) {
      cases.push({
        control_id: `ramp_link_${w.osm_id}_${n.osm_id}`,
        category: 'motorway_trunk_link',
        from_osm_id: w.osm_id,
        to_osm_id: n.osm_id,
        expect_reject: true,
      });
    }
  }

  const layerMismatch = [];
  for (const a of ways) {
    for (const b of ways) {
      if (a.osm_id === b.osm_id) continue;
      const la = Number(a.layer || 0);
      const lb = Number(b.layer || 0);
      if (la !== lb && (a.bridge === 'yes' || b.bridge === 'yes')) {
        layerMismatch.push({ a, b });
        if (layerMismatch.length >= 6) break;
      }
    }
    if (layerMismatch.length >= 6) break;
  }
  for (const { a, b } of layerMismatch) {
    cases.push({
      control_id: `grade_sep_${a.osm_id}_${b.osm_id}`,
      category: 'bridge_layer',
      from_osm_id: a.osm_id,
      to_osm_id: b.osm_id,
      expect_reject: true,
    });
  }

  const oneWays = ways.filter((w) => w.oneway === 'yes');
  for (const w of oneWays.slice(0, 6)) {
    const parallel = oneWays.find(
      (p) => p.osm_id !== w.osm_id && p.name && w.name && p.name === w.name
    );
    if (parallel) {
      cases.push({
        control_id: `parallel_oneway_${w.osm_id}_${parallel.osm_id}`,
        category: 'parallel_one_way',
        from_osm_id: w.osm_id,
        to_osm_id: parallel.osm_id,
        expect_reject: true,
      });
    }
  }

  const namedBranches = new Map();
  for (const w of ways) {
    if (!w.name) continue;
    if (!namedBranches.has(w.name)) namedBranches.set(w.name, []);
    namedBranches.get(w.name).push(w);
  }
  for (const [name, group] of namedBranches) {
    if (group.length < 3) continue;
    let added = false;
    for (const a of group) {
      for (const b of group) {
        if (a.osm_id === b.osm_id) continue;
        const exit = exitEndpointForTransition(a, b);
        if (exit.distance_m <= 1) {
          cases.push({
            control_id: `same_name_branch_${a.osm_id}_${b.osm_id}`,
            category: 'same_name_branch',
            from_osm_id: a.osm_id,
            to_osm_id: b.osm_id,
            expect_reject: true,
          });
          added = true;
          break;
        }
      }
      if (added) break;
    }
    if (cases.filter((c) => c.category === 'same_name_branch').length >= 4) break;
  }

  const laneChange = [];
  for (const a of ways) {
    const b = ways.find(
      (x) => x.osm_id !== a.osm_id && a.lanes && x.lanes && a.lanes !== x.lanes && a.name && a.name === x.name
    );
    if (b) laneChange.push({ a, b });
    if (laneChange.length >= 4) break;
  }
  for (const { a, b } of laneChange) {
    cases.push({
      control_id: `lane_change_${a.osm_id}_${b.osm_id}`,
      category: 'lane_count_change',
      from_osm_id: a.osm_id,
      to_osm_id: b.osm_id,
      expect_reject: true,
    });
  }

  const unnamed = ways.filter((w) => !w.name && !w.ref && w.highway === 'residential');
  for (const w of unnamed.slice(0, 3)) {
    const n = unnamed.find((x) => x.osm_id !== w.osm_id);
    if (n) {
      cases.push({
        control_id: `unnamed_local_${w.osm_id}_${n.osm_id}`,
        category: 'unnamed_local',
        from_osm_id: w.osm_id,
        to_osm_id: n.osm_id,
        expect_reject: false,
      });
    }
  }

  return cases;
}

export function evaluateSafetyControls(cases, wayStore, params) {
  const results = [];
  let unsafeJoins = 0;
  for (const c of cases) {
    const verdict = classifyOsmWayTransition(c.from_osm_id, c.to_osm_id, wayStore, params);
    const joined = verdict.classification === 'safe_unique_continuation';
    const failed = c.expect_reject && joined;
    if (failed) unsafeJoins += 1;
    results.push({
      control_id: c.control_id,
      category: c.category,
      from_osm_id: c.from_osm_id,
      to_osm_id: c.to_osm_id,
      expect_reject: c.expect_reject,
      classification: verdict.classification,
      joined,
      passed: !failed,
      reasons: verdict.reasons,
    });
  }
  return { results, unsafe_joins: unsafeJoins, all_passed: unsafeJoins === 0 };
}
