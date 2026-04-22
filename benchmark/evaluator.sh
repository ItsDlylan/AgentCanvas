#!/usr/bin/env bash
# AgentCanvas Benchmark Tile evaluator for src/main/markdown-to-tiptap.ts.
#
# Prints `SCORE=<ns_per_char>` on success; a huge score (999999) on correctness
# failure or build error. Lower is better (set higherIsBetter=false on the tile).
set -e
cd "$(dirname "$0")/.."
exec node benchmark/bench.mjs
