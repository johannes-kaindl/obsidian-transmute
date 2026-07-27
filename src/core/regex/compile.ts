import type { RuleDraft } from "../types";
import { assessPattern } from "./guard";
import type { RiskRule } from "./guard-types";

export type CompileResult =
  | { ok: true; re: RegExp }
  | { ok: false; kind: "risky"; rule: RiskRule }
  | { ok: false; kind: "syntax"; message: string }
  | { ok: false; kind: "flags"; message: string };

/** Kanonische Reihenfolge, in der `RegExp.prototype.flags` die Flags ausgibt. */
const FLAG_ORDER = ["d", "g", "i", "m", "s", "u", "v", "y"];
const ALLOWED_FLAGS = new Set(FLAG_ORDER);

/** Muster, die zeilenweise Ausfuehrung ausschliessen: s/m-Flag oder ein \n im Pattern. */
export function isMultilinePattern(draft: RuleDraft): boolean {
  return draft.flags.includes("s") || draft.flags.includes("m") || draft.regex.includes("\\n");
}

/**
 * Die Flags, mit denen das Muster tatsaechlich laeuft.
 *
 * `compileRule` erzwingt `g` — die Anzeige muss dasselbe tun, sonst zeigt das Panel ein
 * anderes Muster als das ausgefuehrte. Fuer ein Plugin, dessen Zweck es ist, Regex
 * nachvollziehbar zu machen, waere das ein Eigentor.
 */
export function effectiveFlags(flags: string): string {
  const withGlobal = flags.includes("g") ? flags : `${flags}g`;
  // Reihenfolge wie `RegExp.prototype.flags` sie normalisiert — sonst zeigt das Panel
  // /x/ig, waehrend die Engine /x/gi meldet.
  return FLAG_ORDER.filter((flag) => withGlobal.includes(flag)).join("");
}

export type CompileOptions = {
  /** Das Risiko-Veto uebergehen, weil die Nutzer:in es quittiert hat. */
  allowRisky?: boolean;
};

export function compileRule(draft: RuleDraft, opts: CompileOptions = {}): CompileResult {
  for (const flag of draft.flags) {
    if (!ALLOWED_FLAGS.has(flag)) return { ok: false, kind: "flags", message: flag };
  }
  // Die Freigabe gilt bewusst NUR fuer das Risiko-Veto. Syntax und Flags sind kein
  // Abwaegen, sondern schlicht nicht ausfuehrbar — da gaebe es nichts freizugeben.
  if (opts.allowRisky !== true) {
    const risk = assessPattern(draft.regex);
    if (!risk.ok) return { ok: false, kind: "risky", rule: risk.rule };
  }

  const flags = effectiveFlags(draft.flags);
  try {
    return { ok: true, re: new RegExp(draft.regex, flags) };
  } catch (err) {
    return { ok: false, kind: "syntax", message: err instanceof Error ? err.message : String(err) };
  }
}
