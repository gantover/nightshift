# AGENTS.md

Instructions for coding agents working **on** Nightshift. Both OpenCode and Claude Code load this file automatically; there is deliberately no CLAUDE.md, because Claude Code would then ignore this file.

## What this repo is

Nightshift runs coding agents unattended overnight. On the host, a small TypeScript runner uses [Sandcastle](https://github.com/mattpocock/sandcastle) to drive an agent harness (OpenCode by default) inside a Docker Sandboxes (`sbx`) microVM. It checks each task with the task's own commands and puts the commits on branch `nightshift/<date>` of the target project. Design doc: https://claude.ai/artifact/DweCpM3Ywnm9QNM9VjFSgk

## Map

| Path | What it is |
| --- | --- |
| `src/` (~400 lines) | The runner, on the host. `sbx.ts` provider, `night.ts` loop + harness choice, `config.ts` files, `cli.ts`. |
| `kit/` | **sbx mixin baked into each sandbox**: `nightshift.dockerfile` builds the tools; `kit/opencode/` is the OpenCode config, agents and skills the *night agents* use, at `/opt/nightshift/opencode` in the sandbox. Not config for working on this repo. |
| `prompts/` | Briefs the runner fills in and sends to night agents each turn. |
| `templates/project/` | Files `ns init` copies into a target project. Its AGENTS.md is for night agents, not for you. |
| `examples/hello/` | Smoke-test project for `npm run try`. |
| `policies/`, `host/` | sbx network policy, systemd units, llama.cpp install. Host setup, run by the user. |

## Where Sandcastle is used

- `createSandbox()`: `src/night.ts`, `src/cli.ts` (plan)
- `sb.run()` (agent turn) and `sb.exec()` (verify commands): `src/night.ts`
- `sb.interactive()` (planning session): `src/cli.ts`
- `opencode()`, `pi()`, `claudeCode()`, `codex()`: `agentFor()` in `src/night.ts`

Prefer what sbx and Sandcastle already provide over new code: tools and config belong in the kit, not in setup scripts or the provider.

## Commands

```bash
npm ci
npm run check        # typecheck + fake night; run this after every change
```

These spend tokens or touch the user's machine. **Never run them unless the user asks**: `npm run try`, `npm run ns …`, `npx tsx src/cli.ts …`, any `sbx` command.

## Rules

- Node 22+, ESM, TypeScript strict with `noUncheckedIndexedAccess`. Run through `tsx`; there is no build step.
- Keep the referee on the host: the runner reads `tasks.yaml` once at launch, runs the verify commands itself, and keeps state in `~/.local/state/nightshift/`. Never read anything back from the sandbox's copy of the repo to make a decision.
- The user's sbx is v0.47: kits need ≥ 0.45; flags added in 0.48 (`--no-progress`, `--detach`) don't exist. If you add an sbx flag, teach `test/fake/bin/sbx` to check it.
- Assumptions about sbx or OpenCode not yet proven on the user's machine are marked `SPIKE:` in a comment; `npm run try` is where they get proven.
- Smallest change that works. The repo was cut from ~950 to ~400 lines of TypeScript; don't add a module where a function will do.
- Commits: imperative subject; the body says why.

## Debugging a real night

State: `~/.local/state/nightshift/<project>/state.json`. Per-turn agent logs: `…/logs/<task>-a<attempt>.log`. Set `sandbox.keep: true` in `nightshift.yaml` to keep the VM for inspection (`sbx ls`, `sbx exec <name> -- bash`). The `night-debug` skill walks through it.
