import { isAlwaysOnThinker } from "../vendor/kit/reasoning";

/**
 * Die drei Zustaende des Thinking-Schalters.
 *
 * Uebernommen aus image-to-markdown, `src/reasoning_toggle.ts` — dort ist es das
 * 2. Exemplar desselben Musters (pures Praedikat, das die UI nur noch abbildet). Der
 * dritte Zustand ist der wichtige: Modelle wie gpt-oss denken immer, egal was man
 * einstellt. Ein Schalter, der so tut, als koenne er das abstellen, luegt.
 */
export type ThinkToggleView = {
  labelKey: "view.thinkingOn" | "view.thinkingOff" | "view.thinkingAlways";
  cls: "" | "is-off" | "is-disabled";
  disabled: boolean;
};

export function thinkToggleView(model: string, suppress: boolean): ThinkToggleView {
  if (isAlwaysOnThinker(model)) return { labelKey: "view.thinkingAlways", cls: "is-disabled", disabled: true };
  if (suppress) return { labelKey: "view.thinkingOff", cls: "is-off", disabled: false };
  return { labelKey: "view.thinkingOn", cls: "", disabled: false };
}

/** Was tatsaechlich an den Server geht — ein always-on-Modell laesst sich nicht bitten. */
export function effectiveSuppress(model: string, suppress: boolean): boolean {
  return suppress && !isAlwaysOnThinker(model);
}

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
