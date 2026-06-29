#!/usr/bin/env bash
# DinoClaw Linux / Steam Deck release builder (mirrors build.bat)

set -euo pipefail

cd "$(dirname "$0")"

echo
echo "  ===================================="
echo "    DinoClaw - Build Linux AppImage"
echo "  ===================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed or not in PATH."
  echo "        Install Node 20+ (Steam Deck: sudo pacman -S nodejs npm)"
  echo
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[SETUP] Installing dependencies..."
  echo
  npm install
  echo
fi

echo "[ICONS] Generating app icons from public/dino.svg..."
npm run icons

echo
echo "[BUILD] Compiling TypeScript + Vite..."
npm run build

echo
echo "[PACK]  Packaging AppImage with electron-builder..."
npx electron-builder --linux

echo
echo "  ===================================="
echo "    BUILD COMPLETE"
echo "    Output: release/"
echo "  ===================================="
echo
echo "  Install locally:"
echo "    ./install.sh --file release/DinoClaw-*-linux-*.AppImage --launch"
echo

ls -lh release/*.AppImage 2>/dev/null || ls -lh release/
