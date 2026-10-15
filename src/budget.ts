/**
 * Budget governor. OpenCode Go meters each model in dollars: 20% of the
 * monthly allowance per 5 hours, 50% per week. Nightshift only sees its own
 * spend, so day-time usage from your laptop is invisible: keep `safety` < 1.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Config } from "./config.js";
import { parseSpec } from "./harness.js";

export interface Spend {
  readonly ts: number;
  readonly key: string; // harness:model
  readonly usd: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

const LEDGER = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "nightshift/spend.jsonl");

/**
 * Pull usage out of one `opencode run --format json` line.
 * SPIKE: field names follow OpenCode's step-finish part (tokens, cost); confirm
 * against a real line and adjust. Unknown shapes return undefined.
 */
export function usageFromOpenCodeLine(line: string): Omit<Spend, "ts" | "key"> | undefined {
  if (!line.startsWith("{")) return undefined;
  try {
    const obj = JSON.parse(line);
    const part = obj.part ?? obj;
    if (obj.type !== "step_finish" && part?.type !== "step-finish") return undefined;
    const t = part.tokens ?? {};
    return {
      usd: Number(part.cost ?? 0),
      input: Number(t.input ?? 0),
      output: Number(t.output ?? 0) + Number(t.reasoning ?? 0),
      cacheRead: Number(t.cache?.read ?? 0),
    };
  } catch {
    return undefined;
  }
}

export class Budget {
  private entries: Spend[] = [];
  constructor(private readonly cfg: Config) {}

  async load() {
    try {
      this.entries = (await readFile(LEDGER, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Spend);
    } catch {
      this.entries = [];
    }
  }

  async record(key: string, u: Omit<Spend, "ts" | "key">) {
    const e: Spend = { ts: Date.now(), key, ...u };
    this.entries.push(e);
    await mkdir(dirname(LEDGER), { recursive: true });
    await appendFile(LEDGER, JSON.stringify(e) + "\n");
  }

  private spent(key: string, ms: number) {
    const since = Date.now() - ms;
    return this.entries.filter((e) => e.key === key && e.ts >= since).reduce((s, e) => s + e.usd, 0);
  }

  /** Models without a monthly cap (the local one) are always available. */
  available(key: string): boolean {
    const b = this.cfg.budgets;
    const cap = b.monthlyUsd[parseSpec(key).model];
    if (cap === undefined) return true;
    const H = 3600_000;
    return (
      this.spent(key, 5 * H) < cap * b.fiveHourShare * b.safety &&
      this.spent(key, 7 * 24 * H) < cap * b.weekShare * b.safety &&
      this.spent(key, 30 * 24 * H) < cap * b.safety
    );
  }

  /**
   * Attempts 1 and 2 use the role's first choice (2 gets the failure context);
   * attempt 3+ moves down the chain. Over-budget models are skipped.
   */
  pick(role: string, attempt: number): string {
    const chain = this.cfg.roles[role];
    if (!chain) throw new Error(`No role "${role}" in nightshift.yaml`);
    const start = Math.min(attempt >= 3 ? attempt - 2 : 0, chain.length - 1);
    for (const key of [...chain.slice(start), ...chain.slice(0, start)]) {
      if (this.available(key)) return key;
    }
    throw new Error(`Every model for role "${role}" is over budget`);
  }

  summary(sinceTs: number) {
    const by = new Map<string, { usd: number; input: number; output: number; cacheRead: number }>();
    for (const e of this.entries.filter((e) => e.ts >= sinceTs)) {
      const s = by.get(e.key) ?? { usd: 0, input: 0, output: 0, cacheRead: 0 };
      s.usd += e.usd;
      s.input += e.input;
      s.output += e.output;
      s.cacheRead += e.cacheRead;
      by.set(e.key, s);
    }
    return Object.fromEntries(by);
  }
}
