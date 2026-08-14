import { describe, expect, it } from "vitest";
import {
  canAbort, RUN_IDLE, runAborted, runFailed, runFinished, runPhaseChanged,
  runProgressed, runStarted,
} from "../src/core/vault/state";

describe("Lauf-Zustand", () => {
  it("startet in der Lesephase mit bekannter Gesamtzahl", () => {
    const s = runStarted(412);
    expect(s).toEqual({ status: "running", phase: "reading", done: 0, total: 412, path: "" });
  });

  it("zaehlt Fortschritt mit und merkt sich den Pfad", () => {
    const s = runProgressed(runStarted(412), 17, "a.md");
    expect(s).toMatchObject({ status: "running", done: 17, path: "a.md" });
  });

  it("ignoriert Fortschritt, wenn der Lauf nicht laeuft", () => {
    expect(runProgressed(RUN_IDLE, 5, "a.md")).toBe(RUN_IDLE);
  });

  it("wechselt die Phase und setzt den Zaehler zurueck", () => {
    const s = runPhaseChanged(runProgressed(runStarted(10), 10, "a.md"), "writing");
    expect(s).toMatchObject({ status: "running", phase: "writing", done: 0 });
  });

  it("ein Abbruch ueberlebt einen nachfolgenden Fehler", () => {
    const abgebrochen = runAborted(runStarted(10));
    expect(runFailed(abgebrochen, "stream kaputt")).toEqual({ status: "aborted" });
  });

  it("ein Abbruch ueberschreibt kein fertiges Ergebnis", () => {
    const fertig = runFinished(runStarted(10), 10, 40);
    expect(runAborted(fertig)).toBe(fertig);
  });

  it("erlaubt Abbruch beim Lesen und Rechnen", () => {
    expect(canAbort(runStarted(10))).toBe(true);
    expect(canAbort(runPhaseChanged(runStarted(10), "matching"))).toBe(true);
  });

  it("verweigert den Abbruch in der Schreibphase", () => {
    expect(canAbort(runPhaseChanged(runStarted(10), "writing"))).toBe(false);
    expect(canAbort(runPhaseChanged(runStarted(10), "restoring"))).toBe(false);
  });

  it("verweigert den Abbruch im Ruhezustand", () => {
    expect(canAbort(RUN_IDLE)).toBe(false);
  });
});
