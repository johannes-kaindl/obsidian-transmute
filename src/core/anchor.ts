import type { Hit } from "./types";

/**
 * Zeigen zwei Trefferlisten dieselben Ersetzungen?
 *
 * Positionen bleiben bewusst aussen vor: sie verschieben sich schon, wenn anderswo im
 * Dokument ein Zeichen dazukommt. Entscheidend ist, ob beim Anwenden noch dasselbe
 * passiert, was die Vorschau gezeigt hat.
 */
export function sameMatches(previewed: Hit[], current: Hit[]): boolean {
  return (
    previewed.length === current.length &&
    previewed.every(
      (hit, index) =>
        hit.matched === current[index].matched && hit.replacement === current[index].replacement,
    )
  );
}
