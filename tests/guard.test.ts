import { describe, expect, it } from "vitest";
import { assessPattern } from "../src/core/regex/guard";

describe("assessPattern", () => {
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
