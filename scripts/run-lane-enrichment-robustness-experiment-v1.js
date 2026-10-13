#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { runFullExperiment } from '../src/lib/lane-enrichment-robustness-experiment/scenarios.js';
import { runScenarioPipeline } from '../src/lib/lane-enrichment-robustness-experiment/run-pipeline.js';
import { EXPERIMENT_SEED } from '../src/lib/lane-enrichment-robustness-experiment/seeded-rng.js';
import { DECISION, DECISION_SCORE_DISCLAIMER } from '../src/lib/lane-enrichment-algorithm-core/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_robustness_experiment_v1');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function summarizeAnswers(rows) {
  const singleOk = rows.filter((r) => r.scenario_id === 'A_one_clean_frame' && r.classification !== 'incorrect');
  const multiOk = rows.filter(
    (r) =>
      r.scenario_id === 'B_three_clean_frames' &&
      r.algorithm_decision === DECISION.MULTI_FRAME_REVIEW_CANDIDATE &&
      r.classification === 'correct'
  );
  const insufficientNoise = rows.filter(
    (r) =>
      ['F_conflicting_frame_groups', 'G_high_noise'].includes(r.scenario_id) &&
      r.classification === 'insufficient'
  );
  const incorrect = rows.filter((r) => r.classification === 'incorrect');
  return {
    one_clean_cross_section_sufficient_when:
      'V3.1 logic: one strict high-quality frame (scenario A) yields single_frame_review_candidate with confidence_band provisional_single_frame (decision_score is an internal heuristic, not a probability). Three agreeing clean frames (B) yield supported_multi_frame.',
    more_frames_improve_confidence_when:
      'Agreeing multi-frame support (B) uses confidence_band supported_multi_frame with higher decision_score than single-frame provisional band; bands describe evidence class, not accuracy.',
    more_conflicting_noise_causes_insufficient_when:
      'Strong competing lane-count groups (F) return insufficient_or_conflicting. High noise (G) or missing edges (E) also abstain.',
    decision_explanation:
      'One high-quality cross-section can create a review candidate. Multiple observations improve confidence only when they agree. Strong competing high-quality interpretations cause the algorithm to abstain.',
    decision_score_disclaimer: DECISION_SCORE_DISCLAIMER,
    confident_wrong_lane_count_emitted: incorrect.length > 0,
    incorrect_rows: incorrect,
    scenario_A_no_incorrect_count: singleOk.length,
    multi_ok_count: multiOk.length,
    insufficient_noise_count: insufficientNoise.length,
  };
}

function matrixMarkdown(rows) {
  const header =
    '| Lanes | Scenario | True | Frames | Valid | Rejected | Outlier | Decision | Selected | decision_score | confidence_band | Class |';
  const sep =
    '|------:|----------|-----:|-------:|------:|---------:|---------|----------|----------:|---------------:|-----------------|-------|';
  const lines = rows.map((r) => {
    const dec = r.algorithm_decision ?? r.contract_outcome ?? '—';
    return `| ${r.lane_configuration} | ${r.scenario_id} | ${r.true_lane_count} | ${r.frame_count} | ${r.valid_frame_count} | ${r.rejected_frame_count} | ${r.outlier_type} | ${dec} | ${r.selected_lane_count ?? 'null'} | ${r.decision_score ?? '—'} | ${r.confidence_band ?? '—'} | ${r.classification} |`;
  });
  return `${header}\n${sep}\n${lines.join('\n')}`;
}

function main() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const { rows, anyIncorrect } = runFullExperiment(runScenarioPipeline);
  const answers = summarizeAnswers(rows);

  writeJson(path.join(REPORT_DIR, 'scenario_results.json'), {
    schema: 'pintaz.lane-enrichment-robustness.v1',
    seed: EXPERIMENT_SEED,
    disclaimer:
      'Synthetic ordered polylines only. Does not prove Maps Read or real-road accuracy.',
    decision_score_disclaimer: DECISION_SCORE_DISCLAIMER,
    any_incorrect_lane_count: anyIncorrect,
    rows,
    summary_answers: answers,
  });

  writeText(
    path.join(REPORT_DIR, 'EXPERIMENT_MATRIX.md'),
    `# Robustness experiment matrix

Seed: \`${EXPERIMENT_SEED}\` (deterministic)

${matrixMarkdown(rows)}

## Score semantics (V3.2)

${DECISION_SCORE_DISCLAIMER}

## Summary answers

1. **One clean cross-section sufficient?** ${answers.one_clean_cross_section_sufficient_when}
2. **More agreeing frames?** ${answers.more_frames_improve_confidence_when}
3. **Conflicting/noisy → insufficient?** ${answers.more_conflicting_noise_causes_insufficient_when}
4. **Confident wrong count?** ${answers.confident_wrong_lane_count_emitted ? '**YES (see incorrect_rows)**' : '**No** incorrect classifications in this synthetic run.'}

> ${answers.decision_explanation}
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment robustness experiment V1 (core V3.2)

Synthetic ordered-polyline input only (contract → core). **Does not validate Maps Read point-only GeoJSON or real roads.**

- Seed: \`${EXPERIMENT_SEED}\`
- Scenarios: A–H × lane counts 1, 2, 3
- Incorrect lane-count candidates: **${anyIncorrect}**

${answers.decision_explanation}

## Result semantics

${DECISION_SCORE_DISCLAIMER}

HEAD: \`${head}\` (\`${branch}\`)

See \`EXPERIMENT_MATRIX.md\` and \`scenario_results.json\`.
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    protected_hashes_ok: protected_hashes.ok === true,
    head,
    branch,
    seed: EXPERIMENT_SEED,
    any_incorrect_lane_count: anyIncorrect,
    real_data_used: false,
    decision_score_disclaimer: DECISION_SCORE_DISCLAIMER,
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-lane-enrichment-robustness-experiment-v1.js
npm test
`
  );

  console.log('anyIncorrect', anyIncorrect);
  console.log('Wrote', REPORT_DIR);
}

main();
