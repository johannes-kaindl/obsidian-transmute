import type { Hit } from "./types";

/**
 * Wendet die ausgewaehlten Treffer an. Rueckwaerts, weil jede Ersetzung die Offsets aller
 * folgenden Treffer verschieben wuerde — der klassische Fehler an dieser Stelle.
 */
export function applyHits(text: string, hits: Hit[], selected: boolean[]): string {
  const chosen = hits
    .map((h, i) => ({ h, keep: selected[i] === true }))
    .filter((e) => e.keep)
    .map((e) => e.h)
    .sort((a, b) => b.start - a.start);

  let out = text;
  for (const h of chosen) {
    out = out.slice(0, h.start) + h.replacement + out.slice(h.end);
  }
  return out;
}
