import { describe, expect, it } from "vitest";
import { modelChoices } from "../src/core/reasoning-toggle";

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
