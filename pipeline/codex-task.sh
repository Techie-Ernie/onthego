#!/usr/bin/env bash
# Run a free-form Codex task from a prompt file.  Usage: pipeline/codex-task.sh <prompt.md> <name>
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p pipeline/cache/codex/logs
codex exec -s workspace-write --ephemeral -C "$PWD" -o "pipeline/cache/codex/logs/$2.last.txt" "$(cat "$1")" < /dev/null > "pipeline/cache/codex/logs/$2.log" 2>&1
echo "$2 done"; tail -c 1500 "pipeline/cache/codex/logs/$2.last.txt"
