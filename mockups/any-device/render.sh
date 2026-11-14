#!/bin/sh
# Renders each concept twice with headless Edge: a desktop browser (1600x1000)
# and an iPad in landscape (1180x820), both at 1.5x.
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
here=$(cd "$(dirname "$0")" && pwd -W)
cd "$(dirname "$0")"
[ $# -gt 0 ] || set -- *.html
for f in "$@"; do
  [ -f "$f" ] || continue
  for size in desktop:1600,1000 tablet:1180,820; do
    name=${size%%:*}; win=${size#*:}
    out="${f%.html}-$name.png"
    "$EDGE" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
      --force-device-scale-factor=1.5 --window-size=$win --virtual-time-budget=2000 \
      --user-data-dir="$TEMP/anydevice-mock-edge" \
      --screenshot="$here/$out" "file:///$here/$f" >/dev/null 2>&1
    echo "$out"
  done
done
