#!/usr/bin/env bash
# Dry run of a whole night with fake `sbx` and `opencode` binaries: no VM, no tokens.
# Exercises Sandcastle's copy-in/patch-out, verify, retries, parking, review, report.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
T=$(mktemp -d); P=$T/proj
mkdir -p "$P" && cd "$P" && git init -q -b main
cat > tasks.yaml <<'Y'
project: fake
tasks:
  - { id: one, title: First, goal: g, verify: ["grep -q one built.txt"] }
  - { id: two, title: Second, goal: g, depends_on: [one], verify: ["grep -q two built.txt"] }
  - { id: never, title: Always fails, goal: g, max_attempts: 2, verify: ["false"] }
  - { id: blocked, title: Blocked by never, goal: g, depends_on: [never], verify: ["true"] }
Y
echo ".sandcastle/" > .gitignore && git add -A && git -c user.email=t@t -c user.name=t commit -qm init
sed -e "s#workdir: /home/agent/workspace#workdir: $T/vm/workspace#" -e '/^  seed:/,/^    - bash /d' \
    -e 's/^  keep: false.*/  keep: false\n  seed: []\n  setup: []/' "$ROOT/nightshift.yaml" > "$T/ns.yaml"
cd "$ROOT"
PATH="$HERE/bin:$PATH" NIGHTSHIFT_CONFIG="$T/ns.yaml" XDG_STATE_HOME="$T/state" FAKE_SBX_LOG="$T/sbx.log" \
  npx tsx src/cli.ts night "$P"
git -C "$P" log --oneline "nightshift/$(date +%F)"
s=$(node -e 'const s=require(process.argv[1]);console.log(Object.values(s.tasks).map(t=>t.status).join(","))' "$T/state/nightshift/proj/state.json")
[ "$s" = "done,done,parked,pending" ] && echo "PASS fake night ($s)" || { echo "FAIL: $s"; exit 1; }
rm -rf "$T"
