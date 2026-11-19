import { compileUserRegex, type RegexRiskRule } from "../../vendor/kit/user-regex";
import type { RuleDraft } from "../types";

export type CompileResult =
  | { ok: true; re: RegExp }
  | { ok: false; kind: "risky"; rule: RegexRiskRule }
  | { ok: false; kind: "syntax"; message: string }
  | { ok: false; kind: "flags"; message: string };

/** Kanonische Reihenfolge, in der `RegExp.prototype.flags` die Flags ausgibt. */
const FLAG_ORDER = ["d", "g", "i", "m", "s", "u", "v", "y"];

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

/**
 * Kompiliert die Regel mit dem Baustein des Kits (code-kit `user-regex`: Flags, dann Risiko, dann Syntax) und den Flags von `effectiveFlags`.
 *
 * Was hier bleibt, ist die Pflicht des Plugins: `g` erzwingen und die Flags normalisieren (`effectiveFlags`). Die Normalisierung wirft unbekannte
 * Zeichen weg, deshalb prueft diese Funktion sie vorher selbst; sonst liefe `gz` als `g` durch.
 * Unterschiede zur frueheren Eigenfassung, alle vom Kit: ein doppeltes Flag ist nach `effectiveFlags` keins mehr; `u` zusammen mit `v` meldet jetzt
 * `flags` (frueher `syntax` mit dem Text der Engine); die Wache kennt zwei Regeln mehr (`overlapping-alternation`, `adjacent-quantifiers`) und liest
 * eine unbegrenzte Wiederholung irgendwo im Gruppenrumpf statt nur an seinem Ende. Ein leeres Muster meldet das Kit als eigene Antwort; es erreicht
 * diese Funktion nicht (Session und Antwort-Parser fangen es vorher), waere es so sonst `(?:)` und traefe ueberall.
 */
export function compileRule(draft: RuleDraft, opts: CompileOptions = {}): CompileResult {
  for (const flag of draft.flags) {
    if (!FLAG_ORDER.includes(flag)) return { ok: false, kind: "flags", message: flag };
  }
  // Die Freigabe gilt bewusst NUR fuer das Risiko-Veto (das Kit haelt das ebenso). Syntax und Flags sind kein
  // Abwaegen, sondern schlicht nicht ausfuehrbar — da gaebe es nichts freizugeben.
  const res = compileUserRegex(draft.regex, effectiveFlags(draft.flags), opts);
  if (res.ok) return res;
  if (res.kind === "empty") return { ok: false, kind: "syntax", message: "empty pattern" };
  return res;
}
