#!/bin/sh
# The mk1-shell submodule + the browser HAL -> src/mk1/shell/mk1-shell.wasm
# Needs zig: `brew install zig` or `pip install ziglang` (then it runs as `python3 -m ziglang`).
set -e
cd "$(dirname "$0")/.."
if command -v zig >/dev/null 2>&1; then
  set -- zig
elif [ "${OS:-}" = Windows_NT ]; then
  set -- "${PYTHON:-python}" -m ziglang
else
  set -- "${PYTHON:-python3}" -m ziglang
fi
SHELL_ROOT=${MK1_SHELL_DIR:-shell}
if [ -z "${MK1_SHELL_DIR:-}" ] && [ ! -f "$SHELL_ROOT/src/card/saver.c" ] && [ -f ../mk1-shell/src/card/saver.c ]; then
  SHELL_ROOT=../mk1-shell
fi
CORE="$SHELL_ROOT/src/core"
CARD="$SHELL_ROOT/src/card"
if [ ! -f "$CORE/token.c" ] || [ ! -f "$CARD/saver.c" ]; then
  echo 'mk1-shell source is missing or out of date. Set MK1_SHELL_DIR to the current firmware checkout.' >&2
  exit 1
fi
"$@" cc -target wasm32-wasi -mexec-model=reactor -Oz -std=c11 -Wall -Wextra -I "$CORE" -I "$CARD" \
  "$CORE/vm.c" "$CORE/sha256.c" "$CORE/token.c" "$CORE/tasks.c" "$CORE/font.c" "$CORE/shell.c" "$CORE/content_gen.c" \
  "$CARD/face.c" "$CARD/own.c" "$CARD/prompt.c" "$CARD/cube.c" "$CARD/saver.c" \
  wasm/hal_wasm.c -s -o src/mk1/shell/mk1-shell.wasm
echo "src/mk1/shell/mk1-shell.wasm: $(wc -c < src/mk1/shell/mk1-shell.wasm | tr -d ' ') bytes"
