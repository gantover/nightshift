/**
 * tasks.yaml (written by the planner) and the night's state.
 *
 * The runner reads tasks.yaml from the host checkout once, at launch. The
 * agent can edit its own copy inside the sandbox, but that copy is never
 * read back: the referee (task list, verify commands, state) stays on the host.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const Task = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string(),
  goal: z.string(),
  closes: z.array(z.string()).default([]), // acceptance criteria ids from SPEC.md
  depends_on: z.array(z.string()).default([]),
  verify: z.array(z.string()).min(1, "every task needs at least one verify command"),
  role: z.string().default("builder"),
  max_attempts: z.number().optional(),
  timeout_minutes: z.number().optional(),
  notes: z.string().optional(),
});
export type Task = z.infer<typeof Task>;

export const TaskFile = z
  .object({ project: z.string(), tasks: z.array(Task).min(1) })
  .superRefine((f, ctx) => {
    const ids = new Set(f.tasks.map((t) => t.id));
    for (const t of f.tasks) {
      for (const d of t.depends_on) {
        if (!ids.has(d)) ctx.addIssue({ code: "custom", message: `${t.id} depends on unknown task ${d}` });
      }
    }
  });
export type TaskFile = z.infer<typeof TaskFile>;

export async function loadTasks(repo: string): Promise<TaskFile> {
  return TaskFile.parse(parse(await readFile(join(repo, "tasks.yaml"), "utf8")));
}

export type Status = "pending" | "done" | "parked";
export interface TaskState {
  status: Status;
  attempts: number;
  models: string[];
  lastError?: string;
  commits: string[];
  minutes: number;
}
export interface NightState {
  project: string;
  branch: string;
  startedAt: number;
  deadline: number;
  tasks: Record<string, TaskState>;
  decisions?: string;
}

const stateDir = (repo: string) =>
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "nightshift", basename(repo));

export async function loadState(repo: string, init: () => NightState): Promise<NightState> {
  try {
    return JSON.parse(await readFile(join(stateDir(repo), "state.json"), "utf8")) as NightState;
  } catch {
    return init();
  }
}

export async function saveState(repo: string, s: NightState) {
  await mkdir(stateDir(repo), { recursive: true });
  await writeFile(join(stateDir(repo), "state.json"), JSON.stringify(s, null, 2));
}

export const logDir = (repo: string) => join(stateDir(repo), "logs");

/** First pending task whose dependencies are all done; parked deps block it. */
export function nextTask(f: TaskFile, s: NightState): Task | undefined {
  return f.tasks.find(
    (t) => s.tasks[t.id]?.status === "pending" && t.depends_on.every((d) => s.tasks[d]?.status === "done"),
  );
}
