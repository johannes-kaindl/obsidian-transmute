import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, selectCandidates, type Candidate } from "../src/core/vault/scope";

const c = (path: string, tags: string[] = [], frontmatter: Record<string, unknown> = {}): Candidate =>
  ({ path, tags, frontmatter });

const ALL: Candidate[] = [
  c("10_Notizen/Projekt A.md", ["#projekt/aktiv"], { status: "aktiv" }),
  c("10_Notizen/tief/Projekt B.md", ["#projekt"], { status: "ruht" }),
  c("90_Archiv/Alt.md", ["#archiv"], { status: ["aktiv", "alt"] }),
  c("Lose.md"),
];

describe("selectCandidates", () => {
  it("nimmt ohne Filter alles", () => {
    expect(selectCandidates(ALL, EMPTY_FILTER)).toHaveLength(4);
  });

  it("filtert auf einen Ordner samt Unterordnern", () => {
    const got = selectCandidates(ALL, { ...EMPTY_FILTER, folder: "10_Notizen", includeSubfolders: true });
    expect(got).toEqual(["10_Notizen/Projekt A.md", "10_Notizen/tief/Projekt B.md"]);
  });

  it("laesst Unterordner weg, wenn der Schalter aus ist", () => {
    const got = selectCandidates(ALL, { ...EMPTY_FILTER, folder: "10_Notizen", includeSubfolders: false });
    expect(got).toEqual(["10_Notizen/Projekt A.md"]);
  });

  it("trifft mit einem Eltern-Tag auch verschachtelte Tags", () => {
    const got = selectCandidates(ALL, { ...EMPTY_FILTER, tag: "#projekt" });
    expect(got).toEqual(["10_Notizen/Projekt A.md", "10_Notizen/tief/Projekt B.md"]);
  });

  it("nimmt das Doppelkreuz im Filter auch ohne", () => {
    expect(selectCandidates(ALL, { ...EMPTY_FILTER, tag: "projekt" })).toHaveLength(2);
  });

  it("trifft ein Frontmatter-Feld auch, wenn der Wert eine Liste ist", () => {
    const got = selectCandidates(ALL, { ...EMPTY_FILTER, field: { key: "status", value: "aktiv" } });
    expect(got).toEqual(["10_Notizen/Projekt A.md", "90_Archiv/Alt.md"]);
  });

  it("verundet alle gesetzten Bedingungen", () => {
    const got = selectCandidates(ALL, {
      folder: "10_Notizen", includeSubfolders: true, tag: "#projekt",
      field: { key: "status", value: "ruht" },
    });
    expect(got).toEqual(["10_Notizen/tief/Projekt B.md"]);
  });

  it("liefert nichts, wenn nichts passt", () => {
    expect(selectCandidates(ALL, { ...EMPTY_FILTER, tag: "#gibtsnicht" })).toEqual([]);
  });
});
