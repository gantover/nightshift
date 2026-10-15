/**
 * Harness registry: turns a "harness:model" string from nightshift.yaml into a
 * Sandcastle agent provider. This is the door to other harnesses: adding one
 * is a line here plus making sure the sandbox has its CLI installed.
 *
 *   opencode:opencode-go/kimi-k2.7-code   OpenCode (default)
 *   opencode:local/qwen3.8-flash-next     OpenCode on the Z13 model
 *   pi:opencode-go/glm-5.2                pi: resumable sessions, token usage
 *   claude-code:claude-sonnet-5-5         Claude Code: richest Sandcastle support
 *   codex:gpt-5.6-luna                    Codex
 */
import { claudeCode, codex, opencode, pi, type AgentProvider } from "@ai-hero/sandcastle";

export interface HarnessSpec {
  readonly harness: string;
  readonly model: string;
  readonly key: string; // "harness:model", used for budget accounting
}

export interface HarnessInfo {
  /** Sandcastle can resume a session (cheap retries, structured-output auto-retry). */
  readonly resumable: boolean;
  /** Sandcastle parses token usage itself; otherwise Nightshift reads raw events. */
  readonly usage: boolean;
  /** CLI that must exist inside the sandbox. */
  readonly bin: string;
}

const HARNESSES: Record<string, { info: HarnessInfo; make: (model: string, agent?: string) => AgentProvider }> = {
  opencode: {
    info: { resumable: false, usage: false, bin: "opencode" },
    make: (model, agent) => opencode(model, agent ? { agent } : undefined),
  },
  pi: { info: { resumable: true, usage: false, bin: "pi" }, make: (model) => pi(model) },
  "claude-code": { info: { resumable: true, usage: true, bin: "claude" }, make: (model) => claudeCode(model) },
  codex: { info: { resumable: true, usage: false, bin: "codex" }, make: (model) => codex(model) },
};

export function parseSpec(spec: string): HarnessSpec {
  const i = spec.indexOf(":");
  if (i <= 0) throw new Error(`Bad harness spec "${spec}": expected harness:model`);
  const harness = spec.slice(0, i);
  if (!HARNESSES[harness]) {
    throw new Error(`Unknown harness "${harness}". Known: ${Object.keys(HARNESSES).join(", ")}`);
  }
  return { harness, model: spec.slice(i + 1), key: spec };
}

export const harnessInfo = (s: HarnessSpec): HarnessInfo => HARNESSES[s.harness]!.info;

/** `agent` is the named agent inside the harness (OpenCode's --agent), when it has one. */
export const makeAgent = (s: HarnessSpec, agent?: string): AgentProvider =>
  HARNESSES[s.harness]!.make(s.model, agent);
