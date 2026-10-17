---
name: night-debug
description: Diagnose a Nightshift night that went wrong (parked tasks, crashes, missing commits) from its state and logs, then propose the smallest fix.
---

# Debug a night

Read-only until you have a diagnosis. Never rerun a night or `npm run try` without the user's go-ahead: both spend tokens.

1. **Which project and night?** State lives in `~/.local/state/nightshift/<project>/state.json` (project = the repo folder name). Note `branch`, `deadline` and each task's `status`, `attempts`, `models` and `lastError`.
2. **Classify each non-done task:**
   - `parked` with a verify error: the build was wrong or the verify command is. Read the task in the project's `tasks.yaml` and its last log, `logs/<task>-a<N>.log`.
   - `parked` with "Reviewer rejected": read `logs/<task>-a<N>-review.log`. Is the issue real, or is the reviewer too strict? If too strict, the fix goes in `prompts/reviewer.md`.
   - `parked` with "Agent run failed": usually idle timeout, task timeout or the deadline. Check the end of that log and the timestamps.
   - `pending`: a dependency was parked, or the deadline hit first.
3. **Commits.** `git log --oneline nightshift/<date>` in the project. Commits in the log but missing on the branch point at Sandcastle's patch extraction or the sbx provider's `copyFileOut`.
4. **Sandbox problems** (setup, network): rerun only with the user's go-ahead, with `sandbox.keep: true`, then inspect with `sbx exec <name> -- bash` and `sbx policy log`.

Report: one line per problem, the evidence (file and line), and the smallest fix. If the fix is in the runner, reproduce it in `test/fake/` first when possible.
