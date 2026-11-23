#!/bin/bash
# Builds Shellby's dictation helper for both Mac architectures, into
# build/mac/shellby-ear (packaged by electron-builder's extraResources). On a
# Mac with the Xcode command line tools. The release signs it with the app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../build/mac"
mkdir -p "$out"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12" -o "$out/shellby-ear-$arch" "$here/ear/main.swift"
done
lipo -create -output "$out/shellby-ear" "$out/shellby-ear-arm64" "$out/shellby-ear-x86_64"
rm "$out/shellby-ear-arm64" "$out/shellby-ear-x86_64"
echo "built $out/shellby-ear"
