#!/usr/bin/env bash
# Run a real night on examples/hello in a throwaway repo: proves sbx, the kit,
# the model and the commit path in a few minutes. Uses the models in nightshift.yaml.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D=$(mktemp -d)/hello
cp -r "$ROOT/examples/hello" "$D" && cd "$D"
printf '.sandcastle/\n' > .gitignore
git init -q -b main && git add -A && git -c user.name=nightshift -c user.email=nightshift@localhost commit -qm init
cd "$ROOT" && npx tsx src/cli.ts night "$D"
git -C "$D" log --oneline "nightshift/$(date +%F)"
echo "Result repo: $D"
