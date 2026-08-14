// uebernommen aus apple-health/src/core/import-state.ts, 2026-08-14
// (Muster: Zustandsautomat fuer abbrechbare Langlaeufer; Phasen und Nutzlast sind hier
//  andere, die beiden tragenden Regeln sind dieselben.)

export type RunPhase = "reading" | "matching" | "writing" | "restoring";

export type RunState =
  | { status: "idle" }
  | { status: "running"; phase: RunPhase; done: number; total: number; path: string }
  | { status: "done"; files: number; hits: number }
  | { status: "aborted" }
  | { status: "failed"; message: string };

export const RUN_IDLE: RunState = { status: "idle" };

export function runStarted(total: number): RunState {
  return { status: "running", phase: "reading", done: 0, total, path: "" };
}

export function runProgressed(prev: RunState, done: number, path: string): RunState {
  if (prev.status !== "running") return prev;
  return { ...prev, done, path };
}

export function runPhaseChanged(prev: RunState, phase: RunPhase): RunState {
  if (prev.status !== "running") return prev;
  return { ...prev, phase, done: 0, path: "" };
}

export function runFinished(prev: RunState, files: number, hits: number): RunState {
  if (prev.status !== "running") return prev;
  return { status: "done", files, hits };
}

/**
 * Ein Abbruch gilt nur aus einem laufenden Zustand heraus.
 *
 * Ohne diese Schranke ueberschreibt ein spaeter eintreffender Abbruch ein bereits
 * gemeldetes Ergebnis — der Nutzer sieht „abgebrochen", obwohl alles geschrieben wurde.
 */
export function runAborted(prev: RunState): RunState {
  if (prev.status !== "running") return prev;
  return { status: "aborted" };
}

/**
 * Ein Fehler NACH einem Abbruch ist eine Folge des Abbruchs, kein eigener Befund.
 *
 * Abbrechen reisst den Lauf mitten heraus und erzeugt fast immer noch einen Fehler;
 * ohne diese Regel liest der Nutzer „fehlgeschlagen", obwohl er selbst gestoppt hat.
 */
export function runFailed(prev: RunState, message: string): RunState {
  if (prev.status === "aborted") return prev;
  return { status: "failed", message };
}

/**
 * Die Schreibphase ist der Punkt ohne Wiederkehr.
 *
 * Ein Abbruch mittendrin hinterlaesst einen halb ersetzten Vault — schlimmer als ein zu
 * Ende gefuehrter Lauf, den man mit einem Klick zurueckholen kann.
 */
export function canAbort(state: RunState): boolean {
  return state.status === "running" && (state.phase === "reading" || state.phase === "matching");
}
