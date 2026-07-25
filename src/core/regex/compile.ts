import type { RuleDraft } from "../types";
import { assessPattern } from "./guard";
import type { RiskRule } from "./guard-types";

export type CompileResult =
  | { ok: true; re: RegExp }
  | { ok: false; kind: "risky"; rule: RiskRule }
  | { ok: false; kind: "syntax"; message: string }
  | { ok: false; kind: "flags"; message: string };

const ALLOWED_FLAGS = new Set(["g", "i", "m", "s", "u", "y", "d", "v"]);

/** Muster, die zeilenweise Ausfuehrung ausschliessen: s/m-Flag oder ein \n im Pattern. */
export function isMultilinePattern(draft: RuleDraft): boolean {
  return draft.flags.includes("s") || draft.flags.includes("m") || draft.regex.includes("\\n");
}

export function compileRule(draft: RuleDraft): CompileResult {
  for (const flag of draft.flags) {
    if (!ALLOWED_FLAGS.has(flag)) return { ok: false, kind: "flags", message: flag };
  }
  const risk = assessPattern(draft.regex);
  if (!risk.ok) return { ok: false, kind: "risky", rule: risk.rule };

  const flags = draft.flags.includes("g") ? draft.flags : `${draft.flags}g`;
  try {
    return { ok: true, re: new RegExp(draft.regex, flags) };
  } catch (err) {
    return { ok: false, kind: "syntax", message: err instanceof Error ? err.message : String(err) };
  }
}
