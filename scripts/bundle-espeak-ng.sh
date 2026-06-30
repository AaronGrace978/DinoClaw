#!/usr/bin/env bash
# Bundle espeak-ng + shared libs for the Linux AppImage so Steam Deck users
# never need "sudo pacman -S espeak-ng" (SteamOS root is read-only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/espeak-ng"
BIN_OUT="$OUT/bin"
LIB_OUT="$OUT/lib"
MARKER="$BIN_OUT/espeak-ng"

if [[ -f "$MARKER" ]]; then
  echo "[espeak] Already bundled at $OUT"
  exit 0
fi

if ! command -v espeak-ng >/dev/null 2>&1; then
  echo "[espeak] Installing espeak-ng for bundling..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq espeak-ng
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm espeak-ng
  else
    echo "[espeak] ERROR: install espeak-ng on this build machine first."
    exit 1
  fi
fi

ESPEAK_BIN="$(command -v espeak-ng)"
mkdir -p "$BIN_OUT" "$LIB_OUT"
cp -f "$ESPEAK_BIN" "$MARKER"
chmod +x "$MARKER"

echo "[espeak] Copying shared libraries for $ESPEAK_BIN"
while IFS= read -r lib; do
  [[ -n "$lib" && -f "$lib" ]] || continue
  cp -Lf "$lib" "$LIB_OUT/" 2>/dev/null || cp -f "$lib" "$LIB_OUT/" 2>/dev/null || true
done < <(ldd "$ESPEAK_BIN" | awk '/=> \// {print $3}')

echo "[espeak] Bundle complete: $OUT"
