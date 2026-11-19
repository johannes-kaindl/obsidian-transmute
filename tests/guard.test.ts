import { describe, expect, it } from "vitest";
import { compileRule } from "../src/core/regex/compile";
import { assessRegexRisk as assessPattern, type RegexRiskRule } from "../src/vendor/kit/user-regex";
import { STRINGS } from "../src/core/i18n/strings";

// Seit Welle 36 ist die Wache die des Kits (code-kit `user-regex`, `assessRegexRisk`); die Faelle der frueheren Eigenfassung bleiben hier als Gegenprobe unveraendert.
describe("assessPattern (Wache des Kits)", () => {
  it("erkennt verschachtelte Quantoren", () => {
    expect(assessPattern("(a+)+")).toEqual({ ok: false, rule: "nested-quantifier" });
    expect(assessPattern("(a*)*")).toEqual({ ok: false, rule: "nested-quantifier" });
    expect(assessPattern("(\\d+)+$")).toEqual({ ok: false, rule: "nested-quantifier" });
  });

  it("erkennt quantifizierte Alternation mit gleichen Zweigen", () => {
    expect(assessPattern("(a|a)+")).toEqual({ ok: false, rule: "quantified-alternation" });
    expect(assessPattern("(x|x)*")).toEqual({ ok: false, rule: "quantified-alternation" });
  });

  it("erkennt unbegrenzt wiederholte Backreference", () => {
    expect(assessPattern("(a)\\1+")).toEqual({ ok: false, rule: "unbounded-backreference" });
  });

  it("laesst realistische Muster durch", () => {
    expect(assessPattern("\\d{2}\\.\\d{2}\\.\\d{4}")).toEqual({ ok: true });
    expect(assessPattern("^#+ ")).toEqual({ ok: true });
    expect(assessPattern("\\[\\[([^\\]]+)\\]\\]")).toEqual({ ok: true });
    expect(assessPattern("(foo|bar)")).toEqual({ ok: true });
    expect(assessPattern("(foo|bar)+")).toEqual({ ok: true });
    expect(assessPattern("a+b+")).toEqual({ ok: true });
    expect(assessPattern("#\\w+/\\w+")).toEqual({ ok: true });
  });

  it("wertet escapte Klammern nicht als Gruppe", () => {
    expect(assessPattern("\\(a+\\)+")).toEqual({ ok: true });
  });
});

describe("zwei Regeln, die die Eigenfassung nicht kannte", () => {
  it("erkennt eine Alternative, die wie eine andere beginnt", () => {
    expect(assessPattern("(a|aa)+$")).toEqual({ ok: false, rule: "overlapping-alternation" });
    expect(assessPattern("(a|b|ab)*c")).toEqual({ ok: false, rule: "overlapping-alternation" });
  });

  it("erkennt dasselbe Zeichen zweimal hintereinander mit offenem Quantor", () => {
    expect(assessPattern(".*.*=.*")).toEqual({ ok: false, rule: "adjacent-quantifiers" });
    expect(assessPattern("\\d*\\d*x")).toEqual({ ok: false, rule: "adjacent-quantifiers" });
  });

  it("compileRule gibt beide als risky weiter, die Freigabe hebt sie auf", () => {
    for (const regex of ["(a|aa)+$", ".*.*=.*"]) {
      expect(compileRule({ regex, flags: "", replacement: "", explanation: "" })).toMatchObject({ ok: false, kind: "risky" });
      expect(compileRule({ regex, flags: "", replacement: "", explanation: "" }, { allowRisky: true }).ok).toBe(true);
    }
  });

  it("jede Regel hat Texte in beiden Sprachen (der Schluessel wird aus dem Namen der Regel gebildet)", () => {
    const rules: RegexRiskRule[] = [
      "nested-quantifier",
      "quantified-alternation",
      "unbounded-backreference",
      "overlapping-alternation",
      "adjacent-quantifiers",
    ];
    const dicts: Record<"en" | "de", Record<string, string>> = STRINGS;
    for (const rule of rules) {
      expect(dicts.en[`risk.${rule}`], `EN fehlt: ${rule}`).toBeTruthy();
      expect(dicts.de[`risk.${rule}`], `DE fehlt: ${rule}`).toBeTruthy();
    }
  });
});

describe("Flags: Pflichten des Plugins bleiben bei compileRule", () => {
  const rule = (flags: string) => ({ regex: "x", flags, replacement: "", explanation: "" });

  it("ein unbekanntes Zeichen wird gemeldet und nicht von effectiveFlags verschluckt", () => {
    expect(compileRule(rule("gz"))).toEqual({ ok: false, kind: "flags", message: "z" });
  });

  it("u zusammen mit v ist ein Flags-Fehler, kein Syntaxfehler mehr", () => {
    expect(compileRule(rule("uv"))).toMatchObject({ ok: false, kind: "flags" });
  });

  it("ein doppeltes Flag laeuft wie bisher (effectiveFlags bereinigt es)", () => {
    const res = compileRule(rule("ii"));
    expect(res.ok && res.re.flags).toBe("gi");
  });

  it("ein leeres Muster wird nicht zu (?:) kompiliert", () => {
    expect(compileRule({ regex: "", flags: "", replacement: "", explanation: "" })).toMatchObject({ ok: false, kind: "syntax" });
  });
});
