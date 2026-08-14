import { describe, expect, it } from "vitest";
import {
  countSelected, fileCheckState, setAllFiles, toggleFile, toggleHit,
} from "../src/core/vault/selection";
import type { FileHits } from "../src/core/vault/run";

const file = (path: string, selected: boolean[], complete = true): FileHits => ({
  path,
  hits: selected.map((_, i) => ({
    line: i, lineStart: 0, start: 0, end: 3, matched: "alt", replacement: "neu",
    before: "alt", after: "neu",
  })),
  selected,
  timedOutAtLine: null,
  complete,
});

describe("Auswahl ueber zwei Ebenen", () => {
  it("leitet den Dateihaken aus den Treffern ab", () => {
    expect(fileCheckState(file("a.md", [true, true]))).toBe("all");
    expect(fileCheckState(file("a.md", [false, false]))).toBe("none");
    expect(fileCheckState(file("a.md", [true, false]))).toBe("some");
  });

  it("nennt eine Datei ohne Treffer nicht angehakt", () => {
    expect(fileCheckState(file("a.md", []))).toBe("none");
  });

  it("dreht einen einzelnen Treffer um", () => {
    const got = toggleHit([file("a.md", [true, true])], "a.md", 1);
    expect(got[0].selected).toEqual([true, false]);
  });

  it("haekelt eine teilweise gewaehlte Datei ganz an", () => {
    const got = toggleFile([file("a.md", [true, false])], "a.md");
    expect(got[0].selected).toEqual([true, true]);
  });

  it("haekelt eine ganz gewaehlte Datei ab", () => {
    const got = toggleFile([file("a.md", [true, true])], "a.md");
    expect(got[0].selected).toEqual([false, false]);
  });

  it("laesst unvollstaendig gemessene Dateien abgewaehlt", () => {
    const got = toggleFile([file("a.md", [false, false], false)], "a.md");
    expect(got[0].selected).toEqual([false, false]);
  });

  it("uebergeht unvollstaendige Dateien auch bei alle-an", () => {
    const got = setAllFiles([file("a.md", [false], false), file("b.md", [false])], true);
    expect(got[0].selected).toEqual([false]);
    expect(got[1].selected).toEqual([true]);
  });

  it("zaehlt nur, was wirklich geschrieben wuerde", () => {
    const got = countSelected([file("a.md", [true, false]), file("b.md", [false])]);
    expect(got).toEqual({ files: 1, hits: 1 });
  });

  it("laesst die uebrigen Dateien unangetastet", () => {
    const vorher = [file("a.md", [true]), file("b.md", [true])];
    const got = toggleFile(vorher, "a.md");
    expect(got[1]).toBe(vorher[1]);
  });
});
