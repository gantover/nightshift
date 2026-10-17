/**
 * The three files the runner reads: nightshift.yaml (this repo), tasks.yaml
 * (the project, read once at launch from the host checkout, never from the
 * sandbox), and the night's state (~/.local/state/nightshift/<project>/).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const Models = z.array(z.string()).min(1);
const Config = z.object({
  sandbox: z.object({
    agent: z.string(),
    kits: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    keep: z.boolean().default(false),
    workdir: z.string().optional(),
  }),
  models: z.object({ planner: Models, builder: Models, reviewer: Models, reporter: Models }),
  night: z.object({
    stopAt: z.string().regex(/^\d\d:\d\d$/),
    taskTimeoutMinutes: z.number(),
    idleTimeoutSeconds: z.number(),
    maxAttempts: z.number(),
  }),
  ntfyUrl: z.string().url().nullish(),
});
export type Config = z.infer<typeof Config>;

export async function loadConfig(path = process.env.NIGHTSHIFT_CONFIG ?? join(ROOT, "nightshift.yaml")) {
  const cfg = Config.parse(parse(await readFile(path, "utf8")));
  // Local kit paths are relative to this repo; sbx wants explicit paths.
  cfg.sandbox.kits = cfg.sandbox.kits.map((k) => (k.startsWith(".") ? resolve(ROOT, k) : k));
  return cfg;
}

const Task = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string(),
  goal: z.string(),
  closes: z.array(z.string()).default([]), // acceptance criteria ids from SPEC.md
  depends_on: z.array(z.string()).default([]),
  verify: z.array(z.string()).min(1, "every task needs at least one verify command"),
  max_attempts: z.number().optional(),
  timeout_minutes: z.number().optional(),
  notes: z.string().optional(),
});
export type Task = z.infer<typeof Task>;
const TaskFile = z.object({ project: z.string(), tasks: z.array(Task).min(1) });
export type TaskFile = z.infer<typeof TaskFile>;

export async function loadTasks(repo: string) {
  const f = TaskFile.parse(parse(await readFile(join(repo, "tasks.yaml"), "utf8")));
  const ids = new Set(f.tasks.map((t) => t.id));
  for (const t of f.tasks) for (const d of t.depends_on) if (!ids.has(d)) throw new Error(`${t.id} depends on unknown task ${d}`);
  return f;
}

export interface TaskState {
  status: "pending" | "done" | "parked";
  attempts: number;
  models: string[];
  lastError?: string;
  commits: string[];
}
export interface NightState {
  branch: string;
  deadline: number;
  tasks: Record<string, TaskState>;
  notes: string[];
}

export const stateDir = (repo: string) =>
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "nightshift", basename(repo));

export const loadState = (repo: string) =>
  readFile(join(stateDir(repo), "state.json"), "utf8").then((s) => JSON.parse(s) as NightState, () => undefined);

export async function saveState(repo: string, s: NightState) {
  await mkdir(stateDir(repo), { recursive: true });
  await writeFile(join(stateDir(repo), "state.json"), JSON.stringify(s, null, 2));
}

/** Next occurrence of HH:MM local time, at least an hour from now. */
export function deadline(stopAt: string, now = new Date()) {
  const [h, m] = stopAt.split(":").map(Number) as [number, number];
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() - now.getTime() < 3600_000) d.setDate(d.getDate() + 1);
  return d;
}
