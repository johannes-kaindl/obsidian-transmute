import { describe, expect, it } from "vitest";
import { buildSample, chooseSampleSource } from "../src/core/vault/sample";

describe("chooseSampleSource", () => {
  it("nimmt die offene Notiz, wenn sie zum Umfang gehoert", () => {
    expect(chooseSampleSource("b.md", ["a.md", "b.md"])).toEqual({ kind: "active", path: "b.md" });
  });

  it("uebergeht die offene Notiz, wenn der Filter sie ausschliesst", () => {
    expect(chooseSampleSource("z.md", ["a.md", "b.md"])).toEqual({
      kind: "candidates", paths: ["a.md", "b.md"],
    });
  });

  it("kommt ohne offene Notiz aus", () => {
    expect(chooseSampleSource(null, ["a.md"])).toEqual({ kind: "candidates", paths: ["a.md"] });
  });

  it("nimmt hoechstens so viele Notizen wie erlaubt", () => {
    const viele = ["a.md", "b.md", "c.md", "d.md"];
    expect(chooseSampleSource(null, viele, 2)).toEqual({ kind: "candidates", paths: ["a.md", "b.md"] });
  });

  it("meldet einen leeren Umfang als solchen", () => {
    expect(chooseSampleSource("a.md", [])).toEqual({ kind: "none" });
  });
});

describe("buildSample", () => {
  it("setzt jeder Notiz ihren Pfad voran", () => {
    const got = buildSample([{ path: "a.md", text: "eins" }, { path: "b.md", text: "zwei" }], 200);
    expect(got).toBe("--- a.md ---\neins\n\n--- b.md ---\nzwei");
  });

  it("hoert auf, bevor das Zeichenbudget reisst", () => {
    const got = buildSample(
      [{ path: "a.md", text: "x".repeat(50) }, { path: "b.md", text: "y".repeat(50) }],
      60,
    );
    expect(got).toContain("a.md");
    expect(got).not.toContain("b.md");
  });

  it("kuerzt eine einzelne zu lange Notiz, statt gar nichts zu liefern", () => {
    const got = buildSample([{ path: "a.md", text: "x".repeat(500) }], 60);
    expect(got.length).toBeLessThanOrEqual(60);
    expect(got).toContain("a.md");
  });

  it("liefert bei leerer Eingabe den leeren Text", () => {
    expect(buildSample([], 100)).toBe("");
  });
});
