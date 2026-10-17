# SPEC: hello

## Outcome

A smoke test for Nightshift itself: proves the sandbox, the kit, the model and the
commit path work, in a few minutes.

## Acceptance criteria

| Id | Criterion | Check |
| --- | --- | --- |
| AC-1 | `hello.txt` contains exactly the word `nightshift` | `grep -qx nightshift hello.txt` |
| AC-2 | The kit's tools are in the sandbox | `command -v rtk ast-grep fd playwright-cli` |
| AC-3 | `README.md` says what this repo is, in one sentence | `test $(wc -l < README.md) -ge 1` |

## Autonomy policy

Agents may decide alone. Never deploy, send or submit anything.
