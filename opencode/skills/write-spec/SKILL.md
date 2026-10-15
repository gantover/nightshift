---
name: write-spec
description: Turn the settled interview into SPEC.md, with acceptance criteria that a command or rubric can check.
---

# Write SPEC.md

Use the structure of the SPEC.md template already in the repo. Fill every section; delete none.

## Acceptance criteria are the contract

Each criterion gets an id (`AC-1`, `AC-2`…) and a **check**: the command, or the artefact plus rubric, that proves it.

- Bad: "The landing page looks modern."
- Good: "AC-3: `/` shows hero, pricing and contact at 375 px and 1440 px with no horizontal scroll (`npm run e2e -- home`); screenshots score ≥ 4/5 against `inputs/home.png` on rubric R1."

Rules:

- If you can't write the check, the criterion isn't ready: ask the user.
- Prefer checks that are commands exiting 0. Use a rubric only for judgement (look, tone, fit), and write the rubric in SPEC.md.
- Every deliverable named in the outcome is covered by at least one criterion.

## Autonomy policy

Copy the agreed policy into its section word for word. Default if the user had no preference: choose libraries within the agreed stack; preview deploys allowed; never production, never send or submit anything, never add paid services; log every unscripted choice in DECISIONS.md.
