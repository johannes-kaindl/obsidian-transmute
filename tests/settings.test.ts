import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/core/settings";
import { statusKindKey } from "../src/core/settings/endpoint-editor-model";
import { STRINGS } from "../src/core/i18n/strings";

describe("loadSettings", () => {
  it("fuellt fehlende Felder aus den Defaults", () => {
    expect(loadSettings({ model: "x" }).budgetMs).toBe(DEFAULT_SETTINGS.budgetMs);
  });

  it("startet ohne hartkodiertes Modell (Modellagnostik)", () => {
    expect(DEFAULT_SETTINGS.model).toBe("");
  });

  it("bringt Schwelle und Snapshot-Anzahl als Vorgabe mit", () => {
    expect(DEFAULT_SETTINGS.confirmThreshold).toBe(50);
    expect(DEFAULT_SETTINGS.snapshotKeep).toBe(5);
  });

  it("ergaenzt die neuen Felder in einer alten data.json", () => {
    const geladen = loadSettings({ endpoints: [{ url: "http://x" }], model: "" });
    expect(geladen.confirmThreshold).toBe(50);
    expect(geladen.snapshotKeep).toBe(5);
  });
});

describe("i18n", () => {
  it("hat fuer jeden EN-Key einen DE-Key", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it("liefert Statuskeys statt des hart deutschen Kit-Klartexts", () => {
    expect(statusKindKey("ok")).toMatch(/^status\./);
  });
});
