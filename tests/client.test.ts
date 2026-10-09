import { describe, expect, it } from "vitest";
import { toCompleteResult, type ConnectionOutcome } from "../src/core/llm/client";

const ok = (over: Partial<Extract<ConnectionOutcome, { ok: true }>> = {}): ConnectionOutcome => ({
  ok: true, content: "hi", reasoning: "", truncated: false, ...over,
});
const fail = (over: Partial<Extract<ConnectionOutcome, { ok: false }>> = {}): ConnectionOutcome => ({
  ok: false, kind: "http", detail: "boom", ...over,
});

describe("toCompleteResult — Erfolg", () => {
  it("gibt Inhalt, leeres Denken als null und das Abgeschnitten-Flag weiter", () => {
    expect(toCompleteResult(ok(), false)).toEqual({ ok: true, content: "hi", reasoning: null, truncated: false });
  });

  it("traegt einen Gedankengang durch", () => {
    expect(toCompleteResult(ok({ reasoning: "laut gedacht" }), false)).toEqual({ ok: true, content: "hi", reasoning: "laut gedacht", truncated: false });
  });

  it("meldet einen verwertbaren Teiltext als Erfolg, markiert ihn aber als abgeschnitten", () => {
    expect(toCompleteResult(ok({ content: "{\"regex\":", truncated: true }), false)).toMatchObject({ ok: true, truncated: true });
  });

  it("meldet leeren Inhalt als Fehler statt als Erfolg", () => {
    expect(toCompleteResult(ok({ content: "  " }), false)).toEqual({ ok: false, error: "empty answer" });
  });

  it("meldet gesondert, wenn nur nachgedacht wurde", () => {
    const res = toCompleteResult(ok({ content: "", reasoning: "viel gedacht" }), false);
    expect(res).toMatchObject({ ok: false, thoughtOnly: true });
  });
});

describe("toCompleteResult — Fehler", () => {
  it("reicht die Servermeldung als Fehlertext durch", () => {
    expect(toCompleteResult(fail({ detail: "Unexpected endpoint" }), false)).toEqual({ ok: false, error: "Unexpected endpoint" });
  });

  it("markiert abgeschnitten UND leer gesondert, statt als 'leere Antwort' durchzufallen", () => {
    expect(toCompleteResult(fail({ kind: "truncated", detail: "length" }), false)).toMatchObject({ ok: false, truncatedEmpty: true });
  });
});

describe("toCompleteResult — Kurzbefehl", () => {
  it("ordnet den Grund der Bruecke ein (Status + JSON-Koerper)", () => {
    const body = JSON.stringify({ error: { message: "Kurzbefehl antwortet nicht", reason: "timeout" } });
    expect(toCompleteResult(fail({ status: 408, body, detail: "x" }), true))
      .toMatchObject({ ok: false, shortcutReason: "timeout", error: "Kurzbefehl antwortet nicht" });
  });

  it("faellt ohne Koerper auf den Status zurueck", () => {
    expect(toCompleteResult(fail({ status: 429, detail: "busy?" }), true)).toMatchObject({ shortcutReason: "busy" });
  });

  it("meldet eine fehlende Bruecke sichtbar als Kurzbefehl-Fehler", () => {
    expect(toCompleteResult(fail({ kind: "no-endpoint", detail: "requires transport shortcuts" }), true))
      .toMatchObject({ ok: false, shortcutReason: "error", error: "requires transport shortcuts" });
  });

  it("traegt bei einem normalen Endpunkt keinen Kurzbefehl-Grund", () => {
    const res = toCompleteResult(fail({ status: 408, detail: "timeout" }), false);
    expect("shortcutReason" in res).toBe(false);
  });
});
