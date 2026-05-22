#!/usr/bin/env bash
# Run the full Termbook test suite. Assumes both servers are already
# running (see scripts/restart_servers.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
npm run test:all
