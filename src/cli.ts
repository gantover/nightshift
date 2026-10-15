#!/usr/bin/env -S npx tsx
/**
 *   ns spike [--keep]     prove sbx + Sandcastle + OpenCode work together
 *   ns init <repo>        copy the project templates (AGENTS.md, SPEC.md, tasks.yaml)
 *   ns plan <repo>        interactive planning session with the planner agent, in a sandbox
 *   ns preflight <repo>   check everything the night needs
 *   ns night <repo>       run the night (normally via the systemd unit)
 */
import { createSandbox } from "@ai-hero/sandcastle";
import { appendFile, cp, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { makeAgent, parseSpec } from "./harness.js";
import { night, sandboxFor } from "./night.js";
import { preflight } from "./preflight.js";
import { spike } from "./spike.js";

const [cmd, arg, ...rest] = process.argv.slice(2);
const need = (a: string | undefined) => {
  if (!a) throw new Error(`usage: ns ${cmd} <repo>`);
  return resolve(a);
};

switch (cmd) {
  case "spike":
    await spike(arg === "--keep" || rest.includes("--keep"));
    break;
  case "init": {
    const repo = need(arg);
    const src = join(ROOT, "templates/project");
    for (const f of await readdir(src)) {
      await cp(join(src, f), join(repo, f), { recursive: true, force: false, errorOnExist: false });
    }
    // Sandcastle keeps worktrees and logs under .sandcastle/: never commit them.
    const gi = join(repo, ".gitignore");
    const cur = await readFile(gi, "utf8").catch(() => "");
    if (!cur.split("\n").includes(".sandcastle/")) await appendFile(gi, `${cur && !cur.endsWith("\n") ? "\n" : ""}.sandcastle/\n`);
    console.log(`Templates copied into ${repo} (existing files kept). Next: ns plan ${arg}`);
    break;
  }
  case "plan": {
    const repo = need(arg);
    const cfg = await loadConfig();
    await using sb = await createSandbox({ branch: "nightshift/plan", sandbox: sandboxFor(cfg), cwd: repo });
    const r = await sb.interactive({
      agent: makeAgent(parseSpec(cfg.roles.planner![0]!), "planner"),
      prompt: "Let's plan tonight's project. Read AGENTS.md and inputs/, then start the interview.",
    });
    console.log(`Planning committed ${r.commits.length} change(s) to nightshift/plan. Merge it, then: ns preflight ${arg}`);
    break;
  }
  case "preflight":
    process.exitCode = (await preflight(need(arg))) ? 0 : 1;
    break;
  case "night":
    await night(need(arg));
    break;
  default:
    console.log("commands: spike [--keep] | init <repo> | plan <repo> | preflight <repo> | night <repo>");
}
