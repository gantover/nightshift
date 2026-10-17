/**
 * The night loop. Control flow is plain code on the host; the LLM only acts
 * inside `sb.run()`. One sandbox for the whole night (one branch, warm deps),
 * one fresh agent session per task:
 *
 *   for each ready task: builder → runner runs the task's verify commands → reviewer
 *                        failed? retry with the error (attempt 3+ on the next model) → else park
 *   then: reporter writes MORNING.md, phone push
 */
import { claudeCode, codex, createSandbox, opencode, pi, type AgentProvider, type Sandbox } from "@ai-hero/sandcastle";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { deadline, loadConfig, loadState, loadTasks, ROOT, saveState, stateDir, type Config, type NightState, type Task } from "./config.js";
import { sbxProvider } from "./sbx.js";

type Role = "planner" | "builder" | "reviewer" | "reporter";

/** "local/qwen…" runs on OpenCode; "pi:…", "claude-code:…", "codex:…" pick another harness. */
export function agentFor(spec: string, role: Role): AgentProvider {
  const [harness, model] = spec.includes(":") ? (spec.split(/:(.*)/s) as [string, string]) : ["opencode", spec];
  if (harness === "opencode") return opencode(model, { agent: role }); // agents live in kit/opencode/agents
  if (harness === "pi") return pi(model);
  if (harness === "claude-code") return claudeCode(model);
  if (harness === "codex") return codex(model);
  throw new Error(`Unknown harness "${harness}" in "${spec}"`);
}

export const sandboxFor = (cfg: Config) => sbxProvider(cfg.sandbox);

/** Attempts 1 and 2 use the first model (2 gets the failure context); 3+ move down the list. */
const pickModel = (list: string[], attempt: number) => list[Math.min(Math.max(0, attempt - 2), list.length - 1)]!;

/** prompts/<name>.md with {{KEY}} filled in. */
async function brief(name: string, vars: Record<string, string>) {
  const text = await readFile(join(ROOT, "prompts", `${name}.md`), "utf8");
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
}

const tail = (s: string, n = 4000) => (s.length > n ? "…" + s.slice(-n) : s);
const notify = (url: string | null | undefined, title: string, body: string) =>
  url ? fetch(url, { method: "POST", body, headers: { Title: title } }).catch(() => {}) : undefined;

interface Night {
  cfg: Config;
  repo: string;
  sb: Sandbox;
  state: NightState;
  stop: AbortSignal;
}

/** One agent session; its log goes to ~/.local/state/nightshift/<project>/logs/<label>.log. */
async function turn(n: Night, role: Role, attempt: number, prompt: string, label: string, minutes = n.cfg.night.taskTimeoutMinutes) {
  const model = pickModel(n.cfg.models[role], attempt);
  await mkdir(join(stateDir(n.repo), "logs"), { recursive: true });
  const res = await n.sb.run({
    agent: agentFor(model, role),
    prompt,
    name: label,
    idleTimeoutSeconds: n.cfg.night.idleTimeoutSeconds,
    logging: { type: "file", path: join(stateDir(n.repo), "logs", `${label}.log`) },
    signal: AbortSignal.any([n.stop, AbortSignal.timeout(minutes * 60_000)]),
  });
  return { model, res };
}

const Verdict = z.object({ pass: z.boolean(), issues: z.array(z.string()).default([]) });

async function runTask(n: Night, tasks: Task[], task: Task) {
  const st = n.state.tasks[task.id]!;
  const vars = { TASK_ID: task.id, TITLE: task.title, GOAL: task.goal, CLOSES: task.closes.join(", ") || "(none listed)" };
  while (st.attempts < (task.max_attempts ?? n.cfg.night.maxAttempts) && !n.stop.aborted) {
    st.attempts++;
    const label = `${task.id}-a${st.attempts}`;
    try {
      const done = tasks.filter((t) => n.state.tasks[t.id]!.status === "done").map((t) => `- ${t.id}: ${t.title}`);
      const { model, res } = await turn(n, "builder", st.attempts, await brief("builder", {
        ...vars,
        VERIFY: task.verify.map((c) => `- \`${c}\``).join("\n"),
        NOTES: task.notes ?? "",
        DONE: done.join("\n") || "(nothing yet)",
        PREVIOUS_FAILURE: st.lastError ? `A previous attempt failed. Fix this first:\n\n${st.lastError}` : "",
      }), label, task.timeout_minutes);
      st.models.push(model);
      st.commits.push(...res.commits.map((c) => c.sha));
    } catch (e) {
      st.lastError = `Agent run failed: ${(e as Error).message}`;
      continue;
    }

    // The runner checks the work itself: the agent's own claim of success doesn't count.
    st.lastError = undefined;
    for (const cmd of task.verify) {
      const r = await n.sb.exec(cmd);
      if (r.exitCode !== 0) {
        st.lastError = `\`${cmd}\` exited ${r.exitCode}\n${tail(r.stdout + "\n" + r.stderr)}`;
        break;
      }
    }
    await saveState(n.repo, n.state);
    if (st.lastError) continue;

    try {
      const { res } = await turn(n, "reviewer", 1, await brief("reviewer", { ...vars, BASE: `${st.commits[0] ?? "HEAD~1"}^` }), `${label}-review`);
      const v = Verdict.parse(JSON.parse([...res.stdout.matchAll(/<verdict>([\s\S]*?)<\/verdict>/g)].at(-1)?.[1] ?? "{}"));
      if (!v.pass) {
        st.lastError = `Reviewer rejected the change:\n${v.issues.map((i) => `- ${i}`).join("\n")}`;
        continue;
      }
    } catch (e) {
      // A broken reviewer shouldn't block green work: note it and accept.
      n.state.notes.push(`${task.id}: review unavailable (${(e as Error).message}); accepted on verify alone.`);
    }
    st.status = "done";
    break;
  }
  if (st.status !== "done") st.status = "parked";
  await saveState(n.repo, n.state);
}

export async function night(repoArg: string) {
  const repo = resolve(repoArg);
  const cfg = await loadConfig();
  const { project, tasks } = await loadTasks(repo); // read once, from the host
  const stopAt = deadline(cfg.night.stopAt);

  // Resume a crashed night if its deadline hasn't passed; otherwise start fresh.
  const saved = await loadState(repo);
  const state: NightState = saved && Date.now() < saved.deadline ? saved : {
    branch: `nightshift/${new Date().toLocaleDateString("sv-SE")}`, // local YYYY-MM-DD
    deadline: stopAt.getTime(),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, { status: "pending", attempts: 0, models: [], commits: [] }])),
    notes: [],
  };
  for (const t of Object.values(state.tasks)) if (t.status === "pending") t.attempts = 0;

  // Stop building 30 minutes before the deadline, to leave time for the report.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(new Error("deadline")), Math.max(0, state.deadline - Date.now() - 30 * 60_000));

  await using sb = await createSandbox({ branch: state.branch, sandbox: sandboxFor(cfg), cwd: repo });
  const n: Night = { cfg, repo, sb, state, stop: stop.signal };
  await notify(cfg.ntfyUrl, `Nightshift started: ${project}`, `${tasks.length} tasks, stop at ${cfg.night.stopAt}`);

  const ready = () => tasks.find((t) => state.tasks[t.id]!.status === "pending" && t.depends_on.every((d) => state.tasks[d]!.status === "done"));
  for (let task = ready(); task && !stop.signal.aborted; task = ready()) {
    console.log(`\n=== ${task.id}: ${task.title}`);
    await runTask(n, tasks, task);
    console.log(`=== ${task.id}: ${state.tasks[task.id]!.status}`);
  }
  clearTimeout(timer);

  const facts = {
    project,
    branch: state.branch,
    stoppedBy: stop.signal.aborted ? "deadline" : "task graph finished",
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, closes: t.closes, ...state.tasks[t.id] })),
    runnerNotes: state.notes,
  };
  try {
    await turn({ ...n, stop: new AbortController().signal }, "reporter", 1, await brief("reporter", { FACTS: JSON.stringify(facts, null, 2) }), "morning-report");
  } catch (e) {
    console.error(`Report agent failed: ${(e as Error).message}`);
  }

  const done = tasks.filter((t) => state.tasks[t.id]!.status === "done").length;
  const msg = `${done}/${tasks.length} tasks done on branch ${state.branch}. Check it out and read MORNING.md.`;
  await notify(cfg.ntfyUrl, `Nightshift finished: ${project}`, msg);
  console.log(`\n${msg}`);
}
