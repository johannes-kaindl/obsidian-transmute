/**
 * Die anzuzeigende Modell-Liste.
 *
 * Ein eingestelltes, aber gerade nicht geladenes Modell bleibt als erster Eintrag
 * stehen — sonst waehlt die Anzeige stillschweigend ein anderes aus, und man merkt es
 * erst am Ergebnis. (Muster aus image-to-markdown, `refreshModels`.)
 */
export function modelChoices(models: string[], current: string): string[] {
  if (current.length === 0 || models.includes(current)) return models;
  return [current, ...models];
}
