import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { proposalDecisionsPath } from './comparison-paths.js';
import { isActionableProposal } from './comparison-ui-groups.js';

const VALID = new Set(['pending', 'accepted', 'rejected']);

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadProposalDecisions() {
  const p = proposalDecisionsPath();
  if (!fs.existsSync(p)) {
    return { schema: 'pintaz.comparison.proposal-decisions', version: 1, decisions: {}, history: [] };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function applyProposalDecision({ proposalId, newState, geometryHash, osmBaselineHash }) {
  if (!VALID.has(newState)) throw new Error('Invalid proposal state');
  const store = loadProposalDecisions();
  const prev = store.decisions[proposalId]?.state ?? 'pending';
  store.decisions[proposalId] = {
    state: newState,
    updated_at: new Date().toISOString(),
    geometry_hash: geometryHash,
    osm_baseline_hash: osmBaselineHash,
  };
  store.history.push({
    at: new Date().toISOString(),
    proposal_id: proposalId,
    previous_state: prev,
    new_state: newState,
    geometry_hash: geometryHash,
    osm_baseline_hash: osmBaselineHash,
  });
  atomicWriteJson(proposalDecisionsPath(), store);
  return store.decisions[proposalId];
}

export function resetAllProposalDecisions() {
  const store = loadProposalDecisions();
  for (const id of Object.keys(store.decisions)) {
    const prev = store.decisions[id].state;
    store.decisions[id] = { ...store.decisions[id], state: 'pending' };
    store.history.push({
      at: new Date().toISOString(),
      proposal_id: id,
      previous_state: prev,
      new_state: 'pending',
    });
  }
  atomicWriteJson(proposalDecisionsPath(), store);
  return store;
}

/** Remove decisions stored for verified or diagnostic sections only. */
export function cleanupInvalidProposalDecisions(sectionFeatures) {
  const store = loadProposalDecisions();
  const removed = [];
  for (const id of Object.keys(store.decisions)) {
    const feature = sectionFeatures.find((f) => f.properties?.proposal_id === id);
    const classification = feature?.properties?.classification;
    if (!feature || !isActionableProposal(classification)) {
      removed.push({ proposal_id: id, previous_state: store.decisions[id].state });
      delete store.decisions[id];
    }
  }
  if (removed.length) {
    store.history.push({
      at: new Date().toISOString(),
      event: 'cleanup_invalid_decisions',
      removed,
    });
    atomicWriteJson(proposalDecisionsPath(), store);
  }
  return { removed, store };
}

export function osmFeatureHashFromProps(osmId, roadsGeojson) {
  const f = roadsGeojson.features.find((x) => String(x.properties?.osm_id) === String(osmId));
  if (!f) return null;
  return createHash('sha256').update(JSON.stringify(f.geometry)).digest('hex');
}
