import type { Hit } from "./types";

/**
 * Steht der Text, gegen den die Vorschau gerechnet wurde, noch unveraendert an derselben
 * Stelle?
 *
 * Die Treffer tragen Offsets in **den Text von damals**. Wird die Notiz zwischen Vorschau
 * und Anwenden bearbeitet, zeigen dieselben Offsets auf anderen Text — und das Anwenden
 * ersetzt stillschweigend die falschen Stellen. Das ist der einzige Weg, auf dem dieses
 * Plugin Daten zerstoeren kann, also wird davor geprueft statt gehofft.
 */
export function textUnchanged(documentText: string, baseOffset: number, previewed: string): boolean {
  return documentText.slice(baseOffset, baseOffset + previewed.length) === previewed;
}

/**
 * Wo steht der Ausschnitt jetzt? `null`, wenn er verschwunden oder mehrdeutig ist.
 *
 * Ein Vault ist kein stiller Ort: Linter-Plugins schreiben beim Speichern in das
 * Frontmatter, und schon verschiebt sich alles dahinter. Das ist keine Bearbeitung, die
 * einen Abbruch rechtfertigt — der Ausschnitt steht nur woanders.
 */
export function locateRegion(documentText: string, baseOffset: number, previewed: string): number | null {
  if (textUnchanged(documentText, baseOffset, previewed)) return baseOffset;

  const first = documentText.indexOf(previewed);
  if (first === -1) return null;
  // Mehrdeutig: kommt der Ausschnitt mehrfach vor, waere jede Wahl geraten.
  if (documentText.indexOf(previewed, first + 1) !== -1) return null;
  return first;
}

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
