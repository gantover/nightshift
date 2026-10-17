#!/usr/bin/env bash
# Runs once inside each new sandbox (as the agent user, passwordless sudo).
# Every install is best-effort: a missing tool is reported by the spike instead
# of killing the night. Once this is stable, bake it into a template with
# `sbx template save` and drop it from nightshift.yaml (sandbox creation gets
# much faster).
set -u
warn() { echo "WARN: $*"; }
step() { echo "== $*"; }

# User-level installs land in ~/.local/bin; make every login shell see it.
mkdir -p "$HOME/.local/bin"
grep -q 'nightshift-path' "$HOME/.profile" 2>/dev/null ||
  echo 'export PATH="$HOME/.local/bin:$PATH" # nightshift-path' >>"$HOME/.profile"
export PATH="$HOME/.local/bin:$PATH"

# websearch for non-Go models: Exa/Tinyfish hosted MCP, no key (allowed in policies/build.sh).
grep -q 'OPENCODE_ENABLE_EXA' "$HOME/.profile" 2>/dev/null || echo 'export OPENCODE_ENABLE_EXA=1' >>"$HOME/.profile"

step "apt: ripgrep fd jq"
if command -v apt-get >/dev/null; then
  { sudo apt-get update -qq && sudo apt-get install -y -qq ripgrep fd-find jq; } 2>&1 | tail -3 || warn "apt"
  [ -e /usr/bin/fdfind ] && ln -sf /usr/bin/fdfind "$HOME/.local/bin/fd"
fi

step "npm: ast-grep, playwright-cli (user prefix, no sudo)"
npm config set prefix "$HOME/.local" >/dev/null
npm i -g --no-fund --no-audit @ast-grep/cli @playwright/cli 2>&1 | tail -3 || warn "npm tools"
playwright-cli install --skills agents 2>&1 | tail -2 || warn "playwright-cli skills"

step "chromium for playwright"
npx -y playwright install --with-deps chromium 2>&1 | tail -2 || warn "chromium (alternative: docker.io/sbx/playwright-kit)"

step "rtk + its OpenCode plugin"
if ! command -v rtk >/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh 2>&1 | tail -2 || warn "rtk install"
fi
command -v rtk >/dev/null && { rtk init -g --opencode 2>&1 | tail -2 || warn "rtk init"; }

# TODO: ponytail's OpenCode plugin (check its README for the current install command).

step "result"
for b in rg fd jq ast-grep playwright-cli rtk; do
  command -v "$b" >/dev/null && echo "ok: $b" || echo "MISSING: $b"
done
