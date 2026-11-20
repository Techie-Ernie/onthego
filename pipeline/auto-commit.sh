#!/usr/bin/env bash
# Periodic snapshot commits + push.  Usage: pipeline/auto-commit.sh [minutes=20] [max_hours=12]
# Commits only when something changed; .gitignore keeps PDFs, caches and .env* out. Never force-pushes.
cd "$(dirname "$0")/.."
every="${1:-20}"; end=$(( $(date +%s) + ${2:-12} * 3600 ))
while :; do
  if [ -n "$(git status --porcelain)" ]; then
    big=$(git ls-files -o -m --exclude-standard -z | xargs -0 -r du -k 2>/dev/null | awk '$1>50000{print $2}')
    if [ -n "$big" ]; then echo "$(date +%H:%M) skipped: file(s) over 50 MB: $big"
    else
      git add -A
      n=$(git diff --cached --name-only | wc -l)
      b=$(ls data/agent-output 2>/dev/null | grep -c '^gk-')
      pub=$(node -e 'const i=require("./data/bank/h2-physics/index.json");console.log(i.questions.filter(q=>q.status==="published").length)' 2>/dev/null)
      git commit -q -m "Auto-commit: ${n} files; ${pub:-?} questions published; ${b}/148 grail batches checked

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" && echo "$(date +%H:%M) committed ${n} files"
    fi
  fi
  if [ "$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)" != "0" ]; then
    git push -q origin main 2>&1 | tail -2 && echo "$(date +%H:%M) pushed"
  fi
  [ "$(date +%s)" -ge "$end" ] && break
  sleep $(( every * 60 ))
done
