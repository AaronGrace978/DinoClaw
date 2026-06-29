#!/usr/bin/env bash
# DinoClaw dev launcher — Linux / Steam Deck (mirrors launch.bat)

set -euo pipefail

cd "$(dirname "$0")"

echo
echo "  ===================================="
echo "    DinoClaw - Desktop AI Agent v0.4"
echo "  ===================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed or not in PATH."
  echo "        Install Node 20+ (Steam Deck: sudo pacman -S nodejs npm)"
  echo
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[SETUP] First run detected. Installing dependencies..."
  echo
  npm install
  echo
  echo "[SETUP] Dependencies installed successfully."
  echo
fi

# Stop a stale dev server if launch.sh was run again
if command -v fuser >/dev/null 2>&1; then
  fuser -k 5173/tcp >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  pid="$(lsof -ti :5173 2>/dev/null || true)"
  if [[ -n "$pid" ]]; then
    echo "[CLEANUP] Stopping stale process on port 5173 (PID $pid)..."
    kill "$pid" 2>/dev/null || true
  fi
fi

echo "[START] Launching DinoClaw..."
echo "        Wait ~5 seconds for the window to load."
echo "        Press Ctrl+C here to stop the app."
echo

npm run dev
