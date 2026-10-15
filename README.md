# Nightshift

Plan a project with an agent in the evening; it builds unattended overnight; you wake up to a branch, a preview and `MORNING.md`.

| Layer | Choice |
| --- | --- |
| Orchestration | [Sandcastle](https://github.com/mattpocock/sandcastle) (`createSandbox`, `run`, `exec`, commit merge-back) |
| Isolation | Docker Sandboxes (`sbx`) microVM, via `src/sandbox/sbx.ts` (a Sandcastle provider) |
| Harness | OpenCode by default; pi, Claude Code, Codex selectable per role (`src/harness.ts`) |
| Models | OpenCode Go + local Qwen3.8-Flash-Next on llama.cpp, routed per role with budget fallbacks |
| Secrets, network | sbx keychain + credential proxy, deny-all policy (`policies/build.sh`) |

## How a night works

1. `ns plan <repo>`: an interactive OpenCode planner, inside a sandbox, interviews you and commits `SPEC.md` + `tasks.yaml` to branch `nightshift/plan`. Merge it.
2. `ns preflight <repo>`: checks secrets, local model, task file, budgets, stop time.
3. `ns night <repo>` (via the systemd unit): one sandbox for the night, one fresh agent session per task. The runner, not the agent, runs each task's `verify` commands; a reviewer on another model family reads the diff; failures retry with the error, then a different model, then the task is parked. Spend is read from OpenCode's event stream and checked against Go's 5-hour, weekly and monthly caps.
4. Morning: commits are on branch `nightshift/<date>` in your repo, `MORNING.md` on top, and a phone push via ntfy.

The referee stays on the host: `tasks.yaml` is read once at launch, verify commands and state never come from the sandbox.

## Setup on the Z13

```bash
git clone <this repo> ~/nightshift && cd ~/nightshift && npm ci

# 1. Local model as a user service on :8080 (llama-server or llama-swap, Qwen3.8-Flash-Next + mmproj).

# 2. Secrets: kept in your keyring; the sandbox only sees placeholders.
sbx secret set-custom --host opencode.ai --env OPENCODE_API_KEY --value "$OPENCODE_API_KEY"
sbx secret set github --command 'gh auth token'      # better: a fine-grained PAT for the night repos
# Cloudflare (preview deploys), scoped to Pages/Workers edit:
sbx secret set-custom --host api.cloudflare.com --env CLOUDFLARE_API_TOKEN --value "$CLOUDFLARE_API_TOKEN"

# 3. Network policy
./policies/build.sh

# 4. Prove the stack (one evening)
npm run spike
```

Set global secrets **before** creating sandboxes; existing ones don't pick them up.

## The spike

`npm run spike` creates a throwaway repo, runs it through sbx, and prints a PASS/FAIL table. It tests the assumptions this code makes about sbx that come from docs rather than a run:

- `sbx create` without a workspace path (mountless), `sbx exec -i/-d/-it`, `sbx cp` with docker-cp semantics;
- the keep-alive sleeper preventing auto-stop between execs;
- the Go key arriving as a placeholder and being swapped by the proxy on `opencode.ai`;
- OpenCode's `step_finish` events carrying `tokens` and `cost` (`src/budget.ts`);
- reaching llama-server at `host.docker.internal:8080`;
- whether `/dev/kvm` exists (Android emulator yes/no);
- which tools `sandbox/setup.sh` managed to install.

Fix what fails, then paste the table into the design doc.

`npm test` runs a whole night against fake `sbx` and `opencode` binaries (no VM, no tokens). Use it after changing the loop.

## Switching harness

Role chains in `nightshift.yaml` are `harness:provider/model`:

```yaml
builder: [pi:opencode-go/kimi-k2.7-code, opencode:opencode-go/minimax-m3]
```

The harness CLI must exist in the sandbox (`sandbox/setup.sh` or the template). What Sandcastle gives each one today:

| Harness | Session resume | Token usage | Notes |
| --- | --- | --- | --- |
| opencode | no | parsed by Nightshift from events | Native Go provider; built-in sbx agent |
| pi | yes | parsed by Nightshift (TODO) | Validated Go client; minimal prompt |
| claude-code | yes | parsed by Sandcastle | Sandcastle's reference harness; needs an Anthropic key |
| codex | yes | not yet | |

## Layout

```
src/sandbox/sbx.ts   Sandcastle provider for Docker Sandboxes
src/harness.ts       harness:model → Sandcastle agent
src/night.ts         the loop: build → verify → review → commit/retry/park → report
src/budget.ts        Go cap tracking, model fallback
src/tasks.ts         tasks.yaml schema, night state (~/.local/state/nightshift)
src/spike.ts         stack proof
src/preflight.ts     pre-bed checks
opencode/            config, agents (planner, builder, reviewer, reporter), skills (grill, write-spec, plan-tasks)
prompts/             per-turn briefs the runner fills in
templates/project/   SPEC.md, AGENTS.md, tasks.yaml, DECISIONS.md for `ns init`
policies/            sbx network policies
host/                systemd user unit (sleep inhibitor, restart on crash)
test/fake/           fake sbx + opencode for a token-free dry run
```

## Not done yet

- Vision judge (screenshots vs `inputs/` sketches, local model) and the web/Android/research verifier packs.
- Research sandbox profile with web access and no publishing credentials.
- Detecting weakened tests in a diff (today only the reviewer prompt guards it).
- rtk and ponytail hooks for OpenCode; baking `setup.sh` into a saved template.
- Parallel lanes.
