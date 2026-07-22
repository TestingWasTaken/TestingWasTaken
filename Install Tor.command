#!/bin/bash
set -o pipefail
LOG="$HOME/Desktop/relay-tor-install-log.txt"
{
  echo "=== Relay Tor installer ==="
  date
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required. Install Homebrew first, then run this file again."
    exit 1
  fi
  brew install tor
  echo
  echo "Tor is installed. Relay can launch it privately or reuse a Tor service on port 9050."
} 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
if [ "$STATUS" -ne 0 ]; then
  echo "Installation failed. Log saved to: $LOG"
fi
read -r -p "Press Return to close..." _
exit "$STATUS"
