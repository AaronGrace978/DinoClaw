#!/usr/bin/env bash
# DinoClaw Linux / Steam Deck installer
# Downloads the latest AppImage from GitHub Releases and sets up menu + CLI launchers.
#
# One-liner (after first release):
#   curl -fsSL https://raw.githubusercontent.com/AaronGrace978/DinoClaw/main/install.sh | bash
#
# Local AppImage:
#   ./install.sh --file release/DinoClaw-0.4.0-linux-x64.AppImage

set -euo pipefail

REPO="AaronGrace978/DinoClaw"
APP_NAME="DinoClaw"
VERSION=""
LOCAL_FILE=""
DO_UNINSTALL=false
DO_LAUNCH=false
DO_HELP=false

INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dinoclaw"
BIN_DIR="${XDG_BIN:-$HOME/.local/bin}"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"

APPIMAGE_NAME="DinoClaw.AppImage"
LAUNCHER_NAME="dinoclaw"
DESKTOP_ID="io.bostonai.dinoclaw.desktop"

usage() {
  cat <<'EOF'
DinoClaw installer — Linux & Steam Deck

Usage:
  install.sh [options]

Options:
  --version TAG     Install a specific release tag (e.g. v0.4.0). Default: latest.
  --file PATH       Install from a local .AppImage instead of downloading.
  --uninstall       Remove DinoClaw from this user account.
  --launch          Start DinoClaw after installing.
  -h, --help        Show this help.

Examples:
  curl -fsSL https://raw.githubusercontent.com/AaronGrace978/DinoClaw/main/install.sh | bash
  ./install.sh --file release/DinoClaw-0.4.0-linux-x64.AppImage --launch

Steam Deck: switch to Desktop Mode, open Konsole, paste the curl command above.
After install, find DinoClaw in the app menu or run: dinoclaw
Add to Steam: Steam → Add a Non-Steam Game → pick DinoClaw.
EOF
}

log() { printf '\033[0;32m[INSTALL]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[WARN]\033[0m %s\n' "$*"; }
err() { printf '\033[0;31m[ERROR]\033[0m %s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --file)
      LOCAL_FILE="${2:-}"
      shift 2
      ;;
    --uninstall)
      DO_UNINSTALL=true
      shift
      ;;
    --launch)
      DO_LAUNCH=true
      shift
      ;;
    -h|--help)
      DO_HELP=true
      shift
      ;;
    *)
      err "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if $DO_HELP; then
  usage
  exit 0
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

uninstall() {
  log "Removing DinoClaw..."
  rm -f "$DESKTOP_DIR/$DESKTOP_ID"
  rm -f "$BIN_DIR/$LAUNCHER_NAME"
  rm -rf "$INSTALL_DIR"
  rm -f "$ICON_DIR/dinoclaw.png"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  fi
  log "Uninstall complete."
}

if $DO_UNINSTALL; then
  uninstall
  exit 0
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  err "This installer is for Linux (including Steam Deck Desktop Mode)."
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) EB_ARCH="x64" ;;
  aarch64|arm64) EB_ARCH="arm64" ;;
  *)
    err "Unsupported CPU architecture: $ARCH"
    exit 1
    ;;
esac

need_cmd curl
need_cmd chmod
need_cmd mkdir

pick_appimage_url() {
  local json_file="$1"
  local asset_url
  asset_url="$(
    grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+\.AppImage"' "$json_file" \
      | sed -E 's/.*"([^"]+\.AppImage)".*/\1/' \
      | grep -E "linux-(x64|x86_64|${EB_ARCH})\.AppImage$" \
      | head -1 || true
  )"
  if [[ -z "$asset_url" ]]; then
    asset_url="$(
      grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+\.AppImage"' "$json_file" \
        | sed -E 's/.*"([^"]+\.AppImage)".*/\1/' \
        | head -1 || true
    )"
  fi
  printf '%s' "$asset_url"
}

download_release() {
  local asset_url tmp tag_name

  if [[ -n "$VERSION" ]]; then
    log "Fetching release $VERSION from GitHub..."
    tmp="$(mktemp)"
    if ! curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$VERSION" -o "$tmp"; then
      rm -f "$tmp"
      err "Could not fetch release $VERSION."
      exit 1
    fi
    asset_url="$(pick_appimage_url "$tmp")"
    tag_name="$VERSION"
    rm -f "$tmp"
  else
    log "Fetching release info from GitHub..."
    tmp="$(mktemp)"
    if ! curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" -o "$tmp"; then
      rm -f "$tmp"
      err "Could not reach GitHub Releases."
      exit 1
    fi
    asset_url="$(pick_appimage_url "$tmp")"
    tag_name="$(
      grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' "$tmp" \
        | head -1 \
        | sed -E 's/.*"([^"]+)"/\1/' || true
    )"
    rm -f "$tmp"
  fi

  if [[ -z "${asset_url:-}" ]]; then
    err "No Linux AppImage found in GitHub Releases yet."
    echo
    echo "  The latest release may be Windows-only. Either:"
    echo "    1) Wait for v0.4.0+ (includes Steam Deck AppImage), then re-run this installer"
    echo "    2) Build on Deck:"
    echo "         git clone https://github.com/$REPO.git"
    echo "         cd DinoClaw && ./build-linux.sh"
    echo "         ./install.sh --file release/DinoClaw-*-linux-*.AppImage --launch"
    echo
    exit 1
  fi

  if [[ -n "$tag_name" ]]; then
    log "Using AppImage from release $tag_name"
  fi

  log "Downloading $asset_url"
  mkdir -p "$INSTALL_DIR"
  curl -fsSL "$asset_url" -o "$INSTALL_DIR/$APPIMAGE_NAME"
}

install_appimage() {
  local src="$1"
  if [[ ! -f "$src" ]]; then
    err "AppImage not found: $src"
    exit 1
  fi
  mkdir -p "$INSTALL_DIR"
  cp -f "$src" "$INSTALL_DIR/$APPIMAGE_NAME"
}

write_launcher() {
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/$LAUNCHER_NAME" <<EOF
#!/usr/bin/env bash
# DinoClaw launcher (Steam Deck / Linux)
export APPIMAGE_EXTRACT_AND_RUN="\${APPIMAGE_EXTRACT_AND_RUN:-1}"
export ELECTRON_OZONE_PLATFORM_HINT="\${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
exec "$INSTALL_DIR/$APPIMAGE_NAME" --no-sandbox "\$@"
EOF
  chmod +x "$BIN_DIR/$LAUNCHER_NAME"
}

write_desktop_entry() {
  mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
  if [[ -f "$INSTALL_DIR/icon.png" ]]; then
    cp -f "$INSTALL_DIR/icon.png" "$ICON_DIR/dinoclaw.png"
  elif [[ -f "$(dirname "$0")/build/icons/256x256.png" ]]; then
    cp -f "$(dirname "$0")/build/icons/256x256.png" "$ICON_DIR/dinoclaw.png"
  else
    curl -fsSL "https://raw.githubusercontent.com/$REPO/main/build/icons/256x256.png" \
      -o "$ICON_DIR/dinoclaw.png" 2>/dev/null || warn "Could not fetch menu icon (optional)."
  fi

  cat > "$DESKTOP_DIR/$DESKTOP_ID" <<EOF
[Desktop Entry]
Type=Application
Name=DinoClaw
Comment=Desktop AI agent — local-first, free, open source
Exec=$BIN_DIR/$LAUNCHER_NAME
Icon=${ICON_DIR}/dinoclaw.png
Terminal=false
Categories=Utility;Office;
StartupWMClass=DinoClaw
Keywords=AI;Agent;Assistant;Chat;LLM;Ollama;
EOF

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  fi
}

echo
echo "  ===================================="
echo "    DinoClaw — Linux / Steam Deck"
echo "  ===================================="
echo

if [[ -n "$LOCAL_FILE" ]]; then
  log "Installing from local file: $LOCAL_FILE"
  install_appimage "$LOCAL_FILE"
else
  download_release
fi

chmod +x "$INSTALL_DIR/$APPIMAGE_NAME"
write_launcher
write_desktop_entry

log "Installed to $INSTALL_DIR/$APPIMAGE_NAME"
log "Run from terminal: $LAUNCHER_NAME"
log "Or find DinoClaw in your app menu (Desktop Mode on Steam Deck)."

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "~/.local/bin is not in your PATH."
  warn "Add this to ~/.bashrc:  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo
echo "  Steam Deck tip: Steam → Add a Non-Steam Game → select DinoClaw."
echo

if $DO_LAUNCH; then
  log "Launching DinoClaw..."
  exec "$BIN_DIR/$LAUNCHER_NAME"
fi
