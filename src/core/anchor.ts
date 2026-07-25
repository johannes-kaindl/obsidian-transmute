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
