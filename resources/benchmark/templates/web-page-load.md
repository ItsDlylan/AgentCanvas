## Template: web-page-load

### What the evaluator measures

One of: **LCP** (Largest Contentful Paint, ms), **TTI** (Time To Interactive,
ms), or **FCP** (First Contentful Paint, ms) for a target URL. Use LCP by
default unless the acceptance criterion names a different metric.

### Required files

- `benchmark/evaluator.sh`    — entrypoint, prints `SCORE=<ms>` on final line
- `benchmark/bench.mjs`       — Node ESM measurement runner (CDP client)
- `benchmark/golden.json`     — not applicable for web; write `{ "mode": "web-perf" }`

### Fresh-input-per-call rule

Each page load MUST bust caches. Append a unique query string every iteration:

```js
const url = `${TARGET_URL}?_bench=${Date.now()}-${i}`
```

Also disable HTTP cache via CDP before each load:
```js
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
```

### Correctness gate

Before measurement, verify the page responds and renders something. If the
page 404s, times out (>30s), or the DOM has no body content → `SCORE=999999`,
exit 0.

### Measurement shape

- Spawn a browser tile via:
  ```bash
  curl -s -X POST $AGENT_CANVAS_API/api/browser/open \
    -H 'Content-Type: application/json' \
    -d '{"url":"about:blank"}'
  ```
- Connect CDP: `ws://127.0.0.1:$AGENT_BROWSER_CDP_PORT/devtools/page/<sessionId>`
  (use `chrome-remote-interface` or raw `ws` — NOT puppeteer/playwright, to
  avoid bundling a second browser).
- Enable Performance domain: `Performance.enable`.
- For each of N iterations (N=5 warmup + 10 measurement):
  1. Navigate to fresh URL.
  2. Wait for `Page.loadEventFired`.
  3. Call `Runtime.evaluate` with `JSON.stringify(performance.getEntriesByType('largest-contentful-paint'))`.
  4. Extract the LCP time.
- Report median of measurement samples as `SCORE=<ms>`.
- `higher_is_better: false`.

### Environment

- `$AGENT_CANVAS_API` — HTTP base for spawning browser tiles (pre-set by AgentCanvas).
- `$AGENT_BROWSER_CDP_PORT` — CDP port bound to the spawned browser tile (pre-set).

Both are populated automatically on any terminal launched inside AgentCanvas.
The benchmark runner terminal inherits them, so the evaluator can use them
directly.

### Example skeleton (bench.mjs)

```js
import WebSocket from 'ws'
const CDP = `ws://127.0.0.1:${process.env.AGENT_BROWSER_CDP_PORT}/devtools/page/main`
// ... connect, drive navigation, pull LCP, emit SCORE=
```
