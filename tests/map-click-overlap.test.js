import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveOverlappingClick,
  observationWinsOverDiagnostic,
} from '../src/lib/map-click-resolution.js';

test('overlapping hit: evidence ON selects observation over diagnostic', () => {
  const stage = resolveOverlappingClick({
    evidenceVisible: true,
    hasActionableMultiDriveCandidate: false,
    hasMultiDriveDiagnostic: false,
    hasActionableCandidate: false,
    hasObservation: true,
    hasDiagnostic: true,
  });
  assert.equal(stage, 'observation_when_evidence_on');
  assert.equal(observationWinsOverDiagnostic(true), true);
});

test('overlapping hit: evidence OFF selects diagnostic', () => {
  const stage = resolveOverlappingClick({
    evidenceVisible: false,
    hasActionableMultiDriveCandidate: false,
    hasMultiDriveDiagnostic: true,
    hasActionableCandidate: false,
    hasObservation: true,
    hasDiagnostic: true,
  });
  assert.equal(stage, 'multi_drive_diagnostic_or_consistent');
  assert.equal(observationWinsOverDiagnostic(false), false);
});

test('map-selection orders observation handler before non-candidate mismatch', () => {
  const src = fs.readFileSync(new URL('../src/public/map-selection.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('return function handleMapClick'), src.indexOf('return function handleMapClick') + 1200);
  const obs = block.indexOf('handleObservationEvidenceClick');
  const diag = block.indexOf('tryMismatchNonCandidateClick');
  assert.ok(obs >= 0 && diag > obs);
});
