#!/usr/bin/env bash
# Run one key-based batch through the local Codex CLI.  Usage: pipeline/codex-batch.sh kb-14 [logdir]
set -euo pipefail
b="$1"; logdir="${2:-pipeline/cache/agent-kb/logs}"; mkdir -p "$logdir"
cd "$(dirname "$0")/.."
# done already (or taken by another worker): skip
if [ -s "data/agent-output/$b.json" ] || [ -e "pipeline/cache/agent-kb/$b/.claimed" ]; then echo "$b skip"; exit 0; fi
touch "pipeline/cache/agent-kb/$b/.claimed"
codex exec -s workspace-write --ephemeral -C "$PWD" -o "$logdir/$b.last.txt" \
  "Follow the instructions in pipeline/agent-instructions-key.md exactly, for batch \`$b\` (input: pipeline/cache/agent-kb/$b/batch.json). Look at every image with your image-viewing tool (view_image): the question PNGs and the answer-key page PNGs. Write the output JSON array to the \`output\` path in batch.json. Modify no other files and do not commit. End with the short report the instructions ask for." \
  < /dev/null > "$logdir/$b.log" 2>&1
node -e "const r=JSON.parse(require('fs').readFileSync('data/agent-output/$b.json','utf8'));console.log('$b', r.length, 'items')"
