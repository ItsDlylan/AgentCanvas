## Template: api-latency

### What the evaluator measures

HTTP request latency (ms) against a specific endpoint. Report **p50** by
default, or p95 if the acceptance criterion asks for tail latency.

### Required files

- `benchmark/evaluator.sh`    — entrypoint, prints `SCORE=<ms>` on final line
- `benchmark/bench.mjs`       — Node ESM measurement runner
- `benchmark/corpus.json`     — list of request payloads (diverse)
- `benchmark/golden.json`     — SHA-256 of canonical response body for a fixed request

### Fresh-input-per-call rule

Each request MUST carry a unique payload field (or cache-buster query) so any
server-side response cache is a 0% hit. Example:

```js
const payload = { ...template, _nonce: `${Date.now()}-${i}` }
```

### Correctness gate

Before the measurement window:
1. Fire one request with a fixed reference payload.
2. SHA-256 the response body (canonicalized: sorted keys, no `_nonce`).
3. Compare to `benchmark/golden.json`.
4. If mismatch or HTTP 5xx → `SCORE=999999`, exit 0.

### Measurement shape

- 20 warmup requests (discarded).
- 100 measurement requests, sequential (not parallel — isolate per-request
  latency, not throughput).
- Time each with `performance.now()`.
- Sort, report `p50` (or `p95`) as `SCORE=<ms>`.
- `higher_is_better: false`.

### Environment

- Base URL: hard-coded in bench.mjs or read from `process.env.BENCH_URL`.
- If target is an internal service, the runner terminal must be able to reach
  it (no additional env injection from AgentCanvas).

### Notes

- Do NOT use `fetch` keep-alive unless the acceptance criterion explicitly
  measures keep-alive performance. Use `undici` with `connections: 1` for
  clean per-request timing.
- For HTTPS targets, tolerate self-signed certs only if the target is local.
