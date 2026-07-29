import type { RuleDraft } from "../types";
import { evaluate, type EvalOptions } from "./evaluate";

export type ProbeKind = "ignore-case" | "no-anchors" | "no-boundaries" | "loose-space";

/** Ein Befund: diese eine Lockerung wuerde treffen. `line` ist null, wenn die
 *  Lockerung so oft trifft, dass die Ausfuehrung an der Obergrenze abbrach. */
export type ProbeFinding = { kind: ProbeKind; line: number | null };

/**
 * Ein Zeichen (oder Escape-Paar) ersetzen — aber nur ausserhalb von Zeichenklassen.
 *
 * `[\b]` ist ein Backspace, kein Wortgrenzen-Anker, und `[^abc]` beginnt nicht mit einem
 * Zeilenanker. Wer stumpf ersetzt, baut ein anderes Muster, als dasteht — und meldet
 * einen Befund ueber etwas, das die Nutzer:in nie geschrieben hat.
 */
function replaceOutsideClasses(pattern: string, needle: string, replacement: string): string {
  let out = "";
  let inClass = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      // Ein Escape-Paar wandert immer als Ganzes mit — es sei denn, es IST das Gesuchte.
      const pair = pattern.slice(i, i + 2);
      if (!inClass && needle.length === 2 && pair === needle) {
        out += replacement;
      } else {
        out += pair;
      }
      i += 2;
      continue;
    }
    if (!inClass && ch === "[") inClass = true;
    else if (inClass && ch === "]") inClass = false;
    else if (!inClass && needle.length === 1 && ch === needle) {
      out += replacement;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Fuehrenden Zeilenanfang und abschliessendes Zeilenende entfernen.
 *
 * Ein fuehrendes `^` kann nicht escaped sein — dann begaenne das Muster mit `\`. Ein
 * abschliessendes `$` schon (`\$` ist ein Dollarzeichen): eine ungerade Zahl davor
 * stehender Backslashes heisst, es gehoert zum Escape und bleibt.
 */
function stripAnchors(pattern: string): string {
  let out = pattern.startsWith("^") ? pattern.slice(1) : pattern;
  if (out.endsWith("$")) {
    let slashes = 0;
    for (let i = out.length - 2; i >= 0 && out[i] === "\\"; i--) slashes++;
    if (slashes % 2 === 0) out = out.slice(0, -1);
  }
  return out;
}

type Relaxation = { kind: ProbeKind; apply: (rule: RuleDraft) => RuleDraft };

/** Eine Lockerung entspannt genau eine Bedingung — und zwar an ALLEN ihren Vorkommen.
 *  Nur das erste zu lockern hiesse, den Befund davon abhaengig zu machen, welches
 *  Vorkommen zufaellig das stoerende war. */
const RELAXATIONS: readonly Relaxation[] = [
  {
    kind: "ignore-case",
    apply: (rule) => ({ ...rule, flags: rule.flags.includes("i") ? rule.flags : `${rule.flags}i` }),
  },
  { kind: "no-anchors", apply: (rule) => ({ ...rule, regex: stripAnchors(rule.regex) }) },
  { kind: "no-boundaries", apply: (rule) => ({ ...rule, regex: replaceOutsideClasses(rule.regex, "\\b", "") }) },
  { kind: "loose-space", apply: (rule) => ({ ...rule, regex: replaceOutsideClasses(rule.regex, " ", "\\s+") }) },
];

/**
 * Messen, warum ein Muster nichts trifft.
 *
 * Das Modell sieht den Text nur als Probe; eine Diagnose allein darauf kann behaupten,
 * im Text stehe nichts dergleichen, waehrend in Zeile 400 etwas steht. Deshalb wird
 * vorher gemessen — gegen den GANZEN Text. Trifft keine Sonde, ist „hier steht nichts
 * dergleichen" belegt statt geraten.
 *
 * Jede Sonde geht durch `evaluate()`, mit demselben Zeitbudget und derselben Obergrenze
 * wie der Normalpfad und ohne Risiko-Freigabe. Eine Lockerung, die das Muster kaputt
 * macht oder die der Guard ablehnt, meldet schlicht nichts: Der Schaden einer falsch
 * liegenden Sonde ist immer nur ein fehlender oder ein ueberfluessiger Befund — nie ein
 * falsches Ergebnis fuer die Nutzer:in.
 */
export function probeRelaxations(rule: RuleDraft, text: string, opts: EvalOptions): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  for (const relaxation of RELAXATIONS) {
    const variant = relaxation.apply(rule);
    // Aendert die Lockerung nichts, stuende als Befund „es traefe, wenn …", obwohl gar
    // nichts gelockert wurde.
    if (variant.regex === rule.regex && variant.flags === rule.flags) continue;

    const res = evaluate(variant, text, false, opts);
    if (res.kind === "too-many") {
      findings.push({ kind: relaxation.kind, line: null });
      continue;
    }
    if (res.kind === "ok" && res.hits.length > 0) {
      findings.push({ kind: relaxation.kind, line: res.hits[0].line });
    }
  }
  return findings;
}
