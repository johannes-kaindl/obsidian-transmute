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

  it("Differentialtest: byte-gleich zum alten Lookbehind-Muster auf einem Randfall-Korpus", () => {
    const preset = removeNewlinesPreset();
    // Das alte Muster (Stand 0.16.1), nur hier als Referenz; Node kennt Lookbehind.
    const blockStart = "(?:#{1,6}\\s|>|[-*+]\\s|\\d+\\.\\s|```|~~~|\\|)";
    const oldRe = new RegExp(`(?<=\\S)(?<!^${blockStart}[^\\n]*)\\n(?!\\n)(?!${blockStart})(?=\\S)`, "gm");
    const newRe = new RegExp(preset.regex, "gm");
    const corpus = [
      "", "\n", "a", "a\n", "\na", "a\nb", "a\nb\nc", "a\nb\nc\nd", "a\n\nb", "a\n\n\nb", "a \nb", "a\n b", " a\nb",
      "a\r\nb", "a\nb\r\nc", "# h\na\nb", "a\n# h\nb", "- x\ny", "x\n- y", "- x\n- y\nz", "-x\ny", "x\n-y", "- \nx",
      "1. a\nb\nc", "a\nb\n2. c", "10. a\nb", "1.a\nb", "> q\nr\ns", "a\n> q", "| a |\nb", "a\n| b |", "```\nx\ny\n```\nz",
      "a\n```\nb", "~~~\na\nb", "a\nb\n\n- l\nm\nn\n\nlast", "end\n", "a\nb\n", "a\n\n", "x\ty\nz", "\ta\nb", "a\t\nb", "-\na", "-\na\n", "#\nb", "1.\nb",
    ];
    // Zufalls-Korpus aus Bausteinen (fester Startwert, reproduzierbar): Anfang, nach Blockzeichen, Folgen, Ende.
    // Ohne nackte Marker ("-", "#" direkt vor dem Umbruch) und ohne \r / U+2028 mitten in der Zeile: dort wich das alte Muster
    // wegen \s = Umbruch bzw. ^ nach \r vom erkennbaren Zweck ab (siehe die beiden Tests darunter).
    const parts = ["a", "bb", " ", "\n", "\n", "\n\n", "# ", "- ", "* ", "+ ", "1. ", "12. ", "> ", "|", "```", "~~~", "\r\n", "\t", "x y"];
    let seed = 20260905;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 4000; i++) {
      let text = "";
      const n = 1 + Math.floor(next() * 14);
      for (let j = 0; j < n; j++) text += parts[Math.floor(next() * parts.length)];
      corpus.push(text);
    }
    for (const text of corpus) {
      expect(text.replace(newRe, "$1 "), JSON.stringify(text)).toBe(text.replace(oldRe, " "));
      // und ueber den Produktionspfad (compile → runRule → Treffer einsetzen)
      expect(apply(text), JSON.stringify(text)).toBe(text.replace(oldRe, " "));
    }
  });

  it("Differentialtest sieht einen Fehler: ein Muster ohne Zeilenanfang-Pruefung weicht ab", () => {
    const blockStart = "(?:#{1,6}\\s|>|[-*+]\\s|\\d+\\.\\s|```|~~~|\\|)";
    const oldRe = new RegExp(`(?<=\\S)(?<!^${blockStart}[^\\n]*)\\n(?!\\n)(?!${blockStart})(?=\\S)`, "gm");
    const wrong = new RegExp(`^([^\\n]*\\S)\\n(?!\\n)(?!${blockStart})(?=\\S)`, "gm");
    const text = "- Punkt\nFortsetzung";
    expect(text.replace(wrong, "$1 ")).not.toBe(text.replace(oldRe, " "));
  });

  it("bekannte Abweichung: ein nackter Marker vor dem Umbruch sperrt die uebernaechste Zeile nicht mehr", () => {
    // Altes Muster: \s im Marker frass den Umbruch, "-\na" galt als Listenzeile und sperrte "b".
    expect(apply("-\na\nb")).toBe("- a b");
  });
});
