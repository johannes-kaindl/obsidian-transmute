import { describe, it, expect } from "vitest";
import { loadSettings, DEFAULT_SETTINGS } from "../src/core/settings";

describe("loadSettings — Endpunkt-Migration", () => {
  it("alte String-Liste aus data.json wird zu Configs", () => {
    const out = loadSettings({ endpoints: ["http://127.0.0.1:1234", "http://192.168.1.5:1234"] });
    expect(out.endpoints).toEqual([
      { url: "http://127.0.0.1:1234" },
      { url: "http://192.168.1.5:1234" },
    ]);
  });

  it("bereits migrierte Configs bleiben unverändert, inklusive Schlüssel", () => {
    const eps = [{ url: "https://openrouter.ai/api", apiKey: "sk-x" }];
    expect(loadSettings({ endpoints: eps }).endpoints).toEqual(eps);
  });

  it("fehlendes Feld fällt auf den Default zurück", () => {
    expect(loadSettings({}).endpoints).toEqual(DEFAULT_SETTINGS.endpoints);
  });

  it("leere Einträge fliegen raus, statt als tote Zeile zu überleben", () => {
    expect(loadSettings({ endpoints: ["", "  ", "http://a:1234"] }).endpoints)
      .toEqual([{ url: "http://a:1234" }]);
  });
});
