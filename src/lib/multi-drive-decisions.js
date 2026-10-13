import fs from 'node:fs';
import path from 'node:path';
import { multiDriveDecisionStatePath } from './multi-drive-mismatch-paths.js';
import { isMultiDriveActionable } from './multi-drive-redact.js';

const VALID = new Set(['pending', 'accepted', 'rejected']);

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadMultiDriveDecisions(baseDir) {
  const p = multiDriveDecisionStatePath(baseDir);
  if (!fs.existsSync(p)) {
    return { schema: 'pintaz.multi-drive.decision-state', version: 1, decisions: {}, history: [] };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function ensureMultiDriveDecisionStore(baseDir) {
  const p = multiDriveDecisionStatePath(baseDir);
  if (!fs.existsSync(p)) {
    atomicWriteJson(p, {
      schema: 'pintaz.multi-drive.decision-state',
      version: 1,
      decisions: {},
      history: [],
    });
  }
}

export function applyMultiDriveDecision({ candidateId, newState, aggregateState, baseDir }) {
  if (!VALID.has(newState)) throw new Error('Invalid candidate state');
  if (!isMultiDriveActionable(aggregateState)) {
    throw new Error('This aggregate section is not an actionable multi-drive review candidate.');
  }
  const store = loadMultiDriveDecisions(baseDir);
  const prev = store.decisions[candidateId]?.state ?? 'pending';
  store.decisions[candidateId] = {
    state: newState,
    updated_at: new Date().toISOString(),
  };
  store.history.push({
    at: new Date().toISOString(),
    aggregate_id: candidateId,
    previous_state: prev,
    new_state: newState,
  });
  atomicWriteJson(multiDriveDecisionStatePath(baseDir), store);
  return store.decisions[candidateId];
}

export function resetMultiDriveDecisions(baseDir = null) {
  const store = loadMultiDriveDecisions(baseDir);
  for (const id of Object.keys(store.decisions)) {
    const prev = store.decisions[id].state;
    store.decisions[id] = { ...store.decisions[id], state: 'pending' };
    store.history.push({
      at: new Date().toISOString(),
      aggregate_id: id,
      previous_state: prev,
      new_state: 'pending',
    });
  }
  atomicWriteJson(multiDriveDecisionStatePath(baseDir), store);
  return store;
}
