#!/bin/bash
# Builds Time Tower.app, the web app in a Mac window of its own, into
# desktop/build. With --install it then moves it to ~/Applications (or
# $TIMETOWER_APPS_DIR), which is what npm run desktop does. Needs Node and
# the Xcode command line tools (xcode-select --install), nothing else.
set -euo pipefail
cd "$(dirname "$0")/.."

install=false
[[ "${1:-}" == "--install" ]] && install=true

name="Time Tower"
out="desktop/build"
app="$out/$name.app"
work="$out/work"
target="$(uname -m)-apple-macos13.3"

npm run build

rm -rf "$app" "$work"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$work"

echo "Compiling the app"
swiftc -O -parse-as-library -target "$target" -o "$app/Contents/MacOS/TimeTower" desktop/TimeTower.swift

echo "Drawing the icon"
swiftc -O -parse-as-library -target "$target" -o "$work/make-icon" desktop/MakeIcon.swift
colors="$(node -e "import('./src/brand/tokens.ts').then(({ tokens, accentTokens }) => console.log(JSON.stringify({ ...tokens, ...accentTokens })))")"
"$work/make-icon" "$colors" "$work/AppIcon.iconset"
iconutil -c icns -o "$app/Contents/Resources/AppIcon.icns" "$work/AppIcon.iconset"

version="$(node -p "require('./package.json').version")"
cp desktop/Info.plist "$app/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$app/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$app/Contents/Info.plist"
cp -R dist "$app/Contents/Resources/web"

# Lets an open copy of the app tell when a newer build replaces it: a
# fingerprint of the page (index.html names every asset by its hash), one of
# the app's own code, and the commit.
commit="${TIMETOWER_COMMIT:-}"
if [[ -z "$commit" ]] && commit="$(git rev-parse --short HEAD 2>/dev/null)"; then
  git diff --quiet HEAD -- || commit="$commit with changes"
fi
{
  echo "page $(shasum -a 256 dist/index.html | cut -d ' ' -f 1)"
  echo "app $(shasum -a 256 desktop/TimeTower.swift | cut -d ' ' -f 1)"
  echo "commit $commit"
} > "$app/Contents/Resources/build-stamp"

# Signed ad hoc, which is enough for this Mac to run what it built itself.
codesign --force --sign - "$app"
echo "Built $app"

if $install; then
  apps="${TIMETOWER_APPS_DIR:-$HOME/Applications}"
  dest="$apps/$name.app"
  mkdir -p "$apps"
  # One install at a time, so a build by hand and one by desktop/update.sh
  # cannot interleave their renames.
  lock="/tmp/timetower-install-$(id -u).lock"
  for _ in $(seq 300); do mkdir "$lock" 2>/dev/null && break; sleep 0.1; done
  trap 'rmdir "$lock" 2>/dev/null || true' EXIT
  # Moved in with two renames, so an open copy never finds itself half
  # replaced, and no second copy is left behind for Spotlight to offer.
  rm -rf "$out/replaced.app"
  if [[ -e "$dest" ]]; then mv "$dest" "$out/replaced.app"; fi
  mv "$app" "$dest"
  rm -rf "$out/replaced.app"
  echo "Installed $dest"
  if pgrep -qf "^$dest/Contents/MacOS/TimeTower"; then
    echo "Time Tower is open and switches to this build once you are in another app."
  fi
fi
