# AGENTS.md

Instructions for coding agents working **on** Nightshift. Both OpenCode and Claude Code load this file automatically; there is deliberately no CLAUDE.md, because Claude Code would then ignore this file.

## What this repo is

Nightshift runs coding agents unattended overnight. On the host, a TypeScript runner uses [Sandcastle](https://github.com/mattpocock/sandcastle) to drive OpenCode inside a Docker Sandboxes (`sbx`) microVM. It checks each task with the task's own commands and puts the commits on branch `nightshift/<date>` of the target project. Design doc: https://claude.ai/artifact/DweCpM3Ywnm9QNM9VjFSgk

## Two kinds of files, don't mix them up

| Path | What it is |
| --- | --- |
| `src/`, `test/`, `package.json` | The runner. Runs on the host. This is the code you edit. |
| `opencode/` | **Payload copied into each sandbox** (`~/.config/opencode/` there): the OpenCode config, agents and skills the *night agents* use. Not config for working on this repo. |
| `prompts/` | Briefs the runner fills in and sends to night agents each turn. |
| `templates/project/` | Files `ns init` copies into a target project (SPEC.md, AGENTS.md, tasks.yaml…). Its AGENTS.md is for night agents, not for you. |
| `sandbox/setup.sh` | Runs inside each new sandbox to install tools. |
| `policies/`, `host/` | sbx network policy, systemd units, llama.cpp install. Host setup, run by the user. |

## Where Sandcastle is used

Only four calls; everything else is Nightshift's own logic.

- `createSandbox()`: `src/night.ts`, `src/cli.ts` (plan), `src/spike.ts`
- `sb.run()` (agent turn) and `sb.exec()` (verify commands): `src/night.ts`
- `sb.interactive()` (planning session): `src/cli.ts`
- `opencode(model, { agent })`: `src/night.ts`, `src/cli.ts`, `src/spike.ts`

`src/sandbox/sbx.ts` is the Sandcastle *isolated* provider for sbx: `exec` → `sbx exec`, `copyIn`/`copyFileOut` → `sbx cp`, `close` → `sbx rm`.

## Commands

```bash
npm ci
npm run check        # typecheck + fake night; run this after every change
npm run typecheck    # tsc only
npm test             # whole night against fake sbx/opencode in test/fake/bin: no VM, no tokens
```

These cost money or touch the user's machine. **Never run them unless the user asks**: `npm run spike`, `npm run night`, `npx tsx src/cli.ts plan|night|spike`, any `sbx` command.

## Rules

- Node 22+, ESM, TypeScript strict with `noUncheckedIndexedAccess`. Run through `tsx`; there is no build step.
- Keep the referee on the host: the runner reads `tasks.yaml` once at launch, runs the verify commands itself, and keeps state in `~/.local/state/nightshift/`. Never read anything back from the sandbox's copy of the repo to make a decision.
- sbx flags vary by version (the user's sbx predates v0.48; `--no-progress` broke it). Prefer the oldest documented form. If you add a flag, add the same check to `test/fake/bin/sbx`.
- Anything assumed about sbx or OpenCode and not yet proven is marked `SPIKE:` in a comment. Add a probe to `src/spike.ts` for new assumptions.
- Smallest change that works. This repo was criticised for growing too big; don't add a module where a function will do.
- Commits: imperative subject; the body says why.

## Debugging a real night

State: `~/.local/state/nightshift/<project>/state.json`. Per-turn agent logs: `…/logs/<task>-a<attempt>.log`. Set `sandbox.keep: true` in `nightshift.yaml` to keep the VM for inspection (`sbx ls`, `sbx exec <name> -- bash`). The `night-debug` skill walks through it.
