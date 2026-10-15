/**
 * One-evening spike: does Sandcastle drive OpenCode inside an sbx microVM?
 * Builds a throwaway repo, runs every SPIKE assumption, prints a verdict table.
 *
 *   npm run spike                 # builder model from nightshift.yaml
 *   npm run spike -- --keep       # leave the sandbox up to poke at it
 */
import { createSandbox } from "@ai-hero/sandcastle";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageFromOpenCodeLine } from "./budget.js";
import { loadConfig } from "./config.js";
import { makeAgent, parseSpec } from "./harness.js";
import { sbxProvider } from "./sandbox/sbx.js";

type Row = [check: string, ok: boolean, detail: string];

export async function spike(keep = false) {
  const cfg = await loadConfig();
  const rows: Row[] = [];
  const add = (check: string, ok: boolean, detail = "") => {
    rows.push([check, ok, detail.trim().split("\n")[0]!.slice(0, 90)]);
    console.log(`${ok ? "PASS" : "FAIL"}  ${check}  ${detail.trim().split("\n")[0] ?? ""}`);
  };

  try {
    console.log(`sbx: ${execFileSync("sbx", ["version"], { encoding: "utf8" }).trim().split("\n")[0]}`);
  } catch {
    console.log("sbx: version unknown");
  }
  const repo = await mkdtemp(join(tmpdir(), "nightshift-spike-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "README.md"), "# spike\n");
  await writeFile(join(repo, ".gitignore"), ".sandcastle/\n");
  git("add", "-A");
  git("-c", "user.email=spike@nightshift", "-c", "user.name=spike", "commit", "-qm", "init");
  console.log(`toy repo: ${repo}`);

  const t0 = Date.now();
  await using sb = await createSandbox({
    branch: "nightshift/spike",
    cwd: repo,
    sandbox: sbxProvider({ ...cfg.sandbox, template: cfg.sandbox.template ?? undefined, keep, log: (l) => console.log(`[sbx] ${l}`) }),
  });
  add("sbx sandbox created, repo copied in", true, `${Math.round((Date.now() - t0) / 1000)} s`);

  const probe = async (check: string, cmd: string, ok: (out: string, code: number) => boolean, stdin?: string) => {
    const r = await sb.exec(cmd, stdin === undefined ? undefined : { stdin });
    add(check, ok(r.stdout, r.exitCode), r.stdout || r.stderr);
  };
  await probe("repo visible in sandbox", "git log --oneline | head -1", (o) => o.includes("init"));
  await probe("opencode installed", "opencode --version", (_, c) => c === 0);
  await probe("streaming exec (onLine)", "for i in 1 2 3; do echo line$i; sleep 1; done", (o) => o.includes("line3"));
  await probe("stdin piping (sbx exec -i)", "cat", (o) => o.includes("piped-ok"), "piped-ok\n");
  await probe("OPENCODE_API_KEY is a placeholder, not the key", "printenv OPENCODE_API_KEY | cut -c1-7", (o) => o.trim().length > 0 && !o.startsWith("sk-"));
  await probe("local model reachable", "curl -s -m 5 http://host.docker.internal:8080/v1/models | head -c 200", (o) => o.includes("data"));
  await probe("/dev/kvm (Android emulator)", "test -e /dev/kvm && echo present || echo absent", (o) => o.includes("present"));
  await probe("tools from setup", "for b in rg fd ast-grep rtk playwright-cli; do command -v $b >/dev/null && echo ok:$b || echo missing:$b; done", (o) => !o.includes("missing"));

  const key = cfg.roles.builder![0]!;
  const raw: string[] = [];
  const r = await sb.run({
    agent: makeAgent(parseSpec(key)),
    name: "spike-agent",
    idleTimeoutSeconds: 300,
    prompt:
      "Create a file hello.txt containing exactly the word nightshift, commit it with message 'spike: hello', " +
      "then print <promise>COMPLETE</promise>.",
    // Stdout logging has no event hook, so log to a file and collect raw lines.
    logging: {
      type: "file",
      path: join(repo, ".sandcastle", "spike-agent.log"),
      verbose: true,
      onAgentStreamEvent: (e) => {
        if (e.type === "raw") raw.push(e.line);
      },
    },
  });
  console.log(`agent log: ${join(repo, ".sandcastle", "spike-agent.log")}`);
  add(`agent ran (${key})`, r.completionSignal !== undefined, `${r.iterations.length} iteration(s)`);
  add("commit came back to the host branch", r.commits.length > 0, r.commits.map((c) => c.sha.slice(0, 8)).join(" "));
  const onHost = (() => {
    try {
      return execFileSync("git", ["show", "nightshift/spike:hello.txt"], { cwd: repo, encoding: "utf8" });
    } catch {
      return "";
    }
  })();
  add("hello.txt on host branch nightshift/spike", onHost.trim() === "nightshift", onHost);
  const usage = raw.map(usageFromOpenCodeLine).filter(Boolean);
  add("token usage parsed from OpenCode events", usage.length > 0,
    usage.length ? JSON.stringify(usage.at(-1)) : `no step_finish lines; sample: ${raw.find((l) => l.startsWith("{"))?.slice(0, 80) ?? "none"}`);

  console.log("\n| Check | Result | Detail |\n| --- | --- | --- |");
  for (const [c, ok, d] of rows) console.log(`| ${c} | ${ok ? "PASS" : "FAIL"} | ${d.replace(/\|/g, "\\|")} |`);
  console.log(`\nPaste this table back into the design doc's spike section.`);
}
