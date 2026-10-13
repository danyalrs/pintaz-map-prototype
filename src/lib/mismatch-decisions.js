import fs from 'node:fs';
import path from 'node:path';
import { mismatchDecisionStatePath } from './mismatch-paths.js';
import { isActionableMismatch } from './mismatch-ui-groups.js';

const VALID = new Set(['pending', 'accepted', 'rejected']);

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadMismatchDecisions() {
  const p = mismatchDecisionStatePath();
  if (!fs.existsSync(p)) {
    return { schema: 'pintaz.mismatch.decision-state', version: 1, decisions: {}, history: [] };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function applyMismatchDecision({ candidateId, newState, sectionHash, osmBaselineHash }) {
  if (!VALID.has(newState)) throw new Error('Invalid candidate state');
  const store = loadMismatchDecisions();
  const prev = store.decisions[candidateId]?.state ?? 'pending';
  store.decisions[candidateId] = {
    state: newState,
    updated_at: new Date().toISOString(),
    section_hash: sectionHash,
    osm_baseline_hash: osmBaselineHash,
  };
  store.history.push({
    at: new Date().toISOString(),
    candidate_id: candidateId,
    previous_state: prev,
    new_state: newState,
    section_hash: sectionHash,
    osm_baseline_hash: osmBaselineHash,
  });
  atomicWriteJson(mismatchDecisionStatePath(), store);
  return store.decisions[candidateId];
}

export function resetMismatchDecisions() {
  const store = loadMismatchDecisions();
  for (const id of Object.keys(store.decisions)) {
    const prev = store.decisions[id].state;
    store.decisions[id] = { ...store.decisions[id], state: 'pending' };
    store.history.push({
      at: new Date().toISOString(),
      candidate_id: id,
      previous_state: prev,
      new_state: 'pending',
    });
  }
  atomicWriteJson(mismatchDecisionStatePath(), store);
  return store;
}

export function cleanupInvalidMismatchDecisions(sectionFeatures) {
  const store = loadMismatchDecisions();
  const removed = [];
  for (const id of Object.keys(store.decisions)) {
    const feature = sectionFeatures.find((f) => f.properties?.candidate_id === id);
    const classification = feature?.properties?.classification;
    if (!feature || !isActionableMismatch(classification)) {
      removed.push({ candidate_id: id, previous_state: store.decisions[id].state });
      delete store.decisions[id];
    }
  }
  if (removed.length) {
    store.history.push({ at: new Date().toISOString(), event: 'cleanup_invalid_decisions', removed });
    atomicWriteJson(mismatchDecisionStatePath(), store);
  }
  return { removed, store };
}
