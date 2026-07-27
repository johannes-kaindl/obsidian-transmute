import type { Hit, RuleDraft, RuleProblem } from "../types";
import { compileRule, isMultilinePattern } from "./compile";
import { runRule } from "./execute";

export type EvalOptions = { budgetMs: number; now: () => number; maxHits: number };

export type EvalResult = { kind: "ok"; hits: Hit[]; timedOutAtLine: number | null } | RuleProblem;

/**
 * Kompilieren und Ausfuehren in einem Aufruf.
 *
 * Der eine Ort, an dem beides zusammenkommt — benutzt vom Modell-Pfad, von der
 * Handbearbeitung und von der Revalidierung vor dem Schreiben. Waeren es drei Stellen,
 * wuerde eine davon frueher oder spaeter mit anderen Regeln arbeiten als die anderen;
 * genau so ist in 0.2.0 die Anzeige von der Ausfuehrung abgedriftet.
 */
export function evaluate(rule: RuleDraft, text: string, allowRisky: boolean, opts: EvalOptions): EvalResult {
  const compiled = compileRule(rule, { allowRisky });
  if (!compiled.ok) {
    if (compiled.kind === "risky") return { kind: "risky", rule: compiled.rule };
    return { kind: compiled.kind, message: compiled.message };
  }

  const res = runRule(text, compiled.re, rule.replacement, isMultilinePattern(rule), opts);
  if (res.tooMany) return { kind: "too-many", limit: opts.maxHits };
  return { kind: "ok", hits: res.hits, timedOutAtLine: res.timedOutAtLine };
}
