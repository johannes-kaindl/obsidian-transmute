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

describe("loadSettings — Endpunkt-Wahl (choice)", () => {
  it("Default ist eine leere Wahl", () => {
    expect(loadSettings({}).choice).toEqual({});
  });
  it("behaelt endpointId und model", () => {
    expect(loadSettings({ choice: { endpointId: "e1", model: "m" } }).choice).toEqual({ endpointId: "e1", model: "m" });
  });
  it("verwirft Fremdfelder und Nicht-Objekte", () => {
    expect(loadSettings({ choice: { endpointId: "e1", boese: 1 } }).choice).toEqual({ endpointId: "e1" });
    expect(loadSettings({ choice: "quatsch" }).choice).toEqual({});
  });
});

describe("loadSettings — Anfrage-Block (request)", () => {
  it("Default ist ein frischer Block, kein geteiltes Objekt", () => {
    const a = loadSettings({}).request;
    expect(a).toEqual({ overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false });
    a.thinking.structured = "high";
    expect(loadSettings({}).request.thinking).toEqual({});
    expect(DEFAULT_SETTINGS.request.thinking).toEqual({});
  });

  it("behaelt gueltige Werte und verwirft ungueltige", () => {
    const out = loadSettings({ request: { thinking: { structured: "low", agent: "wild" }, overrides: { structured: { unknown: { temperature: 0.3, top_p: 5 } } } } }).request;
    expect(out.thinking).toEqual({ structured: "low" });
    expect(out.overrides.structured?.unknown).toEqual({ temperature: 0.3 });
  });

  it("suppressReasoning: false wird zur Denkstufe des Modus structured", () => {
    expect(loadSettings({ suppressReasoning: false }).request.thinking.structured).toBe("low");
  });

  it("suppressReasoning: true bleibt beim Default (aus)", () => {
    expect(loadSettings({ suppressReasoning: true }).request.thinking).toEqual({});
  });

  it("eine ausdrueckliche Stufe des Nutzers gewinnt gegen die alte Einstellung", () => {
    expect(loadSettings({ suppressReasoning: false, request: { thinking: { structured: "high" } } }).request.thinking.structured).toBe("high");
  });

  it("nimmt die abgeloesten Schluessel nicht ins Ergebnis mit", () => {
    const out = loadSettings({ suppressReasoning: false, timeoutMs: 5000 }) as Record<string, unknown>;
    expect("suppressReasoning" in out).toBe(false);
    expect("timeoutMs" in out).toBe(false);
  });
});

describe("loadSettings — globales Modell abgeloest (Welle 17)", () => {
  const row = (extra: object = {}) => ({ url: "http://127.0.0.1:1234", ...extra });

  it("erster Lauf: Altwert wandert in die Zeilen ohne Modell, der Altschluessel verschwindet", () => {
    const out = loadSettings({ endpoints: [row(), row({ url: "http://b:1" })], model: "alt-modell" });
    expect(out.endpoints.map((e) => e.model)).toEqual(["alt-modell", "alt-modell"]);
    expect("model" in out).toBe(false);
  });

  it("zweiter Lauf aendert nichts: eine vom Nutzer geleerte Zeile bleibt leer", () => {
    const first = loadSettings({ endpoints: [row()], model: "alt-modell" });
    first.endpoints[0] = { ...first.endpoints[0]!, model: "" };
    const second = loadSettings(JSON.parse(JSON.stringify(first)));
    expect(second.endpoints[0]!.model ?? "").toBe("");
    expect("model" in second).toBe(false);
  });

  it("eine Zeile mit eigenem Modell bleibt unveraendert", () => {
    const out = loadSettings({ endpoints: [row({ model: "eigen" }), row({ url: "http://b:1" })], model: "alt-modell" });
    expect(out.endpoints.map((e) => e.model)).toEqual(["eigen", "alt-modell"]);
  });

  it("ohne Altwert bleiben die Zeilen unberuehrt", () => {
    expect(loadSettings({ endpoints: [row()] }).endpoints).toEqual([row()]);
  });

  it("Default-Einstellungen tragen kein globales Modell mehr", () => {
    expect("model" in DEFAULT_SETTINGS).toBe(false);
  });
});
