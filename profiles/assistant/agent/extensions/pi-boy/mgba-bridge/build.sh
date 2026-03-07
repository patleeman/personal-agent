#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$ROOT/vendor/mgba"
BUILD_DIR="$ROOT/build"
CORE_SRC_DIR="$BUILD_DIR/core-src"
CORE_NAME="mgba_libretro.dylib"
BRIDGE_NAME="pi-boy-mgba-bridge"

mkdir -p "$BUILD_DIR"

if [[ ! -d "$VENDOR_DIR" ]]; then
  echo "mGBA vendor source missing: $VENDOR_DIR" >&2
  exit 1
fi

platform="unix"
core_target="$CORE_NAME"
if [[ "$(uname -s)" == "Darwin" ]]; then
  platform="osx"
  core_target="$CORE_NAME"
fi

rsync -a --delete --exclude '.git' "$VENDOR_DIR/" "$CORE_SRC_DIR/"
make -C "$CORE_SRC_DIR" -f Makefile.libretro platform="$platform" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
cp "$CORE_SRC_DIR/$core_target" "$BUILD_DIR/$CORE_NAME"

cc -O2 -std=c11 -Wall -Wextra -I"$CORE_SRC_DIR/src/platform/libretro" "$ROOT/src/main.c" -o "$BUILD_DIR/$BRIDGE_NAME"

echo "$BUILD_DIR/$BRIDGE_NAME"
