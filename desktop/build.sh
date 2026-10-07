#!/bin/bash
# Builds Time Tower.app, the web app in a Mac window of its own, into
# desktop/build. With --install it also copies it to ~/Applications, which
# is what npm run desktop does. Needs Node and the Xcode command line tools
# (xcode-select --install), nothing else.
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

# Signed ad hoc, which is enough for this Mac to run what it built itself.
codesign --force --sign - "$app"
echo "Built $app"

if $install; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/$name.app"
  ditto "$app" "$HOME/Applications/$name.app"
  echo "Installed $HOME/Applications/$name.app"
  if pgrep -qf "^$HOME/Applications/$name.app/Contents/MacOS/TimeTower"; then
    echo "Time Tower is open, so quit it and open it again to get this build."
  fi
fi
