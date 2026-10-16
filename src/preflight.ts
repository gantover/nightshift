/**
 * Preflight: everything that would kill the night at 23:05 is checked before
 * you go to bed. Host-side checks only; the spike covers sandbox internals.
 */
import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deadline, loadConfig } from "./config.js";
import { loadTasks } from "./tasks.js";

export async function preflight(repoArg: string): Promise<boolean> {
  const repo = resolve(repoArg);
  let ok = true;
  const check = async (name: string, fn: () => Promise<string> | string) => {
    try {
      console.log(`PASS  ${name}  ${await fn()}`);
    } catch (e) {
      ok = false;
      console.log(`FAIL  ${name}  ${(e as Error).message.split("\n")[0]}`);
    }
  };
  const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: repo, encoding: "utf8" }).trim();

  const cfg = await loadConfig();
  await check("sbx installed", () => sh("sbx", ["version"]).split("\n")[0]!);
  const usesGo = Object.values(cfg.models).flat().some((m) => m.startsWith("opencode-go/"));
  await check(`secrets stored (${usesGo ? "Go key, " : ""}GitHub)`, () => {
    const out = sh("sbx", ["secret", "ls"]);
    for (const needle of usesGo ? ["opencode.ai", "github"] : ["github"]) {
      if (!out.includes(needle)) throw new Error(`no secret mentioning ${needle}; see README step 2`);
    }
    return "found";
  });
  await check("local model answers on :8080", async () => {
    const r = await fetch("http://localhost:8080/v1/models", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return "ok";
  });
  await check("repo is clean git", () => {
    if (sh("git", ["status", "--porcelain"])) throw new Error("uncommitted changes: commit SPEC.md and tasks.yaml first");
    return sh("git", ["rev-parse", "--short", "HEAD"]);
  });
  await check("SPEC.md present", async () => {
    await access(join(repo, "SPEC.md"));
    return "ok";
  });
  await check("tasks.yaml valid", async () => {
    const f = await loadTasks(repo);
    return `${f.tasks.length} tasks`;
  });
  await check("stop time", () => deadline(cfg.night.stopAt).toLocaleString());
  console.log(ok ? "\nReady for the night." : "\nFix the failures above before launching.");
  return ok;
}
