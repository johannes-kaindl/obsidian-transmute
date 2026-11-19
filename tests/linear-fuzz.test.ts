/**
 * Linearität der Funktionen, die Modellantwort oder ein fremdes Muster zerlegen (ReDoS-Konvention, CORE-TEST-26 (b)): der erschöpfende Fuzz
 * `pruefeLinearFuzz` aus dem Kit-Testmodul. Gemessen wird ein Quotient t(50 000)/t(10 000), keine Millisekunden.
 *
 * Geprüft sind die Wege, auf denen fremder Text ankommt: die Antwort des Modells (`parseRuleResponse`, `parseDiagnoseResponse`), das Muster selbst
 * beim Kompilieren samt Risikowache (`compileRule`) und das Umschreiben des Musters für die Sonden (`probeRelaxations`: Anker, Wortgrenzen, Leerzeichen).
 * Nicht Gegenstand: das AUSFÜHREN eines Nutzermusters gegen den Text. Es ist je Muster beliebig teuer (`(a+)+b`) und hängt an Frist und Risikowache
 * (`tests/probe.test.ts`, `tests/execute.test.ts`), nicht an einer Linearitätsgrenze.
 * Die Gegenprobe (eine absichtlich quadratische Fassung wird rot) steht am Ende der Datei.
 */
import { describe, expect, it } from "vitest";
import { pruefeLinearFuzz } from "./vendor/kit/linear-probe";
import { parseDiagnoseResponse, parseRuleResponse } from "../src/core/llm/response";
import { compileRule } from "../src/core/regex/compile";
import { probeRelaxations } from "../src/core/regex/relax";

const FUZZ_MS = 180_000;

/** Befund als lesbarer Text, damit eine rote Zeile ohne Nachlesen verständlich ist (CORE-TEST-14). */
const befund = (r: { verdaechtig: ReadonlyArray<{ message: string }> }): string => r.verdaechtig.map((v) => v.message).join("\n");

describe("Modellantwort lesen", () => {
  const alphabet = ["<think>", "</think>", "```json\n", "```", "{", "}", '"regex":', '"', ",", ":", "\\", "\n", " ", "a"];

  it("parseRuleResponse: Fuzz über Denk-Tags, Zäune, JSON-Zeichen und Schlüsselwörter", () => {
    const f = pruefeLinearFuzz((s) => parseRuleResponse(s), { alphabet, maxLaenge: 2 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);

  it("parseDiagnoseResponse: Fuzz über dieselben Zeichen", () => {
    const f = pruefeLinearFuzz((s) => parseDiagnoseResponse(s), { alphabet, maxLaenge: 2 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);
});

describe("Muster kompilieren und für Sonden umschreiben", () => {
  const MUSTER = ["(", ")", "(?:", "+", "*", "?", "|", "a", "\\", "\\b", "[", "]", "^", "$", " ", "{1,}"];

  it("compileRule: Fuzz über Gruppen, Quantoren, Alternativen, Klassen und Escapes", () => {
    const f = pruefeLinearFuzz((s) => compileRule({ regex: s, flags: "", replacement: "", explanation: "" }, { allowRisky: false }), { alphabet: MUSTER, maxLaenge: 2 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);

  it("probeRelaxations: Fuzz über Anker, Wortgrenzen, Klassen, Escapes und Leerzeichen (gegen einen kurzen Text)", () => {
    // Ein Muster, das beim Ausführen teuer wäre, scheidet an der Risikowache aus (ohne Freigabe); gemessen wird das Umschreiben und die Wache.
    const opts = { budgetMs: 50, now: () => Date.now(), maxHits: 100 };
    const f = pruefeLinearFuzz((s) => probeRelaxations({ regex: s, flags: "", replacement: "", explanation: "" }, "ein kurzer Text\nzweite Zeile", opts), {
      // Klassen als ganze Einträge mit Inhalt: die Einheit `[]` (leere Klasse, wiederholt) misst nicht das Plugin, sondern V8 — dessen Kompilierung mit dem Flag `i`
      // kostet je leerer Klasse rund 57 µs (`new RegExp("[]".repeat(20000), "gi").exec(…)` 1,1 s, ohne `i` 0,4 ms). Gemessen Welle 36; kein Plugin-Pfad, kein Muster, das jemand schreibt.
      alphabet: ["^", "$", "\\b", "\\", "[a]", "[ ]", "[\\b]", " ", "a", "\\ "],
      maxLaenge: 2,
    });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);
});

describe("Gegenprobe: der Fuzz kann rot werden (CORE-TEST-01)", () => {
  /** Absichtlich quadratisch: ein Zeilen-Scan, der für jede Zeile den Rest des Texts neu zerlegt. */
  const quadratisch = (text: string): number => {
    let c = 0;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") c += text.slice(i).split("\n").length;
    return c;
  };

  it("pruefeLinearFuzz meldet die quadratische Fassung als Verdacht", () => {
    const f = pruefeLinearFuzz(quadratisch, { alphabet: ["\n", "x"], maxLaenge: 1, verschachtelt: false });
    expect(f.linear).toBe(false);
    expect(f.verdaechtig.map((v) => v.einheit)).toContain("\n");
  }, FUZZ_MS);
});
