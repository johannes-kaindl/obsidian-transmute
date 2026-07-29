import { describe, expect, it } from "vitest";
import { probeRelaxations } from "../src/core/regex/relax";
import type { RuleDraft } from "../src/core/types";

const opts = { budgetMs: 1000, maxHits: 500, now: () => 0 };
const rule = (regex: string, flags = ""): RuleDraft => ({ regex, flags, replacement: "X", explanation: "" });

describe("probeRelaxations", () => {
  it("meldet, dass es ohne Beachtung der Gross-/Kleinschreibung traefe", () => {
    const found = probeRelaxations(rule("foo"), "zeile\nFOO hier", opts);
    expect(found).toEqual([{ kind: "ignore-case", line: 1 }]);
  });

  it("meldet, dass es ohne Anker traefe", () => {
    const found = probeRelaxations(rule("^foo"), "bar foo", opts);
    expect(found).toEqual([{ kind: "no-anchors", line: 0 }]);
  });

  it("entfernt ein abschliessendes $, aber nicht ein escaptes \\$", () => {
    // Das Muster sucht ein literales Dollarzeichen am Wortende — kein Anker.
    const found = probeRelaxations(rule("preis\\$"), "preis$ steht da", opts);
    expect(found.some((f) => f.kind === "no-anchors")).toBe(false);
  });

  it("meldet, dass es ohne Wortgrenzen traefe", () => {
    const found = probeRelaxations(rule("\\bfoo\\b"), "xfoox", opts);
    expect(found).toEqual([{ kind: "no-boundaries", line: 0 }]);
  });

  it("laesst \\b in einer Zeichenklasse stehen — dort ist es ein Backspace", () => {
    // Wuerde die Sonde stumpf ersetzen, entstuende [] — eine leere Klasse, die nie
    // trifft, und der Befund waere frei erfunden.
    const found = probeRelaxations(rule("[\\b]x"), "irgendwas", opts);
    expect(found.some((f) => f.kind === "no-boundaries")).toBe(false);
  });

  it("meldet, dass es mit mehreren Leerzeichen traefe", () => {
    const found = probeRelaxations(rule("a b"), "a    b", opts);
    expect(found).toEqual([{ kind: "loose-space", line: 0 }]);
  });

  it("lockert alle Vorkommen, nicht nur das erste", () => {
    const found = probeRelaxations(rule("a b c"), "a  b  c", opts);
    expect(found).toEqual([{ kind: "loose-space", line: 0 }]);
  });

  it("laeuft eine Sonde gar nicht erst, wenn sie nichts aendert", () => {
    // "foo" hat weder Anker noch Wortgrenze noch Leerzeichen; nur ignore-case bleibt.
    const found = probeRelaxations(rule("foo"), "FOO", opts);
    expect(found.map((f) => f.kind)).toEqual(["ignore-case"]);
  });

  it("meldet einen Fund ohne Zeilennummer, wenn die Lockerung zu oft trifft", () => {
    // Der Text ist so gewaehlt, dass NUR die Anker-Sonde anschlaegt: mit i traefe das
    // Muster immer noch nichts, ohne Anker dagegen in jeder Zeile.
    const many = { ...opts, maxHits: 2 };
    const found = probeRelaxations(rule("^a"), "xa\nxa\nxa\nxa", many);
    expect(found).toEqual([{ kind: "no-anchors", line: null }]);
  });

  it("meldet nichts, wenn keine Lockerung hilft", () => {
    expect(probeRelaxations(rule("^foo$"), "nichts dergleichen", opts)).toEqual([]);
  });

  it("meldet nichts, wenn die gelockerte Variante riskant wuerde", () => {
    // Der Guard lehnt verschachtelte Quantoren ab; die Sonde meldet dann schlicht nichts,
    // statt ein Muster auszufuehren, das eingefroren haette.
    const found = probeRelaxations(rule("^(a+)+b"), "aaaa", opts);
    expect(found).toEqual([]);
  });
});
