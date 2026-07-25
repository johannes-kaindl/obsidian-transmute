/**
 * Statische ReDoS-Heuristik. Laeuft VOR dem ersten Match — in Obsidian gibt es keine
 * Web-Worker, ein laufender String.replace ist also nicht abbrechbar.
 *
 * Bewusst konservativ: ein False Positive lehnt eine brauchbare Regex ab und macht das
 * Plugin unbenutzbar. Die zweite Verteidigungslinie ist das Zeitbudget in execute.ts.
 */
import type { PatternRisk, RiskRule } from "./guard-types";

/** Gruppen-Oeffnungen, deren Klammer nicht escaped ist. */
function unescapedGroups(source: string): { start: number; body: string; end: number }[] {
  const out: { start: number; body: string; end: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "(") stack.push(i);
    else if (ch === ")") {
      const start = stack.pop();
      if (start !== undefined) out.push({ start, body: source.slice(start + 1, i), end: i });
    }
  }
  return out;
}

const QUANTIFIER = /^[*+]|^\{\d*,\d*\}|^\{\d+,\}/;

/** Endet der Gruppeninhalt selbst auf einem unbegrenzten Quantor? */
function bodyEndsUnbounded(body: string): boolean {
  const stripped = body.replace(/\\./g, "");
  return /[*+]$/.test(stripped) || /\{\d+,\}$/.test(stripped);
}

function branchesOverlap(body: string): boolean {
  const stripped = body.replace(/\\./g, " ");
  if (!stripped.includes("|")) return false;
  const branches = stripped.split("|").map((b) => b.trim());
  return new Set(branches).size < branches.length;
}

export function assessPattern(source: string): PatternRisk {
  for (const group of unescapedGroups(source)) {
    const after = source.slice(group.end + 1);
    const quantified = QUANTIFIER.test(after);
    if (!quantified) continue;
    if (bodyEndsUnbounded(group.body)) return { ok: false, rule: "nested-quantifier" };
    if (branchesOverlap(group.body)) return { ok: false, rule: "quantified-alternation" };
  }
  if (/\\[1-9]\s*[*+]|\\[1-9]\{\d+,\}/.test(source)) {
    return { ok: false, rule: "unbounded-backreference" };
  }
  return { ok: true };
}

export type { PatternRisk, RiskRule };
