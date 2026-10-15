import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const Config = z.object({
  sandbox: z.object({
    agent: z.string().default("opencode"),
    template: z.string().nullish(),
    workdir: z.string().default("/home/agent/workspace"),
    seed: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
    setup: z.array(z.string()).default([]),
    keep: z.boolean().default(false),
  }),
  roles: z.record(z.string(), z.array(z.string()).min(1)),
  budgets: z.object({
    monthlyUsd: z.record(z.string(), z.number()),
    fiveHourShare: z.number().default(0.2),
    weekShare: z.number().default(0.5),
    safety: z.number().default(0.8),
  }),
  night: z.object({
    stopAt: z.string().regex(/^\d\d:\d\d$/),
    taskTimeoutMinutes: z.number().default(45),
    idleTimeoutSeconds: z.number().default(600),
    maxAttempts: z.number().default(3),
  }),
  notify: z.object({ ntfyUrl: z.string().url().nullish() }).default({}),
});
export type Config = z.infer<typeof Config>;

export async function loadConfig(
  path = process.env.NIGHTSHIFT_CONFIG ?? resolve(ROOT, "nightshift.yaml"),
): Promise<Config> {
  const cfg = Config.parse(parse(await readFile(path, "utf8")));
  // Seed paths are relative to the nightshift repo.
  cfg.sandbox.seed = cfg.sandbox.seed.map((s) => ({ ...s, from: isAbsolute(s.from) ? s.from : resolve(ROOT, s.from) }));
  return cfg;
}

/** Next occurrence of HH:MM local time, at least an hour from now. */
export function deadline(stopAt: string, now = new Date()): Date {
  const [h, m] = stopAt.split(":").map(Number) as [number, number];
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() - now.getTime() < 3600_000) d.setDate(d.getDate() + 1);
  return d;
}
