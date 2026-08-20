// Duenner Adapter ueber `makeRunState` aus obsidian-kit (src/vendor/kit/run-state.ts).
// Die Union und die sechs Uebergaenge liegen im Kit; hier stehen nur noch die beiden
// plugin-eigenen Entscheidungen (welche Phasen abbrechbar sind, was ein Phasenwechsel
// zuruecksetzt) und die repo-eigenen Arities. Genau so vom Kit vorgesehen
// (run-state.ts:65-68) — dadurch aendert sich an keiner der 17 Aufrufstellen eine Zeile.
import { makeRunState, type RunState as KitRunState } from "../../vendor/kit/run-state";

export type RunPhase = "reading" | "matching" | "writing" | "restoring";

/** Nutzlast waehrend des Laufs. */
type Running = { done: number; total: number; path: string };
/** Nutzlast des Ergebnisses. */
type Finished = { files: number; hits: number };

export type RunState = KitRunState<RunPhase, Running, Finished>;

/**
 * Regel 2: die Schreibphase ist der Punkt ohne Wiederkehr.
 *
 * Ein Abbruch mittendrin hinterlaesst einen halb ersetzten Vault — schlimmer als ein zu
 * Ende gefuehrter Lauf, den man mit einem Klick zurueckholen kann. `abortableIn` ist im
 * Kit zugleich der UI-Guard (`canAbort`) und der Uebergangs-Guard (`abort`), damit die
 * Regel nicht an zwei Orten steht und auseinanderlaufen kann.
 */
const run = makeRunState<RunPhase, Running, Finished>({
  abortableIn: (p) => p === "reading" || p === "matching",
  onPhaseChange: () => ({ done: 0, path: "" }),
});

/** Das Kit-Singleton wird weitergereicht, nicht neu gebaut: Identitaet ist Teil des
 *  Vertrags (`run-state.ts:106-109`), Renderer duerfen auf Referenzgleichheit pruefen. */
export const RUN_IDLE: RunState = run.IDLE;

export function runStarted(total: number): RunState {
  return run.begin("reading", { done: 0, total, path: "" });
}

export function runProgressed(prev: RunState, done: number, path: string): RunState {
  return run.progress(prev, { done, path });
}

export function runPhaseChanged(prev: RunState, phase: RunPhase): RunState {
  return run.progress(prev, { phase });
}

export function runFinished(prev: RunState, files: number, hits: number): RunState {
  return run.finish(prev, { files, hits });
}

/**
 * Ein Abbruch gilt nur aus einem laufenden, abbrechbaren Zustand heraus.
 *
 * Ohne die erste Schranke ueberschreibt ein spaeter eintreffender Abbruch ein bereits
 * gemeldetes Ergebnis — der Nutzer sieht „abgebrochen", obwohl alles geschrieben wurde.
 * Die zweite (die Phase) kam mit dem Kit dazu, s. `abortableIn` oben.
 */
export function runAborted(prev: RunState): RunState {
  return run.abort(prev);
}

/**
 * Ein Fehler NACH einem Abbruch oder nach dem Ergebnis ist eine Folge, kein eigener Befund.
 *
 * Abbrechen reisst den Lauf mitten heraus und erzeugt fast immer noch einen Fehler;
 * ohne diese Regel liest der Nutzer „fehlgeschlagen", obwohl er selbst gestoppt hat.
 */
export function runFailed(prev: RunState, message: string): RunState {
  return run.fail(prev, message);
}

/** Praedikat fuer den Abbrechen-Knopf — dasselbe, das `runAborted` benutzt. */
export function canAbort(state: RunState): boolean {
  return run.canAbort(state);
}
