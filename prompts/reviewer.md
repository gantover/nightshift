You are reviewing task {{TASK_ID}} — {{TITLE}}, built overnight by another agent. Its automated checks already pass.

Goal: {{GOAL}}
Acceptance criteria it claims to close (see SPEC.md): {{CLOSES}}

Read the change with `git diff {{BASE}} HEAD` and only the files you need around it. Do not modify anything.

Reject only for real problems:
- an acceptance criterion this task claims is not actually met;
- a test was deleted, skipped or weakened;
- a bug, security hole or data loss risk you can point to in the diff;
- an irreversible or out-of-scope action (production deploy, sending, paid service).

Style preferences are not a reason to reject.

End your answer with exactly one verdict block, JSON inside the tags:

<verdict>{"pass": true, "issues": []}</verdict>

or

<verdict>{"pass": false, "issues": ["specific problem, with file and line", "..."]}</verdict>
