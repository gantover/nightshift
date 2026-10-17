#!/usr/bin/env -S npx tsx
/**
 *   ns init <repo>    copy the project templates (AGENTS.md, SPEC.md, tasks.yaml) into a repo
 *   ns plan <repo>    interactive planning with the planner agent, inside a sandbox
 *   ns night <repo>   run the night (normally via host/nightshift-night@.service)
 */
import { createSandbox } from "@ai-hero/sandcastle";
import { appendFile, cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { agentFor, night, sandboxFor } from "./night.js";

const [cmd, arg] = process.argv.slice(2);
if (!arg || !["init", "plan", "night"].includes(cmd ?? "")) {
  console.log("usage: ns init|plan|night <repo>");
  process.exit(1);
}
const repo = resolve(arg);

if (cmd === "init") {
  await cp(join(ROOT, "templates/project"), repo, { recursive: true, force: false });
  // Sandcastle keeps worktrees and logs under .sandcastle/: never commit them.
  const gi = await readFile(join(repo, ".gitignore"), "utf8").catch(() => "");
  if (!gi.split("\n").includes(".sandcastle/")) await appendFile(join(repo, ".gitignore"), "\n.sandcastle/\n");
  console.log(`Templates copied into ${repo} (existing files kept). Next: ns plan ${arg}`);
}

if (cmd === "plan") {
  const cfg = await loadConfig();
  await using sb = await createSandbox({ branch: "nightshift/plan", sandbox: sandboxFor(cfg), cwd: repo });
  const r = await sb.interactive({
    agent: agentFor(cfg.models.planner[0]!, "planner"),
    prompt: "Let's plan tonight's project. Read AGENTS.md and inputs/, then start the interview.",
  });
  console.log(`Planning committed ${r.commits.length} change(s) to nightshift/plan. Merge it, then: ns night ${arg}`);
}

if (cmd === "night") await night(repo);
