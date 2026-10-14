import { thinkToggleState } from "../vendor/kit/think-toggle";

/**
 * Die drei Zustaende des Thinking-Schalters, abgebildet auf die Schluessel und Klassen dieses Plugins.
 *
 * Die Entscheidung (`thinkToggleState`) kommt aus dem Kit; hier bleibt nur die Zuordnung auf `view.thinking*` und die
 * Zustandsklasse (der Zustand traegt Text UND Klasse, nicht nur Farbe). Der dritte Zustand ist der wichtige: Modelle wie
 * gpt-oss denken immer, egal was man einstellt. Ein Schalter, der so tut, als koenne er das abstellen, luegt.
 */
export type ThinkToggleView = {
  labelKey: "view.thinkingOn" | "view.thinkingOff" | "view.thinkingAlways";
  cls: "" | "is-off" | "is-disabled";
  disabled: boolean;
};

const VIEW = {
  on: { labelKey: "view.thinkingOn", cls: "" },
  off: { labelKey: "view.thinkingOff", cls: "is-off" },
  always: { labelKey: "view.thinkingAlways", cls: "is-disabled" },
} as const;

export function thinkToggleView(model: string, suppress: boolean): ThinkToggleView {
  const state = thinkToggleState(model, suppress);
  return { ...VIEW[state.mode], disabled: state.disabled };
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
