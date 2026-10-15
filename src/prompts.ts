import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./config.js";

/** Load prompts/<name>.md and fill {{KEY}} placeholders (Sandcastle doesn't template inline prompts). */
export async function prompt(name: string, vars: Record<string, string>): Promise<string> {
  const text = await readFile(join(ROOT, "prompts", `${name}.md`), "utf8");
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => {
    if (!(k in vars)) throw new Error(`prompts/${name}.md uses {{${k}}} but no value was given`);
    return vars[k]!;
  });
}

/** Keep the last n characters of a log, on a line boundary. */
export function tail(s: string, n = 4000): string {
  if (s.length <= n) return s;
  const cut = s.slice(-n);
  return "…\n" + cut.slice(cut.indexOf("\n") + 1);
}
