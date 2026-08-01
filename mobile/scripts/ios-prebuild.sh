#!/usr/bin/env bash
# Dropbox (and some cloud sync tools) stamp files with extended attributes
# that make codesign fail with:
#   "resource fork, Finder information, or similar detritus not allowed"
# Strip them before any native iOS build. Safe to run repeatedly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
export COPYFILE_DISABLE=1

paths=(
  "$REPO/node_modules/expo-modules-jsi"
  "$ROOT/ios"
  "$ROOT/node_modules"
)
for p in "${paths[@]}"; do
  if [[ -e "$p" ]]; then
    xattr -cr "$p" 2>/dev/null || true
  fi
done
echo "ios-prebuild: stripped xattrs from build-sensitive paths"
