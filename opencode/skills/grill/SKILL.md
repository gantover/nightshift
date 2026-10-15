---
name: grill
description: Interview the user one question at a time until every decision the overnight build depends on is settled.
---

# Grill

Adapted from the idea behind mattpocock/skills `grill-me` (MIT).

Build a decision tree for the project and walk it with the user, one branch at a time.

- Ask **one** question per message. Offer your recommended answer and why, so the user can just say yes.
- Before asking, check whether the repo, `inputs/` or a quick command in the sandbox already answers it.
- Go depth-first: finish a branch (e.g. "deployment") before opening the next.
- Keep a running list of settled decisions and show it every few questions.

Branches you must close for every project:

1. **Outcome** — what exists in the morning, and who uses it for what.
2. **Scope** — what's in, and explicitly what's out tonight.
3. **Stack and constraints** — languages, frameworks, hosting, budget, licences, accessibility, languages of the content.
4. **Inputs** — sketches, copy, data, accounts. Anything missing is a blocker to resolve now.
5. **Acceptance** — how the user will judge success; each answer must become a check a command or a rubric can run.
6. **Autonomy policy** — what agents may decide alone; what they must never do (default: no production deploys, no sending, no submitting, no paid services).
7. **Credentials and network** — every external service the build touches, and whether its token and domain are set up in sbx.

Stop when the user agrees nothing important is open, then hand back to the planner.
