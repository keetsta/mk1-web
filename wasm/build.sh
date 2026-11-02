#!/bin/sh
# shell/ (the mk1-shell submodule) + wasm/hal_wasm.c -> src/mk1/shell/mk1-shell.wasm
# Needs zig: `brew install zig` or `pip install ziglang` (then it runs as `python3 -m ziglang`).
set -e
cd "$(dirname "$0")/.."
if command -v zig >/dev/null 2>&1; then ZIG="zig"; else ZIG="${PYTHON:-python3} -m ziglang"; fi
CORE=shell/src/core
$ZIG cc -target wasm32-wasi -mexec-model=reactor -Oz -std=c11 -Wall -Wextra -I "$CORE" \
  "$CORE/vm.c" "$CORE/sha256.c" "$CORE/tasks.c" "$CORE/font.c" "$CORE/shell.c" "$CORE/content_gen.c" \
  wasm/hal_wasm.c -s -o src/mk1/shell/mk1-shell.wasm
echo "src/mk1/shell/mk1-shell.wasm: $(wc -c < src/mk1/shell/mk1-shell.wasm | tr -d ' ') bytes, shell at $(git -C shell rev-parse --short HEAD)"
