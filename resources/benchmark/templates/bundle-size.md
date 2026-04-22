## Template: bundle-size

### What the evaluator measures

Total compressed (gzip) byte size of the frontend bundle, measured against a
specific build output directory (usually `dist/` or `out/renderer/`).

### Required files

- `benchmark/evaluator.sh`    — entrypoint, runs build + sizes dist, prints `SCORE=<bytes>`
- `benchmark/bench.mjs`       — the sizing logic (or inline in evaluator.sh if trivial)
- `benchmark/golden.json`     — SHA-256 of canonical HTML output for a smoke route (proves bundle still renders)

### Fresh-input-per-call rule

Not applicable in the traditional sense — there's no per-call input. BUT
each measurement MUST rebuild from clean state to avoid cached artifacts:

```bash
rm -rf dist/ .vite/ node_modules/.cache/
npm run build
```

Otherwise agent can tamper with cache to win size.

### Correctness gate

After build:
1. Render the primary route server-side (or extract its HTML from the build
   output).
2. SHA-256 the canonical output.
3. Compare to `benchmark/golden.json`.
4. If mismatch → `SCORE=999999`. This catches agents that win size by
   removing functionality.

Also: if the build exits non-zero → `SCORE=999999`.

### Measurement shape

- Build once per iteration (no warmup — builds are expensive).
- Walk `dist/**/*.{js,css,html}`, gzip each file, sum compressed bytes.
- Report `SCORE=<total_gzip_bytes>`.
- `higher_is_better: false`.

### Environment

No special env. Runs `npm run build` (or the project's build command —
detect from `package.json` scripts).

### Notes

- Avoid measuring `.map` files, source-map assets, or dev-only chunks.
- Dynamic imports / lazy chunks ARE counted (they're shipped to users).
- If the project has multiple build targets, measure only the renderer
  bundle (the one shipped to browsers), not the Node/Electron side.
