/**
 * The night loop. Deterministic control flow on the host; the LLM only acts
 * inside `sandbox.run()`. One sandbox for the whole night (warm deps, one
 * branch), one fresh agent session per task.
 */
import { createSandbox, type AgentStreamEvent, type Sandbox } from "@ai-hero/sandcastle";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Budget, usageFromOpenCodeLine } from "./budget.js";
import { deadline, loadConfig, type Config } from "./config.js";
import { harnessInfo, makeAgent, parseSpec } from "./harness.js";
import { notify } from "./notify.js";
import { prompt, tail } from "./prompts.js";
import { sbxProvider } from "./sandbox/sbx.js";
import { loadState, loadTasks, logDir, nextTask, saveState, type NightState, type Task, type TaskFile } from "./tasks.js";

const Verdict = z.object({ pass: z.boolean(), issues: z.array(z.string()).default([]) });

export function sandboxFor(cfg: Config, log = (l: string) => console.log(`[sbx] ${l}`)) {
  return sbxProvider({ ...cfg.sandbox, template: cfg.sandbox.template ?? undefined, log });
}

interface Ctx {
  cfg: Config;
  repo: string;
  sb: Sandbox;
  budget: Budget;
  state: NightState;
  stop: AbortSignal;
}

/** Run one agent turn for a role, accounting spend from the raw event stream. */
async function agentTurn(
  ctx: Ctx,
  role: string,
  agentName: string,
  attempt: number,
  text: string,
  label: string,
  timeoutMinutes = ctx.cfg.night.taskTimeoutMinutes,
) {
  const key = ctx.budget.pick(role, attempt);
  const spec = parseSpec(key);
  const pending: Promise<void>[] = [];
  const onEvent = (e: AgentStreamEvent) => {
    if (e.type !== "raw" || harnessInfo(spec).usage) return;
    const u = usageFromOpenCodeLine(e.line);
    if (u) pending.push(ctx.budget.record(key, u));
  };
  await mkdir(logDir(ctx.repo), { recursive: true });
  const res = await ctx.sb.run({
    agent: makeAgent(spec, agentName),
    prompt: text,
    name: label,
    idleTimeoutSeconds: ctx.cfg.night.idleTimeoutSeconds,
    logging: { type: "file", path: join(logDir(ctx.repo), `${label}.log`), onAgentStreamEvent: onEvent },
    signal: AbortSignal.any([ctx.stop, AbortSignal.timeout(timeoutMinutes * 60_000)]),
  });
  await Promise.all(pending);
  return { key, res };
}

async function verify(sb: Sandbox, task: Task) {
  for (const cmd of task.verify) {
    const r = await sb.exec(cmd);
    if (r.exitCode !== 0) return `\`${cmd}\` exited ${r.exitCode}\n${tail(r.stdout + "\n" + r.stderr)}`;
  }
  return undefined;
}

async function runTask(ctx: Ctx, file: TaskFile, task: Task) {
  const st = ctx.state.tasks[task.id]!;
  const max = task.max_attempts ?? ctx.cfg.night.maxAttempts;
  const started = Date.now();
  while (st.attempts < max && !ctx.stop.aborted) {
    st.attempts++;
    const done = file.tasks.filter((t) => ctx.state.tasks[t.id]?.status === "done").map((t) => `- ${t.id}: ${t.title}`);
    const brief = await prompt("builder", {
      PROJECT: file.project,
      TASK_ID: task.id,
      TITLE: task.title,
      GOAL: task.goal,
      CLOSES: task.closes.join(", ") || "(none listed)",
      VERIFY: task.verify.map((c) => `- \`${c}\``).join("\n"),
      NOTES: task.notes ?? "",
      DONE: done.join("\n") || "(nothing yet)",
      PREVIOUS_FAILURE: st.lastError ? `A previous attempt failed. Fix this first:\n\n${st.lastError}` : "",
    });
    const label = `${task.id}-a${st.attempts}`;
    try {
      const { key, res } = await agentTurn(ctx, task.role, "builder", st.attempts, brief, label, task.timeout_minutes);
      st.models.push(key);
      st.commits.push(...res.commits.map((c) => c.sha));
    } catch (e) {
      st.lastError = `Agent run failed: ${(e as Error).message}`;
      continue;
    }

    const failure = await verify(ctx.sb, task);
    if (failure) {
      st.lastError = failure;
      await saveState(ctx.repo, ctx.state);
      continue;
    }

    const review = await prompt("reviewer", {
      TASK_ID: task.id,
      TITLE: task.title,
      GOAL: task.goal,
      CLOSES: task.closes.join(", ") || "(none listed)",
      BASE: st.commits.length ? `${st.commits[0]}^` : "HEAD~1",
    });
    try {
      const { res } = await agentTurn(ctx, "reviewer", "reviewer", 1, review, `${label}-review`);
      const m = [...res.stdout.matchAll(/<verdict>([\s\S]*?)<\/verdict>/g)].at(-1);
      const v = Verdict.parse(JSON.parse(m?.[1] ?? "{}"));
      if (!v.pass) {
        st.lastError = `Reviewer rejected the change:\n${v.issues.map((i) => `- ${i}`).join("\n")}`;
        continue;
      }
    } catch (e) {
      // A broken reviewer shouldn't block green work: note it and accept.
      st.lastError = undefined;
      ctx.state.decisions = `${ctx.state.decisions ?? ""}\n- ${task.id}: review unavailable (${(e as Error).message}); accepted on verify alone.`;
    }
    st.status = "done";
    st.lastError = undefined;
    break;
  }
  if (st.status !== "done") st.status = "parked";
  st.minutes += Math.round((Date.now() - started) / 60000);
  await saveState(ctx.repo, ctx.state);
}

export async function night(repoArg: string) {
  const repo = resolve(repoArg);
  const cfg = await loadConfig();
  const file = await loadTasks(repo); // read once, from the host
  const budget = new Budget(cfg);
  await budget.load();

  const stopAt = deadline(cfg.night.stopAt);
  const day = new Date().toISOString().slice(0, 10);
  const fresh = (): NightState => ({
    project: file.project,
    branch: `nightshift/${day}`,
    startedAt: Date.now(),
    deadline: stopAt.getTime(),
    tasks: Object.fromEntries(
      file.tasks.map((t) => [t.id, { status: "pending" as const, attempts: 0, models: [], commits: [], minutes: 0 }]),
    ),
  });
  // Resume only a night that hasn't reached its deadline (a crash at 01:00 resumes; tomorrow starts fresh).
  const saved = await loadState(repo, fresh);
  const state = Date.now() < saved.deadline ? saved : fresh();
  // Resuming after a crash: give unfinished tasks their attempts back.
  for (const t of Object.values(state.tasks)) if (t.status === "pending") t.attempts = 0;

  const stop = new AbortController();
  // Leave 30 minutes for the integration pass and the report.
  const timer = setTimeout(() => stop.abort(new Error("deadline")), Math.max(0, stopAt.getTime() - Date.now() - 30 * 60_000));

  await using sb = await createSandbox({ branch: state.branch, sandbox: sandboxFor(cfg), cwd: repo });
  const ctx: Ctx = { cfg, repo, sb, budget, state, stop: stop.signal };
  await notify(cfg.notify.ntfyUrl, `Nightshift started: ${file.project}`, `${file.tasks.length} tasks, stop at ${cfg.night.stopAt}`, 2);

  for (let task = nextTask(file, state); task && !stop.signal.aborted; task = nextTask(file, state)) {
    console.log(`\n=== ${task.id}: ${task.title}`);
    await runTask(ctx, file, task);
    console.log(`=== ${task.id}: ${state.tasks[task.id]!.status}`);
  }
  clearTimeout(timer);

  // Morning report: written by an agent, from facts the runner collected.
  const facts = {
    project: file.project,
    branch: state.branch,
    stoppedBy: stop.signal.aborted ? "deadline" : "task graph finished",
    tasks: file.tasks.map((t) => ({ id: t.id, title: t.title, closes: t.closes, ...state.tasks[t.id] })),
    blockedByParked: file.tasks.filter((t) => state.tasks[t.id]?.status === "pending").map((t) => t.id),
    spend: budget.summary(state.startedAt),
    runnerNotes: state.decisions ?? "",
  };
  try {
    await agentTurn({ ...ctx, stop: new AbortController().signal }, "reporter", "reporter", 1,
      await prompt("reporter", { FACTS: JSON.stringify(facts, null, 2) }), "morning-report");
  } catch (e) {
    console.error(`Report agent failed: ${(e as Error).message}`);
  }

  const done = file.tasks.filter((t) => state.tasks[t.id]?.status === "done").length;
  const msg = `${done}/${file.tasks.length} tasks done on branch ${state.branch}. Check it out and read MORNING.md.`;
  await notify(cfg.notify.ntfyUrl, `Nightshift finished: ${file.project}`, msg, done === file.tasks.length ? 3 : 4);
  console.log(`\n${msg}`);
}
