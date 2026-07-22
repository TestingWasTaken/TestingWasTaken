#!/bin/bash
set -o pipefail
cd "$(dirname "$0")" || exit 1
LOG="$HOME/Desktop/relay-start-log.txt"
{
  echo "=== Relay Browser 0.7 ==="
  date
  echo "Folder: $(pwd)"
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is not installed. Install it from nodejs.org, then reopen this file."
    exit 1
  fi
  echo "Node: $(node --version)"
  echo "npm: $(npm --version)"
  if [ ! -d node_modules/electron ]; then
    echo "Installing Electron..."
    npm install --registry=https://registry.npmjs.org/ --no-package-lock
  fi
  echo "Checking Relay source..."
  npm run check
  echo "Starting Relay..."
  npm start
} 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
if [ "$STATUS" -ne 0 ]; then
  echo
  echo "Relay stopped with an error. Log saved to: $LOG"
  read -r -p "Press Return to close..." _
fi
exit "$STATUS"
