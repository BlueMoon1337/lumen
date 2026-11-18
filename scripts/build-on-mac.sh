#!/bin/bash
# Builds Lumen on this Mac and installs it in Applications, for when GitHub Actions can't build
# a release. Run it from Terminal, in the folder this source was unzipped to:
#
#   bash scripts/build-on-mac.sh
#
# Needs Apple's command-line developer tools (xcode-select --install), Rust (rustup.rs) and
# Node 22 (nodejs.org). It builds for this Mac's processor only. Lumen's library, media and
# settings aren't touched; the Lumen it replaces goes to the Trash.
set -euo pipefail
cd "$(dirname "$0")/.."

# Rust's installer adds cargo to new Terminal windows; this one may not have it yet.
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

missing=0
xcode-select -p >/dev/null 2>&1 || { echo "Missing: Apple's command-line tools. Run: xcode-select --install"; missing=1; }
command -v cargo >/dev/null || { echo "Missing: Rust. Install it from https://rustup.rs"; missing=1; }
command -v npm >/dev/null || { echo "Missing: Node. Install Node 22 (LTS) from https://nodejs.org"; missing=1; }
[ "$missing" = 0 ] || exit 1

version="$(node -p "require('./package.json').version")"
echo "Building Lumen $version for this Mac. The first build takes 10 to 20 minutes."
npm ci
npx tauri build --bundles app

built="src-tauri/target/release/bundle/macos/Lumen.app"
[ -d "$built" ] || { echo "The build didn't make Lumen.app."; exit 1; }

echo "Installing Lumen $version in Applications."
osascript -e 'tell application "Lumen" to quit' >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x lumen >/dev/null || break; sleep 1; done
if [ -d /Applications/Lumen.app ]; then
  # To the Trash, so it can be put back.
  osascript -e 'tell application "Finder" to delete POSIX file "/Applications/Lumen.app"' >/dev/null ||
    mv /Applications/Lumen.app "$HOME/.Trash/Lumen (replaced $(date +%Y-%m-%d)).app"
fi
ditto "$built" /Applications/Lumen.app
open /Applications/Lumen.app
echo "Done: Lumen $version is in Applications and open."
