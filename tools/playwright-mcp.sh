#!/usr/bin/env bash
# Launch Playwright MCP against the host-provided Chromium in .playwright-browsers/
# (the CDN download is unreachable from the devcontainer). Extra shared libs
# extracted from .debs live in .playwright-libs/ — see tools/browser-test.js.
#
# WebGL (three.js pages): software GL via SwiftShader works with the FULL chrome
# when WAYLAND_DISPLAY/DISPLAY are unset (VS Code forwards a Wayland socket that
# makes ANGLE demand VK_KHR_wayland_surface, which SwiftShader lacks). Full chrome
# also needs libcups.so.2 — a stub .so is kept in .playwright-libs (see AGENTS.md).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
chrome="${CHROME_PATH:-$(ls "$root"/.playwright-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -1)}"
[ -x "$chrome" ] || { echo "no chromium in $root/.playwright-browsers (set CHROME_PATH)" >&2; exit 1; }
lib="$root/.playwright-libs/root"
export LD_LIBRARY_PATH="$lib/usr/lib/x86_64-linux-gnu:$lib/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
unset WAYLAND_DISPLAY DISPLAY
cfg="$(mktemp --suffix=.json)"
cat > "$cfg" <<JSON
{ "browser": { "launchOptions": { "args": ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } } }
JSON
exec npx -y @playwright/mcp@0.0.83 --headless --no-sandbox --isolated --executable-path "$chrome" --config "$cfg" "$@"
