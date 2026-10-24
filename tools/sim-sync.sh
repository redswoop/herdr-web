#!/bin/bash
# Push the working tree to the Mac's Simulator loop and bring back a screenshot.
# Metro must already be running in watch mode on the Mac (see memory: ios-simulator-loop).
#   tools/sim-sync.sh <label> [capra://url] ; env: MAC, OUT, WAIT
set -e
MAC=${MAC:?set MAC=user@mac-host (ssh target with Xcode + the lab worktree)}
OUT=${OUT:-/tmp}
L=${1:-shot}; URL=${2:-}
cd "$(dirname "$0")/.."
rsync -az --exclude .git --exclude node_modules --exclude '.claude' --exclude 'mobile/ios' \
  --exclude 'mobile/android' --exclude '.expo' --exclude 'web/dist' --exclude 'public' ./ "$MAC":dev/herdr-web-lab/
ssh "$MAC" "export PATH=/opt/homebrew/bin:\$PATH; xcrun simctl terminate booted dev.redswoop.capra 2>/dev/null; \
  xcrun simctl launch booted dev.redswoop.capra >/dev/null; sleep ${WAIT:-22}; \
  if [ -n '$URL' ]; then xcrun simctl openurl booted '$URL'; sleep 6; fi; \
  xcrun simctl io booted screenshot /tmp/cap-$L.png >/dev/null 2>&1; grep -E 'error|Error' /tmp/metro.log | tail -2"
scp -q "$MAC":/tmp/cap-$L.png "$OUT/ios-$L.png"
python3 -c "
from PIL import Image; im=Image.open('$OUT/ios-$L.png'); im.resize((im.width//3, im.height//3)).save('$OUT/ios-$L-s.png')" 2>/dev/null || true
echo "$OUT/ios-$L-s.png"
