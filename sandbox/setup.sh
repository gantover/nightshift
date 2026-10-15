#!/usr/bin/env bash
# Runs once inside each new sandbox (as the agent user, passwordless sudo).
# Every install is best-effort: a missing tool is reported by the spike and
# preflight instead of killing the night. Once this is stable, bake it into a
# template with `sbx template save` and drop it from nightshift.yaml.
set -u
warn() { echo "WARN: $*"; }

if command -v apt-get >/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq ripgrep fd-find jq >/dev/null || warn "apt tools"
  [ -e /usr/bin/fdfind ] && [ ! -e /usr/local/bin/fd ] && sudo ln -s /usr/bin/fdfind /usr/local/bin/fd
fi

npm i -g --silent @ast-grep/cli @playwright/cli || warn "npm tools"
playwright-cli install --skills agents >/dev/null 2>&1 || warn "playwright-cli skills"
npx -y playwright install --with-deps chromium >/dev/null 2>&1 || warn "chromium (or use docker.io/sbx/playwright-kit)"

# rtk: compacts shell output before the agent reads it. Its hook rewrites bash calls.
if ! command -v rtk >/dev/null; then
  if command -v cargo >/dev/null; then
    cargo install --locked --git https://github.com/rtk-ai/rtk >/dev/null 2>&1 || warn "rtk build"
  else
    warn "rtk: no cargo in this template; add a prebuilt binary to the template"
  fi
fi
# TODO after the spike: wire rtk's OpenCode hook (rtk init) and the ponytail
# OpenCode plugin. Both projects document per-agent setup; check current docs.

echo "setup done"
