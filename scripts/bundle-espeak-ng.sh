#!/usr/bin/env bash
# Bundle espeak-ng + shared libs for the Linux AppImage so Steam Deck users
# never need "sudo pacman -S espeak-ng" (SteamOS root is read-only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/espeak-ng"
BIN_OUT="$OUT/bin"
LIB_OUT="$OUT/lib"
DATA_OUT="$OUT/share/espeak-ng-data"
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

DATA_SRC=""
for candidate in \
  "/usr/share/espeak-ng-data" \
  "/usr/lib/$(uname -m)-linux-gnu/espeak-ng-data" \
  "/usr/lib/x86_64-linux-gnu/espeak-ng-data" \
  "/usr/lib/aarch64-linux-gnu/espeak-ng-data"; do
  if [[ -d "$candidate" ]]; then
    DATA_SRC="$candidate"
    break
  fi
done

if [[ -z "$DATA_SRC" ]] && command -v dpkg >/dev/null 2>&1; then
  DATA_SRC="$(dpkg -L espeak-ng-data 2>/dev/null | grep -E '/espeak-ng-data$' | head -n 1 || true)"
fi

if [[ -z "$DATA_SRC" || ! -d "$DATA_SRC" ]]; then
  echo "[espeak] ERROR: could not find espeak-ng-data directory."
  exit 1
fi

echo "[espeak] Copying voice data from $DATA_SRC"
rm -rf "$DATA_OUT"
mkdir -p "$(dirname "$DATA_OUT")"
cp -a "$DATA_SRC" "$DATA_OUT"

echo "[espeak] Bundle complete: $OUT"
