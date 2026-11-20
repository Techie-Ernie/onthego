#!/usr/bin/env bash
# Run every key-based batch that has no output yet through Codex, N at a time.  Usage: pipeline/codex-all.sh [N] [prefix]
cd "$(dirname "$0")/.."
N="${1:-4}"; P="${2:-kb}"
todo=()
for d in pipeline/cache/agent-kb/$P-*/; do b=$(basename "$d"); [ -s "data/agent-output/$b.json" ] || todo+=("$b"); done
echo "${#todo[@]} batches: ${todo[*]}"
printf '%s\n' "${todo[@]}" | xargs -P "$N" -I{} bash -c 'pipeline/codex-batch.sh {} || echo "{} FAILED"'
