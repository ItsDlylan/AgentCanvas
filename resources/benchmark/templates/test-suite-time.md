## Template: test-suite-time

### What the evaluator measures

Wall-clock seconds to run the project's test suite (or a specified subset).

### Required files

- `benchmark/evaluator.sh`    — entrypoint, times test run, prints `SCORE=<seconds>`
- `benchmark/bench.sh`        — optional wrapper if test command needs setup
- `benchmark/golden.json`     — number of tests that MUST pass (agent can't win by skipping tests)

### Fresh-input-per-call rule

Each run MUST start from clean state. Before each measurement:

```bash
rm -rf node_modules/.cache .vite coverage/
```

Don't delete `node_modules/` itself (reinstalling would dominate the metric
and isn't what we're measuring). We measure the TEST execution, not install.

### Correctness gate

After the test run:
1. Parse the test runner's output (vitest/jest/mocha — detect from
   `package.json`).
2. Extract: `{ passed, failed, skipped, total }`.
3. Compare `total` (or `passed`) to `benchmark/golden.json`.
4. If `failed > 0` → `SCORE=999999` (agent broke a test).
5. If `passed < expectedPassed` → `SCORE=999999` (agent skipped tests to win).

### Measurement shape

- 1 warmup run (discarded — JIT, caches warming).
- 3 measurement runs, take the **median** (test runs are noisy).
- `time npm test` style: capture `real` seconds.
- Report `SCORE=<median_seconds>`.
- `higher_is_better: false`.

### Environment

No special env. Tests run with the project's default configuration.

### Notes

- Disable watch mode (`--run` for vitest, `--ci` for jest).
- Disable coverage instrumentation during measurement (it dominates the
  metric and we want raw test time). If coverage is required for
  correctness, do a separate coverage pass outside the timed window.
- If the suite is too large to run repeatedly (>10 min/run), narrow to a
  representative subset via path filter and document it in the README.
