# Lane baseline integrity guard

Multi-drive rebuild checks lane baseline via a **semantic SHA-256** of `bukit-bintang-imbi-lane-baseline-summary.json`, not the raw file bytes.

Excluded volatile field: `generated_at` (set on each `buildLaneBaselineForArea` run).

Implementation: `src/lib/lane-baseline-semantic-digest.js`, wired in `src/lib/multi-drive-rebuild-guard.js`.

Expected semantic digest: `PROTECTED_INPUT_SHA256.lane_baseline_summary` in `src/lib/multi-drive-mismatch-config.js`.

Full drift audit artifacts (ignored by git): `reports/lane_baseline_hash_drift_audit/`.
