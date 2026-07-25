import { describe, expect, it } from "vitest";
import { compileRule, effectiveFlags, isMultilinePattern } from "../src/core/regex/compile";
import type { RuleDraft } from "../src/core/types";

const draft = (over: Partial<RuleDraft>): RuleDraft => ({
  regex: "a", flags: "", replacement: "b", explanation: "", ...over,
});

describe("effectiveFlags", () => {
  // Die Anzeige muss zeigen, was WIRKLICH lief. Ein angezeigtes /x/i, das als /x/gi
  // ausgefuehrt wurde, ist fuer jemanden, der das Muster kopieren oder daraus lernen
  // will, schlicht falsch.
  it("ergaenzt g, weil compileRule es erzwingt", () => {
    expect(effectiveFlags("i")).toBe("gi");
    expect(effectiveFlags("")).toBe("g");
  });

  it("dupliziert ein vorhandenes g nicht", () => {
    expect(effectiveFlags("gi")).toBe("gi");
  });

  it("stimmt mit den Flags des kompilierten Musters ueberein", () => {
    const res = compileRule(draft({ regex: "x", flags: "i" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.re.flags).toBe(effectiveFlags("i"));
  });
});

describe("compileRule", () => {
  it("erzwingt das g-Flag, damit alle Treffer gefunden werden", () => {
    const res = compileRule(draft({ regex: "x", flags: "i" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.re.flags.split("").sort().join("")).toBe("gi");
  });

  it("dupliziert ein bereits vorhandenes g nicht", () => {
    const res = compileRule(draft({ regex: "x", flags: "g" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.re.flags).toBe("g");
  });

  it("lehnt riskante Muster ab, ohne sie zu kompilieren", () => {
    expect(compileRule(draft({ regex: "(a+)+" }))).toEqual({ ok: false, kind: "risky", rule: "nested-quantifier" });
  });

  it("meldet Syntaxfehler mit Text", () => {
    const res = compileRule(draft({ regex: "([a-" }));
    expect(res.ok).toBe(false);
    if (!res.ok && res.kind === "syntax") expect(res.message.length).toBeGreaterThan(0);
  });

  it("lehnt unbekannte Flags ab", () => {
    const res = compileRule(draft({ regex: "x", flags: "gz" }));
    expect(res).toMatchObject({ ok: false, kind: "flags" });
  });

  it("erkennt Mehrzeilen-Muster", () => {
    expect(isMultilinePattern(draft({ regex: "a", flags: "s" }))).toBe(true);
    expect(isMultilinePattern(draft({ regex: "a", flags: "m" }))).toBe(true);
    expect(isMultilinePattern(draft({ regex: "a\\nb", flags: "" }))).toBe(true);
    expect(isMultilinePattern(draft({ regex: "a", flags: "i" }))).toBe(false);
  });
});
