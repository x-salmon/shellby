#!/bin/sh
# Renders each direction at 2560x1440 with headless Edge: ./render.sh (all) or ./render.sh 3
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
here=$(cd "$(dirname "$0")" && pwd -W)
for v in "${@:-1 2 3 4 5}"; do
  for n in $v; do
    "$EDGE" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
      --window-size=2560,1440 --virtual-time-budget=2000 \
      --user-data-dir="$TEMP/tide-mock-edge" \
      --screenshot="$here/tide-$n.png" "file:///$here/index.html?v=$n&still=1" >/dev/null 2>&1
    echo "tide-$n.png"
  done
done
