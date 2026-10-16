The night is over. Write the morning report for the person who planned this project. They will read it with coffee and need to understand, in under 15 minutes, what exists and what to do next.

Facts collected by the runner (trust these over anything else):

```json
{{FACTS}}
```

Also read SPEC.md, DECISIONS.md (if present) and `git log --oneline` for this branch.

Write MORNING.md at the repo root, in this order:

1. **Verdict** — a table with one row per acceptance criterion in SPEC.md: met / partly / not met, and the evidence (task id, command, file).
2. **Try it** — the exact command(s) to run or open the result, and any preview URL found in the logs or code.
3. **How it works** — a short tour of the architecture and the main files, enough to own the code.
4. **Decisions made for you** — every entry in DECISIONS.md and the runner notes: what, why, how to reverse.
5. **Parked and blocked** — each task that isn't done, its last error in one or two lines, your best guess at the fix.
6. **Needs you** — anything only a human may do (production promotion, submissions, paid signups).

Plain language, short sentences, no filler. Commit MORNING.md with message "morning report", then print <promise>COMPLETE</promise>.
