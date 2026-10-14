import { describe, expect, it } from "vitest";
import {
  hashText, restoreDecision, selectSnapshotsToDelete, snapshotDirName,
  type SnapshotEntry,
} from "../src/core/vault/snapshot";
import { utcCalendar } from "../src/vendor/kit/rotation";

/** Gemessen am 2026-10-14 und gegen den Kalender gelesen: 14.–8.10. (heute + 6 Tage), dann der aelteste je Woche
 *  (5.10., 28.9., 21.9.), der aelteste des Oktobers (1.10.), des Septembers (1.9.) und der des aeltesten Fensters (16.8.). */
const GOLDEN_60 = ["2026-10-14", "2026-10-13", "2026-10-12", "2026-10-11", "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-05", "2026-10-01", "2026-09-28", "2026-09-21", "2026-09-01", "2026-08-16"];

const entry = (afterHash: string | null): SnapshotEntry => ({ path: "a.md", hits: 2, afterHash });

describe("hashText", () => {
  it("ist stabil fuer denselben Text", () => {
    expect(hashText("hallo welt")).toBe(hashText("hallo welt"));
  });

  it("unterscheidet Texte", () => {
    expect(hashText("hallo welt")).not.toBe(hashText("hallo Welt"));
  });

  it("unterscheidet Texte gleicher Laenge", () => {
    expect(hashText("ab")).not.toBe(hashText("ba"));
  });

  it("kommt mit dem leeren Text zurecht", () => {
    expect(hashText("")).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
  });

  it("traegt die Laenge im Schluessel, damit Kollisionen praktisch ausfallen", () => {
    expect(hashText("abc").split("-")[0]).toBe("3");
  });
});

describe("snapshotDirName", () => {
  it("macht aus einem Zeitstempel einen dateisystemtauglichen Namen (UTC, mit Millisekunden)", () => {
    expect(snapshotDirName("2026-08-14T17:02:11.123Z")).toBe("2026-08-14T17-02-11-123Z");
  });
});

describe("selectSnapshotsToDelete (Kit-GFS)", () => {
  const NOW = Date.UTC(2026, 9, 14, 13, 0, 0);
  const DAY = 86_400_000;
  // Ein Snapshot je Tag um 12:00 UTC, 60 Tage zurueck; die aelteren in der Schreibweise vor 0.14 (ohne Millisekunden).
  const tage = Array.from({ length: 60 }, (_, i) => {
    const time = Date.UTC(2026, 9, 14, 12, 0, 0) - i * DAY;
    return { time, name: i >= 30 ? snapshotDirName(new Date(time).toISOString()).replace(/-000Z$/, "") : snapshotDirName(new Date(time).toISOString()) };
  });

  it("Golden-Tabelle 60 Tage: GFS behaelt heute, die letzten 7 Tage, 4 Wochen und 6 Monate — die uebrigen weichen", () => {
    const drop = selectSnapshotsToDelete(tage.map((t) => t.name), NOW, utcCalendar);
    const kept = tage.filter((t) => !drop.includes(t.name)).map((t) => new Date(t.time).toISOString().slice(0, 10));
    expect(kept).toEqual(GOLDEN_60);
  });

  it("behaelt den juengsten Snapshot immer — das Rueckgaengigmachen haengt an ihm", () => {
    const drop = selectSnapshotsToDelete(tage.map((t) => t.name), NOW + 400 * DAY, utcCalendar);
    expect(drop).not.toContain(tage[0]!.name);
  });

  it("liest alte und neue Schreibweise mit demselben Namenspaar", () => {
    const alt = "2026-08-14T17-02-11";
    const neu = "2026-08-14T17-02-12-000Z";
    expect(selectSnapshotsToDelete([alt, neu], Date.UTC(2026, 7, 14, 18, 0, 0), utcCalendar)).toEqual([]);
  });

  it("loescht nie einen Ordner, dessen Name keine Zeit traegt", () => {
    expect(selectSnapshotsToDelete(["fremd", "notizen-2025"], NOW, utcCalendar)).toEqual([]);
  });
});

describe("restoreDecision", () => {
  it("stellt her, wenn der Inhalt noch der geschriebene ist", () => {
    const text = "neu neu";
    expect(restoreDecision(entry(hashText(text)), text)).toBe("restore");
  });

  it("meldet eine seither bearbeitete Datei", () => {
    expect(restoreDecision(entry(hashText("neu neu")), "neu neu und mehr")).toBe("changed");
  });

  it("meldet eine verschwundene Datei", () => {
    expect(restoreDecision(entry(hashText("neu")), null)).toBe("gone");
  });

  it("meldet einen ungepruefbaren Eintrag, statt blind herzustellen", () => {
    expect(restoreDecision(entry(null), "irgendwas")).toBe("unverified");
  });
});
