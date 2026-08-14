import { describe, expect, it } from "vitest";
import {
  hashText, restoreDecision, selectSnapshotsToDelete, snapshotDirName,
  type SnapshotEntry,
} from "../src/core/vault/snapshot";

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
  it("macht aus einem Zeitstempel einen dateisystemtauglichen Namen", () => {
    expect(snapshotDirName("2026-08-14T17:02:11.123Z")).toBe("2026-08-14T17-02-11");
  });
});

describe("selectSnapshotsToDelete", () => {
  it("behaelt die juengsten und nennt den Rest", () => {
    const da = ["2026-08-10T09-00-00", "2026-08-14T17-02-11", "2026-08-12T08-00-00"];
    expect(selectSnapshotsToDelete(da, 2)).toEqual(["2026-08-10T09-00-00"]);
  });

  it("loescht nichts, solange Platz ist", () => {
    expect(selectSnapshotsToDelete(["2026-08-14T17-02-11"], 5)).toEqual([]);
  });

  it("behaelt bei keep=0 nichts", () => {
    expect(selectSnapshotsToDelete(["a", "b"], 0)).toHaveLength(2);
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
