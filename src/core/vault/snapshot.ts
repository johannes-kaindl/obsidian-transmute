import { selectGfsRetention, stampedName, timeFromStampedName, localCalendar, type GfsCalendar } from "../../vendor/kit/rotation";
import type { RuleDraft } from "../types";

export type SnapshotEntry = {
  path: string;
  hits: number;
  /**
   * Hash des GESCHRIEBENEN Inhalts — die Grundlage der Rueckhol-Entscheidung.
   *
   * null, solange der Schreiblauf laeuft: das Manifest entsteht VOR der ersten Aenderung
   * (sonst waere ein Absturz mitten im Lauf nicht rueckholbar) und wird danach mit den
   * Hashes nachgezogen. Ein Eintrag, der null geblieben ist, wird nicht blind hergestellt.
   */
  afterHash: string | null;
};

export type SnapshotManifest = {
  /** ISO-Zeitstempel der Anwendung. */
  at: string;
  rule: RuleDraft;
  files: SnapshotEntry[];
};

/**
 * FNV-1a (32 bit), dem die Textlaenge vorangestellt ist.
 *
 * `crypto` scheidet aus (`no-nodejs-modules`), und `crypto.subtle` waere asynchron fuer
 * eine Frage, die synchron beantwortbar sein soll. Die vorangestellte Laenge drueckt die
 * Kollisionswahrscheinlichkeit fuer echte Bearbeitungen praktisch auf null: zwei Texte
 * muessten gleich lang sein UND denselben 32-bit-Hash haben.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(16)}-${h.toString(16).padStart(8, "0")}`;
}

/** Name des Snapshot-Ordners: der Zeitstempel der Anwendung (UTC, mit Millisekunden), Doppelpunkte ersetzt
 *  (auf Windows kein gueltiger Pfadbestandteil). Die Zeit steht im Namen, nicht im mtime: ein Sync setzt mtimes neu. */
export function snapshotDirName(at: string): string {
  return stampedName(Date.parse(at));
}

/**
 * Welche Snapshot-Ordner weichen muessen (Grossvater-Vater-Sohn, Kit `selectGfsRetention`).
 *
 * Der juengste Snapshot bleibt immer: das Rueckgaengigmachen der letzten Anwendung haengt an ihm.
 * Ordner, deren Name keine Zeit traegt, werden nie geloescht („unbekannt heisst behalten“). Aeltere Ordner
 * (vor 0.14) tragen den Zeitstempel ohne Millisekunden; `-000Z` ergaenzt sie, damit dasselbe Namenspaar sie liest.
 */
export function selectSnapshotsToDelete(existing: string[], now: number, calendar: GfsCalendar = localCalendar): string[] {
  const entries = existing.flatMap((name) => {
    const time = timeFromStampedName(name) ?? timeFromStampedName(`${name}-000Z`);
    return time === null ? [] : [{ name, time }];
  });
  return selectGfsRetention(entries, now, { keepNewest: true, calendar }).drop;
}

/**
 * Darf zurueckgeschrieben werden?
 *
 * Nur wenn die Datei noch genau das enthaelt, was dieser Lauf hineingeschrieben hat.
 * Alles andere waere ein stiller Verlust fremder Arbeit.
 */
export function restoreDecision(
  entry: SnapshotEntry,
  currentText: string | null,
): "restore" | "changed" | "gone" | "unverified" {
  if (currentText === null) return "gone";
  if (entry.afterHash === null) return "unverified";
  return hashText(currentText) === entry.afterHash ? "restore" : "changed";
}
