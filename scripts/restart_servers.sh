#!/usr/bin/env bash
set -euo pipefail
TMUX_BE=${TMUX_BE:-tb-be}
TMUX_FE=${TMUX_FE:-tb-fe}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

tmux kill-session -t "$TMUX_BE" 2>/dev/null || true
tmux kill-session -t "$TMUX_FE" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
rm -f "$ROOT"/backend/termbook_bashrc_* 2>/dev/null || true

sleep 1
tmux new-session -d -s "$TMUX_BE" -c "$ROOT/backend" "node server.js 2>&1 | tee /tmp/termbook-backend.log"
tmux new-session -d -s "$TMUX_FE" -c "$ROOT/frontend" "npm run dev 2>&1 | tee /tmp/termbook-frontend.log"
sleep 4
if lsof -ti:4000 >/dev/null && lsof -ti:4001 >/dev/null; then
  echo "OK servers up"
else
  echo "FAIL servers not up:"
  echo "BE log:"; tail -5 /tmp/termbook-backend.log
  echo "FE log:"; tail -5 /tmp/termbook-frontend.log
  exit 1
fi
