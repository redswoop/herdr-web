#!/usr/bin/env bash
# Build + run the watch app in blackstar's watchOS Simulator from stormer,
# then pull a screenshot back. Usage: watch/sim.sh <out.png> [launch args…]
#   watch/sim.sh /tmp/w.png -open 'w3K:pA'
# Server + token are set once per simulator (simctl spawn … defaults write).
set -euo pipefail
OUT=${1:?out.png}; shift
HOST=${WATCH_MAC:-blackstar}
UDID=${WATCH_UDID:?set WATCH_UDID to the watch simulator (xcrun simctl list devices)}
DIR='~/dev/herdr-web-lab/watch'
cd "$(dirname "$0")"
rsync -a --delete --exclude '*.xcodeproj' --exclude build ./ "$HOST:dev/herdr-web-lab/watch/"
args=$(printf '%q ' "$@")
ssh "$HOST" "set -o pipefail; export PATH=/opt/homebrew/bin:\$PATH; cd $DIR && xcodegen -q &&
  xcodebuild -project CapraWatch.xcodeproj -scheme CapraWatch -configuration Debug -sdk watchsimulator \
    -destination 'platform=watchOS Simulator,id=$UDID' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build 2>&1 \
    | grep -E 'error:|BUILD (SUCCEEDED|FAILED)' | tee /dev/stderr | grep -q 'BUILD SUCCEEDED' || exit 1;
  xcrun simctl boot $UDID 2>/dev/null; xcrun simctl bootstatus $UDID -b >/dev/null;
  xcrun simctl terminate $UDID dev.redswoop.capra.watchkitapp 2>/dev/null;
  xcrun simctl install $UDID build/Build/Products/Debug-watchsimulator/Capra.app &&
  xcrun simctl launch $UDID dev.redswoop.capra.watchkitapp $args >/dev/null &&
  sleep \${WATCH_WAIT:-5} && xcrun simctl io $UDID screenshot /tmp/watch-shot.png >/dev/null 2>&1"
scp -q "$HOST:/tmp/watch-shot.png" "$OUT"
echo "$OUT"
