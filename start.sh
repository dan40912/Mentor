#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Mentor needs Node.js 20 or later. Install it from https://nodejs.org/en/download/ and run start.sh again."
  exit 1
fi
if ! node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'; then
  echo "Mentor needs Node.js 20 or later. Current version: $(node --version)"
  echo "Install a current version from https://nodejs.org/en/download/"
  exit 1
fi

if command -v open >/dev/null 2>&1; then
  (sleep 2; open http://127.0.0.1:4317) >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 2; xdg-open http://127.0.0.1:4317) >/dev/null 2>&1 &
else
  echo "Open http://127.0.0.1:4317 in your browser."
fi
node src/server.js
