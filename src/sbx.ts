/**
 * Sandcastle sandbox provider for Docker Sandboxes (`sbx`).
 *
 * Tools and config come from the kit (kit/), so this file only maps
 * Sandcastle's four operations onto the sbx CLI:
 *   create → sbx create --kit …   exec → sbx exec   copy → sbx cp   close → sbx rm
 *
 * It's an "isolated" provider: Sandcastle copies the repo in as a git bundle
 * and pulls commits back as patches, so nothing on the host is mounted.
 */
import { createIsolatedSandboxProvider, type ExecResult } from "@ai-hero/sandcastle";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface SbxOptions {
  agent: string; // sbx agent (workload), e.g. "opencode"
  kits: string[]; // absolute paths or OCI refs of sbx mixins
  env: Record<string, string>; // exported for every command
  keep: boolean; // leave the sandbox running after close
  workdir?: string; // repo path inside the sandbox
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Run the sbx CLI; stream stdout lines to onLine; keep the last 64 KB of output. */
function sbx(args: string[], opts: { stdin?: string; onLine?: (line: string) => void } = {}) {
  return new Promise<ExecResult>((resolve, reject) => {
    const p = spawn("sbx", args, { stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let out = "", err = "", partial = "";
    p.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop()!;
      for (const l of lines) opts.onLine?.(l);
      out = (out + chunk).slice(-65536);
    });
    p.stderr!.setEncoding("utf8").on("data", (chunk: string) => (err = (err + chunk).slice(-65536)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (partial) opts.onLine?.(partial);
      resolve({ stdout: out, stderr: err, exitCode: code ?? 1 });
    });
    if (opts.stdin !== undefined) p.stdin!.end(opts.stdin);
  });
}

async function must(args: string[]) {
  const r = await sbx(args);
  if (r.exitCode !== 0) throw new Error(`sbx ${args[0]} failed (${r.exitCode}): ${r.stderr || r.stdout}`);
}

export const sbxProvider = (o: SbxOptions) =>
  createIsolatedSandboxProvider({
    name: "sbx",
    create: async ({ env }) => {
      const name = `nightshift-${Date.now().toString(36)}`;
      const workdir = o.workdir ?? "/home/agent/workspace";
      await must(["create", "--name", name, ...o.kits.flatMap((k) => ["--kit", k]), o.agent]);
      // Fallback for sbx without the kit's long-running capability: without a live process
      // the VM auto-stops between the runner's exec calls.
      await sbx(["exec", "-d", name, "--", "sleep", "infinity"]);

      const exports = Object.entries({ ...o.env, ...env }).map(([k, v]) => `export ${k}=${q(v)};`).join(" ");
      const script = (cmd: string, cwd = workdir, sudo = false) =>
        sudo ? `sudo -E bash -lc ${q(`cd ${q(cwd)} && ${exports} ${cmd}`)}` : `cd ${q(cwd)} && ${exports} ${cmd}`;

      return {
        worktreePath: workdir,
        exec: (cmd, opts) =>
          sbx(["exec", ...(opts?.stdin !== undefined ? ["-i"] : []), name, "--", "bash", "-lc", script(cmd, opts?.cwd, opts?.sudo)],
            { stdin: opts?.stdin, onLine: opts?.onLine }),
        copyIn: async (host, inside) => {
          await sbx(["exec", name, "--", "mkdir", "-p", dirname(inside)]);
          await must(["cp", host, `${name}:${inside}`]);
        },
        copyFileOut: async (inside, host) => {
          await mkdir(dirname(host), { recursive: true });
          await must(["cp", `${name}:${inside}`, host]);
        },
        interactiveExec: (args, opts) =>
          new Promise((resolve, reject) => {
            const p = spawn("sbx", ["exec", "-it", name, "--", "bash", "-lc", script(`exec ${args.map(q).join(" ")}`, opts.cwd)], { stdio: "inherit" });
            p.on("error", reject);
            p.on("close", (code) => resolve({ exitCode: code ?? 1 }));
          }),
        close: async () => {
          if (o.keep) console.log(`sandbox kept: ${name} (sbx rm --force ${name} to remove)`);
          else await sbx(["rm", "--force", name]);
        },
      };
    },
  });
