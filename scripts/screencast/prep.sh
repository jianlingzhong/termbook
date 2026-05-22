#!/usr/bin/env bash
# Prepares a throwaway /tmp/termbook-demo directory with safe contents
# for the screencast to work in. Nothing from the user's actual
# filesystem is shown in the recording.
#
# Usage: bash scripts/screencast/prep.sh

set -euo pipefail

D=/tmp/termbook-demo
rm -rf "$D"
mkdir -p "$D"
cd "$D"

git init -q -b main
git config user.email demo@termbook.local
git config user.name "Termbook Demo"

cat > README.md <<'EOF'
# Termbook Demo Workspace

A throwaway directory for showing what Termbook can do.

Termbook turns your terminal into a notebook: every command is a cell
with its own scrollable output, exit code, and timestamp. TUIs like
vim run in a clean modal. SSH sessions stay isolated per host.

Try:
- `ls -la`
- `vim notes.md`
- `find . -type f`
EOF

cat > main.py <<'EOF'
"""Tiny demo script for the Termbook screencast."""

def greet(name: str) -> str:
    return f"Hello, {name}! Welcome to Termbook."


if __name__ == "__main__":
    print(greet("world"))
EOF

git add -A && git commit -q -m "initial: demo workspace"

echo "  - run \`python3 main.py\` to see Termbook capture output as a cell" >> README.md
git add -A && git commit -q -m "docs: mention python demo"

echo "" >> main.py
echo "# TODO: add tests" >> main.py
git add -A && git commit -q -m "wip: note about tests"

echo "[prep] demo workspace ready at $D"
git --no-pager log --oneline
