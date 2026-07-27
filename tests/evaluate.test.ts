import { describe, expect, it } from "vitest";
import { evaluate } from "../src/core/regex/evaluate";
import type { RuleDraft } from "../src/core/types";

const opts = { budgetMs: 1000, now: () => 0, maxHits: 500 };
const rule = (regex: string, flags = "", replacement = "x"): RuleDraft => ({
  regex,
  flags,
  replacement,
  explanation: "",
});

describe("evaluate", () => {
  it("liefert Treffer bei einem gueltigen Muster", () => {
    const res = evaluate(rule("foo"), "foo und foo", false, opts);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.hits).toHaveLength(2);
  });

  it("meldet einen Syntaxfehler als Problem statt zu werfen", () => {
    const res = evaluate(rule("(unbalanced"), "text", false, opts);
    expect(res.kind).toBe("syntax");
  });

  it("meldet ein unbekanntes Flag", () => {
    const res = evaluate(rule("foo", "q"), "foo", false, opts);
    expect(res.kind).toBe("flags");
    if (res.kind === "flags") expect(res.message).toBe("q");
  });

  it("meldet ein riskantes Muster, solange es nicht freigegeben ist", () => {
    const res = evaluate(rule("(a+)+b"), "aaa", false, opts);
    expect(res.kind).toBe("risky");
  });

  it("fuehrt dasselbe Muster nach Freigabe aus", () => {
    const res = evaluate(rule("(a+)+b"), "aaab", true, opts);
    expect(res.kind).toBe("ok");
  });

  it("meldet zu viele Treffer mit der geltenden Grenze", () => {
    const res = evaluate(rule("a"), "aaaaaaaaaa", false, { ...opts, maxHits: 3 });
    expect(res.kind).toBe("too-many");
    if (res.kind === "too-many") expect(res.limit).toBe(3);
  });

  it("reicht die abgebrochene Zeile durch", () => {
    let clock = 0;
    const res = evaluate(rule("a"), "a\na\na", false, {
      ...opts,
      budgetMs: 0,
      now: () => (clock += 10),
    });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.timedOutAtLine).not.toBeNull();
  });

  it("erkennt ein Mehrzeilen-Muster am s-Flag", () => {
    const res = evaluate(rule("a.b", "s"), "a\nb", false, opts);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.hits).toHaveLength(1);
  });
});
