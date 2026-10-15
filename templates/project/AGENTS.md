# AGENTS.md

Rules every agent session loads. Keep this under a page; procedures belong in skills.

## Project

- What it is: see SPEC.md "Outcome".
- Stack:
- Install: `...`
- Test: `...`
- Run locally: `...`

## How to work here

- Search with `rg`, `fd` and `ast-grep`; read only the files you need.
- Check web pages with `playwright-cli` (snapshot, screenshot), not a browser MCP.
- Smallest change that meets the criteria; reuse before adding.
- Never weaken or delete tests to make them pass.
- Every choice SPEC.md doesn't settle goes in DECISIONS.md: what, why, how to undo.
- Follow the autonomy policy in SPEC.md.
