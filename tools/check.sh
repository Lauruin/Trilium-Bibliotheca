#!/usr/bin/env bash
# ============================================================
#  check.sh — everything that verifies Bibliotheca. All green or it's not done.
#
#  tools/trilium-bootstrap.sh --recreate   wipe + stand up the mock, mint token
#  tools/etapi-probe.sh                    assert every endpoint the app uses
#  tools/browser-test.js                   real headless pass, console errors
#
#  Order matters: the mock is recreated from scratch FIRST, proving the setup
#  is reproducible, then the app is verified against it.
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
run() {
  local name="$1"; shift
  printf '\n\033[1m=== %s ===\033[0m\n' "$name"
  if "$@"; then printf '\033[32m✓ %s ok\033[0m\n' "$name"
  else printf '\033[31m✗ %s FAILED\033[0m\n' "$name"; fail=1; fi
}

run "types + build" bash -c 'npx tsc -b && npx vite build >/dev/null && echo build ok'

run "unit" node tools/unit-test.mjs

# Disposable Trilium: recreate from a wiped volume (reproducibility proof).
# The browser pass runs against THAT fresh instance and seeds its demo vault
# itself; the ETAPI probe then asserts the whole contract.
run "trilium mock from scratch" tools/trilium-bootstrap.sh --recreate
run "browser pass" node tools/browser-test.js
run "etapi integration" tools/etapi-probe.sh

printf '\n'
[ "$fail" = 0 ] && printf '\033[32mall checks passed\033[0m\n' || printf '\033[31msomething failed\033[0m\n'
exit "$fail"