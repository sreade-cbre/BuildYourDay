#!/bin/bash
# Keeps the Mac app on the latest commit on main. Once turned on, a git hook
# starts this in the background whenever main moves, from any checkout or
# worktree. It exports that commit to a clean folder, so edits nobody has
# committed never ship, runs the tests, then desktop/build.sh --install. If
# either fails, the installed app is left as it was and a notification says
# so. An open app switches to the new build once you are in another app.
# One build runs at a time; main moving during a build means one more after.
#
#   bash desktop/update.sh            update now, if main has moved
#   bash desktop/update.sh --enable   update whenever main moves
#   bash desktop/update.sh --disable  stop updating by itself
#   bash desktop/update.sh --status   what is installed, and whether it is on
#
# Everything it does goes to desktop/build/update.log.
set -uo pipefail

# Git sets these for its hooks, and they would point the commands below at
# whichever worktree moved main.
while read -r variable; do unset "$variable"; done < <(env | sed -n 's/^\(GIT_[A-Za-z_]*\)=.*/\1/p')

repo="$(cd "$(dirname "$0")/.." && pwd)"
state="$repo/desktop/build/auto"
log="$repo/desktop/build/update.log"
installed="${TIMETOWER_APPS_DIR:-$HOME/Applications}/Time Tower.app"
hook="$(git -C "$repo" rev-parse --path-format=absolute --git-path hooks/reference-transaction)"
marker="Time Tower: desktop/update.sh"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Time Tower\"" >/dev/null 2>&1 || true
}

enable() {
  if [[ -e "$hook" ]] && ! grep -q "$marker" "$hook"; then
    echo "There is already a reference-transaction hook at $hook, so it was left alone." >&2
    exit 1
  fi
  # Git started from an app may not have Node on its path, so the hook adds
  # where it is now, and for a Homebrew Node the bin beside its Cellar,
  # which outlasts an upgrade.
  local node_path
  node_path="$(dirname "$(command -v node)")"
  if [[ "$node_path" == */Cellar/* ]]; then node_path="$node_path:${node_path%%/Cellar/*}/bin"; fi
  mkdir -p "$(dirname "$hook")"
  cat > "$hook" <<EOF
#!/bin/sh
# $marker --enable put this here, and --disable takes it away.
# When main moves, it starts that script in the background to rebuild the
# Mac app. Git runs this for every change to any ref, so it stays quick and
# quiet.
[ "\$1" = committed ] || exit 0
printf '%s\n' "\$(cat)" | grep -q ' refs/heads/main\$' || exit 0
repo="\$(cd "\$(git rev-parse --git-common-dir)/.." && pwd)" || exit 0
[ -f "\$repo/desktop/update.sh" ] || exit 0
PATH="$node_path:\$PATH"
export PATH
# In a session of its own, so nothing that tidies up after git stops a build.
if [ -x /usr/bin/perl ]; then
  nohup /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' /bin/bash "\$repo/desktop/update.sh" </dev/null >/dev/null 2>&1 &
else
  nohup /bin/bash "\$repo/desktop/update.sh" </dev/null >/dev/null 2>&1 &
fi
exit 0
EOF
  chmod +x "$hook"
  echo "On: the Mac app rebuilds whenever main moves. The log is $log"
}

disable() {
  if [[ -e "$hook" ]] && grep -q "$marker" "$hook"; then
    rm "$hook"
    echo "Off: the Mac app no longer rebuilds by itself. npm run desktop still builds it."
  else
    echo "It was not on."
  fi
}

status() {
  local main app
  main="$(git -C "$repo" rev-parse --short refs/heads/main)"
  app="$(sed -n 's/^commit //p' "$installed/Contents/Resources/build-stamp" 2>/dev/null)"
  if [[ -e "$hook" ]] && grep -q "$marker" "$hook"; then
    echo "Updating by itself: on"
  else
    echo "Updating by itself: off (bash desktop/update.sh --enable turns it on)"
  fi
  echo "main:       $main"
  echo "installed:  ${app:-unknown, built before the app had a stamp}"
  if [[ -d "$state/lock" ]] && kill -0 "$(cat "$state/lock/pid" 2>/dev/null)" 2>/dev/null; then
    echo "building:   yes"
  fi
  local last
  last="$(grep -E ' (Installed [0-9a-f]+\.|Tests failed|The build failed|Could not export)' "$log" 2>/dev/null | tail -1)"
  [[ -n "$last" ]] && echo "last:       $last"
  echo "The log is $log"
}

build_main() {
  local sha short src
  sha="$(git -C "$repo" rev-parse --verify --quiet refs/heads/main)" || { say "There is no main branch."; return; }
  [[ "$sha" == "$(cat "$state/installed" 2>/dev/null)" ]] && return
  short="$(git -C "$repo" rev-parse --short "$sha")"
  say "Building $short, $(git -C "$repo" log -1 --format=%s "$sha")"
  src="$state/src"
  rm -rf "$src"
  mkdir -p "$src"
  if ! git -C "$repo" archive "$sha" | tar -x -C "$src"; then
    say "Could not export $short, so the installed app is unchanged."
    notify "Could not export $short, so the app was not updated. See desktop/build/update.log."
  else
    ln -s "$repo/node_modules" "$src/node_modules"
    if ! (cd "$src" && npm test); then
      say "Tests failed on $short, so the installed app is unchanged."
      notify "Tests failed on $short, so the app was not updated. See desktop/build/update.log."
    elif ! (cd "$src" && TIMETOWER_COMMIT="$short" bash desktop/build.sh --install); then
      say "The build failed on $short, so the installed app is unchanged."
      notify "The build failed on $short, so the app was not updated. See desktop/build/update.log."
    else
      echo "$sha" > "$state/installed"
      say "Installed $short."
    fi
  fi
  rm -rf "$src"
}

update() {
  mkdir -p "$state"
  # One build at a time. A call that finds one running leaves a note, and the
  # running one goes round again for whatever main is by then.
  if ! mkdir "$state/lock" 2>/dev/null; then
    if kill -0 "$(cat "$state/lock/pid" 2>/dev/null)" 2>/dev/null; then
      touch "$state/again"
      [[ -t 1 ]] && echo "A build is running, and it builds main again when it is done."
      return
    fi
    rm -rf "$state/lock"
    mkdir "$state/lock" 2>/dev/null || return
  fi
  echo $$ > "$state/lock/pid"
  trap 'rm -rf "$state/lock"' EXIT
  # Only the call holding the lock touches the log, so a trim never cuts the
  # file out from under a build still writing to it. Keeps the last 3,000
  # lines.
  if [[ -f "$log" ]]; then tail -n 3000 "$log" > "$log.tmp" && mv "$log.tmp" "$log"; fi
  if [[ -t 1 ]]; then
    exec > >(tee -a "$log") 2>&1
  else
    exec >> "$log" 2>&1
  fi
  while :; do
    rm -f "$state/again"
    build_main
    [[ -e "$state/again" ]] || break
  done
  rm -rf "$state/lock"
  trap - EXIT
  # A note left just as this one let go.
  if [[ -e "$state/again" ]]; then exec /bin/bash "$0"; fi
}

case "${1:-}" in
  --enable) enable ;;
  --disable) disable ;;
  --status) status ;;
  "") update ;;
  *) sed -n '10,13p' "$0" >&2; exit 2 ;;
esac
