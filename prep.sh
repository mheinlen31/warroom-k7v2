#!/bin/bash
# Refresh the War Room's player pool (projections, values, consensus) and
# publish. Run any time before the draft; the live room does the rest.
set -e
cd "$(dirname "$0")"
echo "==> pulling ESPN pool with projections"
python3 build_players.py
echo "==> cache-busting"
STAMP=$(date +%Y%m%d%H%M)
sed -i '' -E "s/(css\/guide\.css|js\/[a-z]+\.js)\?v=[A-Za-z0-9]+/\1?v=$STAMP/g" index.html
git add -A
if git diff --cached --quiet; then echo "   nothing changed"; else
  git commit -q -m "Refresh player pool $(date +%Y-%m-%d)" && git push -q && echo "   pushed"; fi
