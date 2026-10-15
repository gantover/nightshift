/**
 * Sandcastle sandbox provider backed by Docker Sandboxes (`sbx`).
 *
 * Why "isolated" and not "bind-mount": an sbx microVM keeps its own
 * filesystem, so we let Sandcastle copy the worktree in and pull commits out.
 * That avoids depending on how sbx maps host paths, and keeps the host
 * checkout untouched while the agent works.
 *
 * Everything sbx-specific lives here. Facts to confirm in the spike are
 * marked SPIKE: they come from Docker's docs and CLI help, not from a run.
 */
import {
  createIsolatedSandboxProvider,
  type ExecResult,
  type IsolatedSandboxHandle,
  type IsolatedSandboxProvider,
} from "@ai-hero/sandcastle";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

export interface SbxOptions {
  /** sbx agent type: picks the base template and the proxy's credential wiring. */
  readonly agent?: string;
  /** Custom template image (full reference, e.g. docker.io/you/nightshift:v1). */
  readonly template?: string;
  /** Repo path inside the sandbox. */
  readonly workdir?: string;
  /** Sandbox name prefix; a timestamp is appended. */
  readonly namePrefix?: string;
  /** Host files or folders copied in right after creation (configs, skills, setup script). */
  readonly seed?: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  /** Commands run once after seeding, e.g. installing rtk or playwright-cli. */
  readonly setup?: readonly string[];
  /** Keep the sandbox after close (for debugging a night in the morning). */
  readonly keep?: boolean;
  /** Path to the sbx binary. */
  readonly sbxBin?: string;
  /** Extra env injected into every command (never put secrets here: use sbx secrets). */
  readonly env?: Record<string, string>;
  /** Called with setup/progress lines. */
  readonly log?: (line: string) => void;
}

const TAIL = 64 * 1024;
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

class Tail {
  private buf = "";
  push(s: string) {
    this.buf += s;
    if (this.buf.length > TAIL) this.buf = this.buf.slice(-TAIL);
  }
  toString() {
    return this.buf;
  }
}

/** Run the sbx CLI, streaming stdout line by line when asked. */
export function sbx(
  bin: string,
  args: readonly string[],
  opts: { stdin?: string; onLine?: (line: string) => void } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const out = new Tail();
    const err = new Tail();
    let partial = "";
    proc.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      if (!opts.onLine) return out.push(chunk);
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        out.push(line + "\n");
        opts.onLine(line);
      }
    });
    proc.stderr!.setEncoding("utf8").on("data", (chunk: string) => err.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (partial && opts.onLine) {
        out.push(partial);
        opts.onLine(partial);
      }
      resolve({ stdout: out.toString(), stderr: err.toString(), exitCode: code ?? 1 });
    });
    if (opts.stdin !== undefined) {
      proc.stdin!.end(opts.stdin);
    }
  });
}

export const sbxProvider = (options: SbxOptions = {}): IsolatedSandboxProvider =>
  createIsolatedSandboxProvider({
    name: "sbx",
    env: options.env,
    create: async (createOpts): Promise<IsolatedSandboxHandle> => {
      const bin = options.sbxBin ?? "sbx";
      const workdir = options.workdir ?? "/home/agent/workspace";
      const log = options.log ?? (() => {});
      const name = `${options.namePrefix ?? "nightshift"}-${Date.now().toString(36)}`;
      const env = { ...createOpts.env };

      const must = async (args: string[], what: string) => {
        const r = await sbx(bin, args);
        if (r.exitCode !== 0) throw new Error(`sbx ${what} failed (${r.exitCode}): ${r.stderr || r.stdout}`);
        return r;
      };

      // Mountless sandbox: no workspace path, so nothing on the host is shared.
      const createArgs = ["create", "--name", name, "--no-progress"];
      if (options.template) createArgs.push("--template", options.template);
      createArgs.push(options.agent ?? "opencode");
      await must(createArgs, "create");
      log(`sandbox ${name} created`);

      // SPIKE: sandboxes auto-stop after the last session exits. A detached
      // sleeper keeps the VM up between Sandcastle's separate exec calls.
      await sbx(bin, ["exec", "-d", name, "--", "sleep", "infinity"]);

      const shell = (command: string, cwd: string, sudo = false) => {
        const exports = Object.entries(env)
          .map(([k, v]) => `export ${k}=${q(v)};`)
          .join(" ");
        const body = `cd ${q(cwd)} && ${exports} ${command}`;
        return sudo ? `sudo -E bash -lc ${q(body)}` : body;
      };

      const exec: IsolatedSandboxHandle["exec"] = (command, opts) =>
        sbx(
          bin,
          [
            "exec",
            ...(opts?.stdin !== undefined ? ["-i"] : []),
            name,
            "--",
            "bash",
            "-lc",
            shell(command, opts?.cwd ?? workdir, opts?.sudo),
          ],
          { stdin: opts?.stdin, onLine: opts?.onLine },
        );

      const copyIn = async (hostPath: string, sandboxPath: string) => {
        const isDir = (await stat(hostPath)).isDirectory();
        const target = isDir ? sandboxPath : dirname(sandboxPath);
        await exec(`mkdir -p ${q(target)}`, { cwd: "/" });
        // SPIKE: assumes docker-cp semantics ("dir/." copies the contents).
        await must(["cp", isDir ? `${hostPath}/.` : hostPath, `${name}:${sandboxPath}`], "cp in");
        // sbx cp may write as root; hand the files to the agent user (id expands before sudo).
        await exec(`sudo chown -R "$(id -u):$(id -g)" ${q(sandboxPath)}`, { cwd: "/" });
      };

      await exec(`mkdir -p ${q(workdir)}`, { cwd: "/" });
      for (const s of options.seed ?? []) {
        await copyIn(s.from, s.to);
        log(`seeded ${s.to}`);
      }
      for (const cmd of options.setup ?? []) {
        const r = await exec(cmd, { cwd: "/", onLine: (l) => log(`setup | ${l}`) });
        if (r.exitCode !== 0) log(`setup command failed (${r.exitCode}): ${cmd}\n${r.stderr}`);
      }

      return {
        worktreePath: workdir,
        exec,
        copyIn,
        copyFileOut: async (sandboxPath, hostPath) => {
          await mkdir(dirname(hostPath), { recursive: true });
          await must(["cp", `${name}:${sandboxPath}`, hostPath], "cp out");
        },
        interactiveExec: (args, opts) =>
          new Promise((resolve, reject) => {
            const cmd = `exec ${args.map(q).join(" ")}`;
            const proc = spawn(
              bin,
              ["exec", "-it", name, "--", "bash", "-lc", shell(cmd, opts.cwd ?? workdir)],
              { stdio: "inherit" },
            );
            proc.on("error", reject);
            proc.on("close", (code) => resolve({ exitCode: code ?? 1 }));
          }),
        close: async () => {
          if (options.keep) {
            log(`keeping sandbox ${name} (sbx rm --force ${name} to remove)`);
            return;
          }
          await sbx(bin, ["rm", "--force", name]);
        },
      };
    },
  });
