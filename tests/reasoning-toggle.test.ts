import { describe, expect, it } from "vitest";
import { effectiveSuppress, modelChoices, thinkToggleView } from "../src/core/reasoning-toggle";

describe("thinkToggleView", () => {
  it("zeigt an, wenn das Denken laeuft", () => {
    expect(thinkToggleView("qwen3.6-35b-a3b", false)).toEqual({
      labelKey: "view.thinkingOn", cls: "", disabled: false,
    });
  });

  it("zeigt an, wenn es unterdrueckt wird", () => {
    expect(thinkToggleView("qwen3.6-35b-a3b", true)).toEqual({
      labelKey: "view.thinkingOff", cls: "is-off", disabled: false,
    });
  });

  // Ein Schalter, der so tut, als koenne er ein always-on-Modell abstellen, luegt.
  it("sperrt den Schalter bei Modellen, die immer denken", () => {
    expect(thinkToggleView("gpt-oss-20b", true)).toEqual({
      labelKey: "view.thinkingAlways", cls: "is-disabled", disabled: true,
    });
  });
});

describe("effectiveSuppress", () => {
  it("bittet ein normales Modell, nicht zu denken", () => {
    expect(effectiveSuppress("qwen3.6-35b-a3b", true)).toBe(true);
  });

  it("bittet gar nicht erst, wo es nichts bringt", () => {
    expect(effectiveSuppress("gpt-oss-20b", true)).toBe(false);
  });
});

describe("modelChoices", () => {
  it("laesst eine passende Liste unveraendert", () => {
    expect(modelChoices(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  // Sonst waehlt die Anzeige stillschweigend ein anderes Modell aus.
  it("behaelt ein eingestelltes, aber nicht geladenes Modell vorn", () => {
    expect(modelChoices(["a", "b"], "weg")).toEqual(["weg", "a", "b"]);
  });

  it("ergaenzt nichts, wenn der Server entscheiden soll", () => {
    expect(modelChoices(["a"], "")).toEqual(["a"]);
  });
});
