#!/usr/bin/env bash
# Wait until Codex accepts requests again, then run every pending batch.  Usage: pipeline/codex-resume.sh [N] [prefix]
cd "$(dirname "$0")/.."
until out=$(codex exec --ephemeral -s read-only "Reply with the single word OK." < /dev/null 2>&1) && ! grep -q "usage limit" <<<"$out"; do
  echo "$(date +%H:%M) codex still limited; retrying in 10 min"; sleep 600
done
echo "$(date +%H:%M) codex available; starting"
for d in pipeline/cache/agent-kb/${2:-gk}-*/; do [ -s "data/agent-output/$(basename $d).json" ] || rm -f "$d/.claimed"; done
pipeline/codex-all.sh "${1:-16}" "${2:-gk}"
