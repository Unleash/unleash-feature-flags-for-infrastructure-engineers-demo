#!/usr/bin/env bash
# Builds wrk2 with Apple Silicon fixes from https://github.com/giltene/wrk2/pull/145
# and installs it as `wrk2` into the Homebrew prefix.
set -euo pipefail

if command -v wrk2 >/dev/null 2>&1; then
  echo "wrk2 is already installed at $(command -v wrk2)."
  exit 0
fi

brew list openssl@3 >/dev/null 2>&1 || brew install openssl@3
brew list gcc >/dev/null 2>&1 || brew install gcc

GCC_BIN=$(find "$(brew --prefix)/bin" -name "gcc-[0-9]*" | sort -V | tail -1)

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

git clone --depth 1 --branch fix_build_apple_m2 https://github.com/PauloMigAlmeida/wrk2 "$BUILD_DIR"
make -C "$BUILD_DIR" CC="$GCC_BIN" OPENSSL_LIB="$(brew --prefix openssl@3)" all

install -m 0755 "$BUILD_DIR/wrk" "$(brew --prefix)/bin/wrk2"
echo "wrk2 installed at $(brew --prefix)/bin/wrk2."
