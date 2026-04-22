// Prompt builder for the harness-design agent session. The agent is spawned
// inside an isolated git worktree and its single job is to produce a working
// benchmark/evaluator.sh + bench runner + corpus + golden snapshot for the
// task's acceptance criterion.

export interface HarnessDesignInput {
  taskLabel: string
  acceptanceCriteria: string
  targetFiles: string[]
  noiseClass: 'low' | 'medium' | 'high'
  higherIsBetter: boolean
}

export function buildHarnessDesignPrompt(input: HarnessDesignInput): string {
  const direction = input.higherIsBetter ? 'higher is better' : 'lower is better'
  const targets = input.targetFiles.length > 0
    ? input.targetFiles.map((f) => `  - \`${f}\``).join('\n')
    : '  (none declared — pick the single file most directly responsible for the measured behavior)'
  return [
    `# You are designing a benchmark harness.`,
    ``,
    `You are inside an isolated git worktree. Your ONLY job is to produce a working benchmark harness for the acceptance criterion below, commit it, and exit. You will NOT run the optimization loop — that's a separate agent that runs after you're done.`,
    ``,
    `## Acceptance criterion (what "good" looks like)`,
    input.acceptanceCriteria,
    ``,
    `## Target files (what will be optimized)`,
    targets,
    ``,
    `## Noise class: \`${input.noiseClass}\``,
    `## Direction: \`${direction}\``,
    ``,
    `## Deliverables`,
    `Produce these files, then commit everything on the current branch with message \`harness: initial design\`:`,
    ``,
    `1. **\`benchmark/evaluator.sh\`** (executable via \`chmod +x\`) — the single entrypoint. Prints \`SCORE=<number>\` on its final line on success, or \`SCORE=999999\` on any correctness / build failure. Never errors out unless the bench script itself can't even start. Usually this is a one-liner that delegates to:`,
    ``,
    `2. **\`benchmark/bench.{mjs,sh,py}\`** — the actual measurement. The LANGUAGE is up to you based on what the target file is written in. Minimum requirements:`,
    `   - **Fresh input per call.** Never feed the same string / payload / input twice in a measurement loop. Any input-keyed cache would trivially win and produce fake scores. Generate a unique suffix, counter, or random prefix on every call. This is non-negotiable.`,
    `   - **Correctness gate BEFORE measurement.** Produce canonical output for a fixed reference input, SHA-256 hash it, compare against \`benchmark/golden.json\`. If the hash mismatches, print \`SCORE=999999\` and exit 0 (do not throw). This catches the agent breaking semantics in pursuit of speed.`,
    `   - **Bounded wall-clock budget** (e.g. 2s of measurement, after a 0.5s warmup). Emit \`SCORE=\` as the final line with the measurement (ns/op, ms/op, whatever makes sense for the metric).`,
    `   - **Measure exactly the thing the acceptance criterion names.** Don't add unrelated microbenchmarks.`,
    ``,
    `3. **\`benchmark/corpus.{md,json,...}\`** — a workload that reflects real usage. Diverse enough that optimizations must be real.`,
    ``,
    `4. **\`benchmark/golden.json\`** — run your bench once with \`--record\` (or equivalent) to generate. Contains the SHA-256 of the canonical output for the reference input. Committed.`,
    ``,
    `5. **Baseline measurement run in your console.** Run \`./benchmark/evaluator.sh\` 3–5 times. Report the numbers at the end of your work so the human knows what they're looking at.`,
    ``,
    `## Rules`,
    `- **Do NOT modify the target files** listed above. The harness measures them as-is. The optimization loop will edit them later.`,
    `- **Do not import from \`node_modules/electron\`** or anything electron-specific. If the target file has electron imports, use esbuild to bundle it into a plain node ESM module before importing in bench.mjs (see this repo's existing pattern for an example if one exists).`,
    `- **Commit with the literal message** \`harness: initial design\`. This is how the next stage detects you're done.`,
    `- **Write a short \`benchmark/README.md\`** summarizing: what the evaluator measures, what the corpus is, what baseline you observed, and how to run it manually.`,
    `- If any step blocks you (missing dependency, unclear target), commit your partial work with \`harness: WIP — <what's blocking>\` and write the question into the README.`,
    ``,
    `## When you're done`,
    `After \`git commit\`, print a summary:`,
    `  - baseline score across your sample runs`,
    `  - correctness hash you recorded`,
    `  - any caveats for the optimization loop agent`,
    `Then exit. The human will review the diff, then click "Harness as Benchmark" in the Task Tile to start the optimization loop.`
  ].join('\n')
}
