import type { RuleDraft } from "../types";
import { effectiveFlags } from "./compile";

/**
 * Laenge des Ausschnitts, auf dem geprobt wird.
 *
 * Muss klein genug sein, dass die Probe selbst nicht die Bombe ist: der Suchraum eines
 * verschachtelten Quantors waechst exponentiell mit der Eingabelaenge, bei 20 Zeichen
 * sind das rund eine Million Schritte (Millisekunden), bei 40 waeren es Billionen.
 */
export const PROBE_CHARS = 20;

export type ProbeOptions = { now: () => number; budgetMs: number };

export type ProbeResult =
  | { ok: true }
  | { ok: false; ms: number; sampleChars: number; longestLine: number };

/**
 * Kanarienvogel-Lauf vor einem freigegebenen Risiko-Muster.
 *
 * Obsidian erlaubt keine Web-Worker, ein laufender Match laesst sich also **nicht**
 * abbrechen — und das Zeitbudget in `runRule` greift nur zwischen Zeilen. Ein einzelner
 * entgleister Match auf EINER Zeile kommt nie zurueck und friert das Fenster ein (real
 * eingetreten, GUI-Durchlauf 2026-07-27).
 *
 * Deshalb wird vorher gemessen: dasselbe Muster laeuft auf einem kurzen Ausschnitt der
 * laengsten Zeile. Weil der Aufwand exponentiell mit der Laenge waechst, ist eine Probe,
 * die schon hier traege ist, auf der vollen Zeile praktisch endlos. Umgekehrt gilt das
 * nicht — ein Muster, das die Probe besteht, kann auf sehr viel laengeren Zeilen immer
 * noch entgleisen. Die Probe ist eine Bremse, keine Garantie.
 */
export function probeRisky(rule: RuleDraft, text: string, opts: ProbeOptions): ProbeResult {
  let re: RegExp;
  try {
    re = new RegExp(rule.regex, effectiveFlags(rule.flags));
  } catch {
    // Kaputte Syntax ist kein Laufzeit-Risiko — dafuer ist evaluate zustaendig.
    return { ok: true };
  }

  const lines = text.split("\n");
  let longestLine = 0;
  let longest = "";
  for (const line of lines) {
    if (line.length > longestLine) {
      longestLine = line.length;
      longest = line;
    }
  }

  const sample = longest.slice(0, PROBE_CHARS);
  const start = opts.now();
  re.lastIndex = 0;
  // Ein einzelner exec reicht: der teure Teil ist der erste erfolglose Match-Versuch.
  re.exec(sample);
  const ms = opts.now() - start;

  if (ms >= opts.budgetMs) {
    return { ok: false, ms, sampleChars: sample.length, longestLine };
  }
  return { ok: true };
}
