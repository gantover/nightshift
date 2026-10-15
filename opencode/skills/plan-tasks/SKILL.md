---
name: plan-tasks
description: Break SPEC.md into tasks.yaml, a graph of thin vertical slices the night runner executes and verifies.
---

# Plan tasks.yaml

Inspired by mattpocock/skills `to-issues` (MIT), but written to a file the runner reads instead of an issue tracker.

## Shape

```yaml
project: my-site
tasks:
  - id: scaffold          # [A-Za-z0-9_-]
    title: Scaffold Astro site with CI checks
    goal: |
      What exists when this task is done, in two to four sentences.
    closes: []            # acceptance criteria ids from SPEC.md
    depends_on: []
    verify:               # run by the runner, inside the sandbox, from the repo root; all must exit 0
      - npm ci
      - npm run build
    notes: optional hints, pitfalls, files to look at
    # optional: role (default builder), max_attempts, timeout_minutes
```

## Rules

- **Tracer bullets first.** Task 1 makes the thinnest end-to-end path work (build, test, preview). Later tasks thicken it.
- **Vertical slices.** Each task delivers something a user could see or a check could prove, not a layer ("all models", "all CSS").
- **Sized for one session.** About 15 to 45 minutes of agent work. Split anything bigger.
- **Spikes before bets.** If something is uncertain (an API, a build tool), schedule a small spike task first whose verify proves it works.
- **Every task has verify commands that would fail before the task and pass after.** `true` is not a check.
- **Every acceptance criterion is closed by at least one task.** Add a final `integration` task depending on all others whose verify runs the full suite.
- Order the list so that, if the night ends early, the most valuable slices are done.
