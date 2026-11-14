#!/bin/sh
# Renders each concept at 3840x2160 (2560x1440 CSS px at 150%) with headless Edge.
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
here=$(cd "$(dirname "$0")" && pwd -W)
for f in "${@:-*.html}"; do
  [ -f "$f" ] || continue
  out="${f%.html}.png"
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1.5 --window-size=2560,1440 --virtual-time-budget=2000 \
    --user-data-dir="$TEMP/health-mock-edge" \
    --screenshot="$here/$out" "file:///$here/$f" >/dev/null 2>&1
  echo "$out"
done
