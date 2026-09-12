import { describe, expect, it } from "vitest";
import { removeNewlinesPreset } from "../src/core/presets/remove-newlines";
import { compileRule } from "../src/core/regex/compile";
import { runRule } from "../src/core/regex/execute";

const opts = { budgetMs: 1000, now: () => 0, maxHits: 500 };

/** Fuehrt das eingebaute Preset genau ueber den Produktionspfad aus (compile → runRule). */
function apply(text: string): string {
  const preset = removeNewlinesPreset();
  const compiled = compileRule({ regex: preset.regex, flags: preset.flags, replacement: "", explanation: "" }, { allowRisky: false });
  if (!compiled.ok) throw new Error("Preset-Muster kompiliert nicht");
  const res = runRule(text, compiled.re, preset.replacement, true, opts);
  let out = text;
  for (const h of [...res.hits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, h.start) + h.replacement + out.slice(h.end);
  }
  return out;
}

describe("removeNewlinesPreset", () => {
  it("fuegt weich umgebrochene Zeilen eines Absatzes zusammen", () => {
    const text = "Dies ist ein Satz,\nder umgebrochen wurde.\nUnd noch eine Zeile.";
    expect(apply(text)).toBe("Dies ist ein Satz, der umgebrochen wurde. Und noch eine Zeile.");
  });

  it("laesst Absatzgrenzen (Leerzeile) stehen", () => {
    const text = "Absatz eins hat\nzwei Zeilen.\n\nAbsatz zwei ist getrennt.";
    expect(apply(text)).toBe("Absatz eins hat zwei Zeilen.\n\nAbsatz zwei ist getrennt.");
  });

  it("trennt eine Ueberschrift nicht vom Text danach", () => {
    const text = "# Ueberschrift\nText direkt danach.";
    expect(apply(text)).toBe(text);
  });

  it("fuegt Listenpunkte nicht zusammen", () => {
    const text = "- Punkt eins\n- Punkt zwei";
    expect(apply(text)).toBe(text);
  });

  it("haengt Fliesstext nicht an eine folgende Liste an", () => {
    const text = "Text vor Liste\n- Punkt eins";
    expect(apply(text)).toBe(text);
  });

  it("laesst Zitatbloecke stehen", () => {
    const text = "> Zitat Zeile eins\n> Zeile zwei";
    expect(apply(text)).toBe(text);
  });

  it("laesst die Fence-Zeilen eines Codeblocks stehen", () => {
    const text = "```\ncode\n```";
    expect(apply(text)).toBe(text);
  });

  it("laesst nummerierte Listen stehen", () => {
    const text = "1. Erstens\n2. Zweitens";
    expect(apply(text)).toBe(text);
  });

  it("laesst Tabellenzeilen stehen", () => {
    const text = "| a | b |\n| - | - |";
    expect(apply(text)).toBe(text);
  });

  it("das Muster besteht den ReDoS-Guard (kein riskantes Pattern)", () => {
    const preset = removeNewlinesPreset();
    const compiled = compileRule({ regex: preset.regex, flags: preset.flags, replacement: "", explanation: "" }, { allowRisky: false });
    expect(compiled.ok).toBe(true);
  });
});
