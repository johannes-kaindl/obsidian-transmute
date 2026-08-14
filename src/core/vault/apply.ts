import type { Hit } from "../types";

/**
 * Ist das noch dieselbe Treffermenge?
 *
 * Geprueft wird das ERGEBNIS, nicht der Text: ein Linter, der beim Speichern `updated:`
 * ins Frontmatter schreibt, verschiebt jeden Offset, ohne dass sich fuer die Regel etwas
 * geaendert haette. Ein Textvergleich wuerde daraus faelschlich „die Notiz hat sich
 * geaendert" machen (Regression 0.2.0).
 */
export function sameHits(a: Hit[], b: Hit[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.start === y.start && x.end === y.end
      && x.matched === y.matched && x.replacement === y.replacement;
  });
}

/**
 * Ersetzt von hinten nach vorn.
 *
 * Jede Ersetzung veraendert die Laenge des Textes; wer von vorn arbeitet, macht mit dem
 * ersten Schnitt alle folgenden Offsets ungueltig.
 */
export function applyHitsToText(text: string, hits: Hit[], selected: boolean[]): string {
  const chosen = hits
    .filter((_, i) => selected[i] === true)
    .slice()
    .sort((a, b) => b.start - a.start);

  let out = text;
  for (const h of chosen) {
    out = out.slice(0, h.start) + h.replacement + out.slice(h.end);
  }
  return out;
}
