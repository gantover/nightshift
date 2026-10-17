# Nightshift

Plan a project with an agent in the evening; it builds unattended overnight; you wake up to a branch, a preview and `MORNING.md`.

| Layer | Choice |
| --- | --- |
| Orchestration | [Sandcastle](https://github.com/mattpocock/sandcastle) (`createSandbox`, `run`, `exec`, commit merge-back) |
| Isolation | Docker Sandboxes (`sbx`) microVM, via `src/sandbox/sbx.ts` (a Sandcastle provider) |
| Harness | OpenCode (planner, builder, reviewer, reporter agents in `opencode/agents/`) |
| Models | Local Qwen3.8-Flash-Next on llama.cpp (free); OpenCode Go entries optional as fallbacks |
| Secrets, network | sbx keychain + credential proxy, deny-all policy (`policies/build.sh`) |

## How a night works

1. `ns plan <repo>`: an interactive OpenCode planner, inside a sandbox, interviews you and commits `SPEC.md` + `tasks.yaml` to branch `nightshift/plan`. Merge it.
2. `ns preflight <repo>`: checks secrets, local model, task file, stop time.
3. `ns night <repo>` (via the systemd unit): one sandbox for the night, one fresh agent session per task. The runner, not the agent, runs each task's `verify` commands; a reviewer on another model family reads the diff; failures retry with the error, then a different model, then the task is parked. OpenCode Go enforces its own usage caps; a capped model just fails the attempt and the next one moves down the list.
4. Morning: commits are on branch `nightshift/<date>` in your repo, `MORNING.md` on top, and a phone push via ntfy.

The referee stays on the host: `tasks.yaml` is read once at launch, verify commands and state never come from the sandbox.

## Setup on the Z13

```bash
git clone <this repo> ~/nightshift && cd ~/nightshift && npm ci

# 1. Local model on :8080: builds llama.cpp for the 8060S (ROCm, gfx1151) and installs
#    host/llama-server.service (Qwen3.8-Flash-Next UD-IQ4_XS, ~94 GB download on first start).
#    Vulkan fallback if the ROCm build fails: -DGGML_VULKAN=ON instead of the HIP flags.
./host/install-llama.sh

# 2. Secrets: kept in your keyring; the sandbox only sees placeholders.
sbx secret set-custom --host opencode.ai --env OPENCODE_API_KEY --value "$OPENCODE_API_KEY"  # only if you list opencode-go models
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
- reaching llama-server at `host.docker.internal:8080`;
- websearch: `OPENCODE_ENABLE_EXA` set and `mcp.exa.ai` / `agent.tinyfish.ai` allowed by the policy;
- which tools `sandbox/setup.sh` managed to install.

Fix what fails, then paste the table into the design doc.

`npm run check` typechecks and runs a whole night against fake `sbx` and `opencode` binaries (no VM, no tokens). Use it after changing the loop.

Working on this repo with OpenCode or Claude Code: both read `AGENTS.md` (repo map, commands, rules). Spike, night and `sbx` commands are set to ask before running, in `opencode.json` and `.claude/settings.json`.

## Layout

```
src/sandbox/sbx.ts   Sandcastle provider for Docker Sandboxes
src/night.ts         the loop: build → verify → review → commit/retry/park → report
src/tasks.ts         tasks.yaml schema, night state (~/.local/state/nightshift)
src/spike.ts         stack proof
src/preflight.ts     pre-bed checks
opencode/            payload copied into each sandbox: config, agents, skills for the night agents
prompts/             per-turn briefs the runner fills in
templates/project/   SPEC.md, AGENTS.md, tasks.yaml, DECISIONS.md for `ns init`
policies/            sbx network policies
host/                systemd user units (night run, llama-server) and install-llama.sh
test/fake/           fake sbx + opencode for a token-free dry run
```

## Not done yet

- Detecting weakened tests in a diff (today only the reviewer prompt guards it).
- ponytail plugin for OpenCode; baking `setup.sh` into a saved template.
