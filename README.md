# Nightshift

Plan a project with an agent in the evening; it builds unattended overnight; you wake up to a branch and `MORNING.md`.

| Layer | Choice |
| --- | --- |
| Orchestration | [Sandcastle](https://github.com/mattpocock/sandcastle): sandbox lifecycle, agent runs, commits back to a branch |
| Isolation | Docker Sandboxes (`sbx`) microVM: `src/sbx.ts` (a Sandcastle provider) + `kit/` (an sbx mixin with the tools and agent config) |
| Harness | OpenCode by default; pi, Claude Code or Codex per role with a prefix in `nightshift.yaml` |
| Models | Local Qwen3.8-Flash-Next on llama.cpp (free); OpenCode Go entries optional as fallbacks |
| Secrets, network | sbx keychain + credential proxy, deny-all policy (`policies/build.sh`) |

## How a night works

1. `ns plan <repo>`: an interactive OpenCode planner, inside a sandbox, interviews you and commits `SPEC.md` + `tasks.yaml` to branch `nightshift/plan`. Merge it.
2. `ns night <repo>` (via the systemd unit): one sandbox for the night, one fresh agent session per task. The runner, not the agent, runs each task's `verify` commands; then a reviewer agent reads the diff. A failure is retried with the error, attempt 3 moves to the next model in the list, then the task is parked. OpenCode Go enforces its own usage caps: a capped model just fails the attempt.
3. Morning: commits are on branch `nightshift/<date>` in your repo, `MORNING.md` on top, and a phone push via ntfy if `ntfyUrl` is set.

The referee stays on the host: `tasks.yaml` is read once at launch; verify commands and state never come from the sandbox.

## Setup on the Z13

Needs sbx ≥ 0.45 (kits), Node ≥ 22.

```bash
git clone https://github.com/gantover/nightshift ~/nightshift && cd ~/nightshift && npm ci

# 1. Local model on :8080: builds llama.cpp for the 8060S (ROCm, gfx1151) and installs
#    host/llama-server.service (Qwen3.8-Flash-Next UD-IQ4_XS, ~94 GB download on first start).
#    Vulkan fallback if the ROCm build fails: -DGGML_VULKAN=ON instead of the HIP flags.
./host/install-llama.sh

# 2. Secrets: kept in your keyring; the sandbox only sees placeholders.
sbx secret set-custom --host opencode.ai --env OPENCODE_API_KEY --value "$OPENCODE_API_KEY"  # only if you list opencode-go models
sbx secret set github --command 'gh auth token'      # better: a fine-grained PAT for the night repos

# 3. Network policy
./policies/build.sh

# 4. Try it: a two-task night on examples/hello in a throwaway repo (a few minutes)
npm run try
```

Set global secrets **before** creating sandboxes; existing ones don't pick them up.

`npm run try` is the end-to-end check: the first run builds the kit (cached afterwards), the `hello` task's verify commands prove the kit's tools are in the sandbox, and the commits landing on the branch prove the copy-in/patch-out path. `npm run check` typechecks and runs a whole night against fake `sbx` and `opencode` binaries (no VM, no tokens): use it after changing the code.

## The kit

`kit/` is an sbx mixin ([kit spec](https://github.com/docker/sandbox-kit-spec)). `kit/nightshift.dockerfile` builds rtk, ast-grep, fd and playwright-cli once, plus Nightshift's OpenCode config, agents and skills under `/opt/nightshift`; `nightshift.yaml` points OpenCode there with `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR`. Change the kit, and the next sandbox rebuilds it.

Need a browser in the sandbox, or another harness's CLI? Add its mixin to `sandbox.kits` in `nightshift.yaml`.

## Layout

```
src/sbx.ts         Sandcastle provider: sbx create --kit / exec / cp / rm
src/night.ts       the loop: build → verify → review → retry/park → report; harness choice
src/config.ts      nightshift.yaml, tasks.yaml, night state (~/.local/state/nightshift)
src/cli.ts         ns init | plan | night
kit/               sbx mixin: tools + OpenCode config, agents (kit/opencode/agents), skills
prompts/           per-turn briefs the runner fills in
templates/project/ SPEC.md, AGENTS.md, tasks.yaml, DECISIONS.md for `ns init`
examples/hello/    the smoke-test project `npm run try` runs
policies/          sbx network policy
host/              systemd user units (night run, llama-server) and install-llama.sh
test/fake/         fake sbx + opencode for a token-free dry run
```

Working on this repo with OpenCode or Claude Code: both read `AGENTS.md`.

## Not done yet

- Detecting weakened tests in a diff (today only the reviewer prompt guards it).
- ponytail plugin for OpenCode.
- Spend tracking (Go enforces its caps; Nightshift doesn't count).
