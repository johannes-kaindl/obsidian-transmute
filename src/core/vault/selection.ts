import type { FileHits } from "./run";

/**
 * Der Zustand des Dateihakens — ABGELEITET, nie gespeichert.
 *
 * Zwei parallel gepflegte Auswahlebenen laufen auseinander, sobald in einer aufgeklappten
 * Datei einzelne Treffer abgewaehlt werden. Wahrheit ist immer `selected` je Treffer.
 */
export type FileCheck = "all" | "none" | "some";

export function fileCheckState(file: FileHits): FileCheck {
  if (file.selected.length === 0) return "none";
  if (file.selected.every((s) => s)) return "all";
  if (file.selected.every((s) => !s)) return "none";
  return "some";
}

function replace(files: FileHits[], path: string, next: (f: FileHits) => FileHits): FileHits[] {
  return files.map((f) => (f.path === path ? next(f) : f));
}

export function toggleHit(files: FileHits[], path: string, index: number): FileHits[] {
  return replace(files, path, (f) => {
    if (!f.complete) return f;
    const selected = f.selected.map((s, i) => (i === index ? !s : s));
    return { ...f, selected };
  });
}

/** Teilweise gewaehlt zaehlt als „noch nicht ganz" → der Klick waehlt alles an. */
export function toggleFile(files: FileHits[], path: string): FileHits[] {
  return replace(files, path, (f) => {
    if (!f.complete) return f;
    const value = fileCheckState(f) !== "all";
    return { ...f, selected: f.selected.map(() => value) };
  });
}

export function setAllFiles(files: FileHits[], value: boolean): FileHits[] {
  return files.map((f) => (f.complete ? { ...f, selected: f.selected.map(() => value) } : f));
}

export function countSelected(files: FileHits[]): { files: number; hits: number } {
  let hits = 0;
  let touched = 0;
  for (const f of files) {
    const n = f.selected.filter((s) => s).length;
    if (n > 0) { touched += 1; hits += n; }
  }
  return { files: touched, hits };
}
