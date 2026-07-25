import { describe, expect, it } from "vitest";
import { buildInitialPrompt, buildRefinePrompt, buildRetryPrompt, sampleForPrompt, sampleHits } from "../src/core/llm/prompt";
import type { Hit } from "../src/core/types";

const hit = (before: string, after: string): Hit => ({
  line: 0, lineStart: 0, start: 0, end: 1, matched: "x", replacement: "y", before, after,
});

describe("sampleForPrompt", () => {
  it("kuerzt lange Texte und markiert die Kuerzung", () => {
    const out = sampleForPrompt("x".repeat(500), 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain("…");
  });

  it("laesst kurze Texte unveraendert", () => {
    expect(sampleForPrompt("kurz", 100)).toBe("kurz");
  });
});

describe("sampleHits", () => {
  it("nimmt hoechstens max Treffer", () => {
    const hits = [hit("a", "b"), hit("c", "d"), hit("e", "f"), hit("g", "h")];
    expect(sampleHits(hits, 3, 80)).toHaveLength(3);
  });

  it("kuerzt lange Zeilen", () => {
    const out = sampleHits([hit("y".repeat(200), "z")], 3, 40);
    expect(out[0].length).toBeLessThan(120);
  });
});

describe("buildInitialPrompt", () => {
  it("setzt eine System-Nachricht und traegt die Anweisung", () => {
    const msgs = buildInitialPrompt("Datumsformat drehen", "25.07.2026");
    expect(msgs[0].role).toBe("system");
    expect(msgs.at(-1)?.role).toBe("user");
    expect(msgs.at(-1)?.content).toContain("Datumsformat drehen");
    expect(msgs.at(-1)?.content).toContain("25.07.2026");
  });

  it("verlangt im System-Prompt JSON und nennt alle vier Felder", () => {
    const sys = buildInitialPrompt("x", "y")[0].content;
    for (const field of ["regex", "flags", "replacement", "explanation"]) {
      expect(sys).toContain(field);
    }
  });
});

describe("buildRefinePrompt", () => {
  it("traegt Verlauf, Nachschaerfung und echte Treffer", () => {
    const rounds = [{ instruction: "erste Anweisung", draft: { regex: "a", flags: "g", replacement: "b", explanation: "" } }];
    const msgs = buildRefinePrompt(rounds, "aber nicht in Codebloecken", [hit("vorher", "nachher")], "probe");
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain("erste Anweisung");
    expect(joined).toContain("aber nicht in Codebloecken");
    expect(joined).toContain("vorher");
  });
});

describe("buildRetryPrompt", () => {
  it("haengt die kaputte Antwort und das Problem an", () => {
    const msgs = buildRetryPrompt([{ role: "user", content: "u" }], "kaputt", "kein JSON");
    expect(msgs.at(-1)?.role).toBe("user");
    expect(msgs.at(-1)?.content).toContain("kein JSON");
    expect(msgs.at(-2)?.role).toBe("assistant");
    expect(msgs.at(-2)?.content).toBe("kaputt");
  });
});
