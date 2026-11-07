#!/usr/bin/env bash
# Puts src-tauri/dmg/Read Me First.txt into the Mac disk image that tauri-action just built and
# uploaded, below the two icons (Tauri can't add files of its own to a .dmg), then replaces the
# .dmg in the draft release. Runs on macOS after the build; needs GH_TOKEN and RELEASE_ID.
set -euo pipefail
# Say which line failed: hdiutil and grep can fail without a word.
trap 'echo "::error::dmg-readme.sh failed at line $LINENO (exit $?)"' ERR

README="src-tauri/dmg/Read Me First.txt"
POSITION="{330, 470}" # Finder coordinates, under the arrow; see scripts/dmg-background.py

dmg="$(ls src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg | head -n 1)"
name="$(basename "$dmg")"
work="$(mktemp -d)"
echo "Adding the Read Me to $name"

# A compressed image is read-only: make a writable copy with room for the file.
hdiutil convert "$dmg" -format UDRW -o "$work/rw.dmg" -quiet
# hdiutil resize wants a size in sectors (512 bytes): the current one plus 4 MB.
sectors="$(hdiutil resize -limits "$work/rw.dmg" 2>/dev/null | tail -n 1 | awk '{print $2}' || true)"
if [[ "$sectors" =~ ^[0-9]+$ ]]; then
  hdiutil resize -sectors "$((sectors + 8192))" "$work/rw.dmg" || echo "::warning::Couldn't grow the disk image; trying as it is."
else
  echo "::warning::Couldn't read the disk image's size; trying as it is."
fi
mount=""
for attempt in 1 2 3; do
  mount="$(hdiutil attach "$work/rw.dmg" -readwrite -noverify -noautoopen | grep -o '/Volumes/.*$' | head -n 1 || true)"
  [ -n "$mount" ] && break
  echo "Mounting the disk image didn't work (try $attempt); trying again."
  sleep 5
done
[ -n "$mount" ] || { echo "::error::Couldn't mount the disk image"; exit 1; }
volume="$(basename "$mount")"
cp "$README" "$mount/"

# Place it, as Tauri's own script places the app and Applications icons.
osascript <<EOF || echo "::warning::Couldn't place the Read Me; Finder will show it where it fits."
tell application "Finder"
  tell disk "$volume"
    open
    set position of item "$(basename "$README")" of container window to $POSITION
    update without registering applications
    delay 2
    close
  end tell
end tell
EOF

sync
# Finder can hold the volume for a few seconds after closing its window.
for attempt in 1 2 3 4 5 6; do
  hdiutil detach "$mount" -quiet && break
  sleep 5
  [ "$attempt" -ge 4 ] && hdiutil detach "$mount" -force -quiet && break
done
[ ! -d "$mount" ] || { echo "::error::Couldn't eject $mount"; exit 1; }
hdiutil convert "$work/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$work/final.dmg" -quiet
mv -f "$work/final.dmg" "$dmg"

# Swap the uploaded .dmg for the new one: upload it under another name first, so the release
# always has a disk image, then remove the old one and give the new one its name.
assets="repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID/assets"
id_of() { gh api "$assets" --paginate --jq ".[] | select(.name == \"$1\") | .id"; }
upload="new-$name"
stale="$(id_of "$upload")"
[ -z "$stale" ] || gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$stale"
new="$(curl --fail --silent --show-error -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/x-apple-diskimage" \
  --data-binary @"$dmg" \
  "https://uploads.github.com/$assets?name=$upload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
old="$(id_of "$name")"
[ -z "$old" ] || gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$old"
gh api -X PATCH "repos/$GITHUB_REPOSITORY/releases/assets/$new" -f name="$name" >/dev/null
echo "Uploaded $name with the Read Me"
