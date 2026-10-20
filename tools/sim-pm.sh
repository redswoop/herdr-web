#!/bin/bash
# rsync the tree to the Mac lab worktree, relaunch Capra on one Simulator by UDID, open a URL, screenshot.
#   tools/sim-pm.sh <label> <udid> [capra://url] ; env: MAC, OUT, WAIT
set -e
MAC=${MAC:-armen@blackstar.tail93d23c.ts.net}
OUT=${OUT:-/tmp}
L=${1:-shot}; U=${2:?udid}; URL=${3:-}
cd "$(dirname "$0")/.."
rsync -az --exclude .git --exclude node_modules --exclude '.claude' --exclude 'mobile/ios' \
  --exclude 'mobile/android' --exclude '.expo' --exclude 'web/dist' --exclude 'public' ./ "$MAC":dev/herdr-web-lab/
ssh "$MAC" "export PATH=/opt/homebrew/bin:\$PATH; xcrun simctl terminate $U dev.redswoop.capra 2>/dev/null; \
  xcrun simctl launch $U dev.redswoop.capra >/dev/null; sleep ${WAIT:-18}; \
  if [ -n '$URL' ]; then xcrun simctl openurl $U '$URL'; sleep 8; fi; \
  xcrun simctl io $U screenshot /tmp/cap-$L.png >/dev/null 2>&1; grep -E 'error|Error' /tmp/metro.log | tail -1"
scp -q "$MAC":/tmp/cap-$L.png "$OUT/ios-$L.png"
python3 -c "
from PIL import Image; im=Image.open('$OUT/ios-$L.png'); im.resize((im.width//3, im.height//3)).save('$OUT/ios-$L-s.png')" 2>/dev/null || true
echo "$OUT/ios-$L-s.png"
