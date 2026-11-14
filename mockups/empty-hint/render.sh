#!/bin/sh
# Renders each concept at 2x with headless Edge: the 460px panel beside a wide one.
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
here=$(cd "$(dirname "$0")" && pwd -W)
cd "$(dirname "$0")" || exit 1
[ $# -eq 0 ] && set -- *.html
for f in "$@"; do
  [ -f "$f" ] || continue
  out="${f%.html}.png"
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --window-size=2000,820 --virtual-time-budget=2000 \
    --user-data-dir="$TEMP/empty-hint-mock-edge" \
    --screenshot="$here/$out" "file:///$here/$f" >/dev/null 2>&1
  echo "$out"
done
