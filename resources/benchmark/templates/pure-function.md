## Template: pure-function

### What the evaluator measures

Throughput (ns/op or ms/op) of a specific hot function — parser, compiler pass,
algorithm, transformer. The function is called in a tight loop with a fresh
input per call; measured wall-clock is divided by iterations.

### Required files

- `benchmark/evaluator.sh`    — entrypoint, prints `SCORE=<ns_per_op>` on final line
- `benchmark/bench.mjs`       — Node ESM measurement runner
- `benchmark/corpus.md`       — diverse workload (real-looking inputs)
- `benchmark/golden.json`     — SHA-256 of canonical output for a fixed reference input

### Fresh-input-per-call rule

Each call inside the measurement loop MUST receive a unique input. Generate a
per-iteration suffix, counter, or random prefix. Any input-keyed memoize
becomes a 0% cache hit and cannot produce a fake speedup.

```js
function makeInput(i) {
  return `${corpus}\n<!-- iter-${i} -->\n`
}
```

### Correctness gate

BEFORE measurement starts:
1. Run target against a fixed reference input (same every time).
2. SHA-256 the canonical output.
3. Compare to `benchmark/golden.json`.
4. If mismatch → `SCORE=999999`, exit 0.

This catches agents that win speed by silently breaking semantics.

### Measurement shape

- 500ms warmup (discarded).
- 2s measurement window.
- Divide elapsed ns by iteration count → `SCORE=<ns_per_op>`.
- `higher_is_better: false` (lower is faster).

### Environment

No special env required. Runs inside the worktree.

### Example reference

The repo's existing `markdown-to-tiptap` benchmark follows this template
exactly — use it as the canonical implementation shape.
