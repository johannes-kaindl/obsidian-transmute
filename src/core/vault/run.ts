import { evaluate, type EvalOptions } from "../regex/evaluate";
import type { Hit, RuleDraft, RuleProblem } from "../types";

/** Die Treffer EINER Datei. `selected` ist die einzige Wahrheit ueber die Auswahl. */
export type FileHits = {
  path: string;
  hits: Hit[];
  selected: boolean[];
  timedOutAtLine: number | null;
  /**
   * false = die Trefferliste ist unvollstaendig (Zeitbudget gerissen oder Obergrenze
   * erreicht). Solche Dateien starten vollstaendig abgewaehlt: was nicht vollstaendig
   * gemessen wurde, wird nicht geschrieben.
   */
  complete: boolean;
};

export type VaultRun = {
  files: FileHits[];
  totalHits: number;
  scanned: number;
  unreadable: string[];
  /** Ein Problem der REGEL selbst — betrifft jede Datei gleich, bricht den Lauf ab. */
  problem: RuleProblem | null;
  aborted: boolean;
};

/** Liefert den Inhalt oder null, wenn die Datei nicht (mehr) lesbar ist. */
export type ReadFile = (path: string) => Promise<string | null>;

export type RunOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, path: string) => void;
  /**
   * Echter Makrotask-Break. Ohne ihn wird der Klick auf „Abbrechen" nie zugestellt —
   * `cachedRead` loest oft aus dem Cache auf und erzeugt nur einen Mikrotask, der den
   * Renderer nicht zum Zeichnen kommen laesst.
   */
  yieldToUi?: () => Promise<void>;
  yieldEveryMs?: number;
  now?: () => number;
};

export async function runOverFiles(
  paths: string[],
  rule: RuleDraft,
  allowRisky: boolean,
  readFile: ReadFile,
  evalOpts: EvalOptions,
  opts: RunOptions = {},
): Promise<VaultRun> {
  const { signal, onProgress, yieldToUi, yieldEveryMs = 250, now = (): number => Date.now() } = opts;

  const files: FileHits[] = [];
  const unreadable: string[] = [];
  let totalHits = 0;
  let scanned = 0;
  let problem: RuleProblem | null = null;
  let aborted = false;

  // onProgress und yieldToUi haben je eine eigene Zeitschranke — ein Aufrufer, der nur
  // Fortschritt zeichnet, soll keine Makrotask-Pausen bezahlen.
  let lastProgress = now();
  let lastYield = now();

  for (const path of paths) {
    if (signal?.aborted === true) { aborted = true; break; }

    const text = await readFile(path);
    scanned += 1;
    if (text === null) { unreadable.push(path); continue; }

    const res = evaluate(rule, text, allowRisky, evalOpts);
    if (res.kind !== "ok") {
      // syntax/flags/risky treffen jede Datei gleich — einmal melden statt N-mal.
      // too-many ist dateibezogen: die Datei zaehlt als unvollstaendig gemessen.
      if (res.kind === "too-many") {
        files.push({ path, hits: [], selected: [], timedOutAtLine: null, complete: false });
        continue;
      }
      problem = res;
      break;
    }

    if (res.hits.length > 0 || res.timedOutAtLine !== null) {
      const complete = res.timedOutAtLine === null;
      files.push({
        path,
        hits: res.hits,
        selected: res.hits.map(() => complete),
        timedOutAtLine: res.timedOutAtLine,
        complete,
      });
      totalHits += res.hits.length;
    }

    const ts = now();
    if (onProgress !== undefined && ts - lastProgress >= yieldEveryMs) {
      lastProgress = ts;
      onProgress(scanned, paths.length, path);
    }
    if (yieldToUi !== undefined && ts - lastYield >= yieldEveryMs) {
      lastYield = ts;
      await yieldToUi();
    }
  }

  return { files, totalHits, scanned, unreadable, problem, aborted };
}
