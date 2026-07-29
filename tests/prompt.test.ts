import { describe, expect, it } from "vitest";
import {
  buildDiagnosePrompt,
  buildInitialPrompt,
  buildRefinePrompt,
  buildRetryPrompt,
  languageName,
  sampleForPrompt,
  sampleHits,
} from "../src/core/llm/prompt";
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
    const rounds = [{ instruction: "erste Anweisung", draft: { regex: "a", flags: "g", replacement: "b", explanation: "" }, source: "model" as const }];
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

describe("optionales Ziel-Muster", () => {
  it("laesst die Zeile weg, wenn kein Ziel gesetzt ist", () => {
    const withoutTarget = buildInitialPrompt("x", "y").map((m) => m.content).join("\n");
    expect(withoutTarget).not.toContain("The replacement should produce");
  });

  it("traegt das Ziel-Muster in den Erstlauf", () => {
    const msgs = buildInitialPrompt("x", "y", "JJJJ-MM-TT");
    expect(msgs.map((m) => m.content).join("\n")).toContain("JJJJ-MM-TT");
  });

  it("ignoriert ein Ziel-Muster aus reinen Leerzeichen", () => {
    const msgs = buildInitialPrompt("x", "y", "   ");
    expect(msgs.map((m) => m.content).join("\n")).not.toContain("The replacement should produce");
  });

  it("traegt das Ziel-Muster auch beim Nachschaerfen", () => {
    const msgs = buildRefinePrompt([], "enger", [], "probe", "JJJJ-MM-TT");
    expect(msgs.map((m) => m.content).join("\n")).toContain("JJJJ-MM-TT");
  });
});

describe("buildRefinePrompt mit Handrunden", () => {
  const draft = { regex: "foo", flags: "i", replacement: "bar", explanation: "e" };

  it("beschreibt eine Handrunde als Nutzer-Bearbeitung", () => {
    const msgs = buildRefinePrompt(
      [{ instruction: "", draft, source: "manual" as const }],
      "jetzt auch Grossschreibung",
      [],
      "text",
    );
    const user = msgs.filter((m) => m.role === "user");
    expect(user[0].content).toContain("edited the rule by hand");
    expect(user[0].content).toContain('"regex":"foo"');
  });

  it("erzeugt fuer eine Handrunde keinen Assistenten-Zug", () => {
    const msgs = buildRefinePrompt([{ instruction: "", draft, source: "manual" as const }], "weiter", [], "text");
    expect(msgs.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("laesst Modellrunden unveraendert", () => {
    const msgs = buildRefinePrompt([{ instruction: "alle foo", draft, source: "model" as const }], "weiter", [], "text");
    expect(msgs.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(msgs[1].content).toContain("Instruction: alle foo");
  });
});

describe("Zielsprache", () => {
  it("nennt die Sprache im System-Prompt, statt sie erraten zu lassen", () => {
    const messages = buildInitialPrompt("ersetze foo", "foo bar", "", "de");
    expect(messages[0].content).toContain("Answer in German.");
    expect(messages[0].content).not.toContain("the user's language");
  });

  it("nennt Englisch bei englischer Oberflaeche", () => {
    const messages = buildInitialPrompt("replace foo", "foo bar", "", "en");
    expect(messages[0].content).toContain("Answer in English.");
  });

  it("nennt sie auch beim Nachschaerfen", () => {
    const messages = buildRefinePrompt([], "enger", [], "foo", "", "de");
    expect(messages[0].content).toContain("Answer in German.");
  });

  it("uebersetzt den Sprachcode in einen Namen, den das Modell kennt", () => {
    expect(languageName("de")).toBe("German");
    expect(languageName("en")).toBe("English");
  });
});

describe("buildDiagnosePrompt", () => {
  const rule = { regex: "^foo", flags: "", replacement: "bar", explanation: "" };

  it("erlaubt dem Modell ausdruecklich, keine Reparatur vorzuschlagen", () => {
    const messages = buildDiagnosePrompt(rule, [], "text", "", "de");
    expect(messages[0].content).toContain("null");
    expect(messages[0].content).toContain("Answer in German.");
  });

  it("stellt die gemessenen Befunde voran, mit Zeilennummer", () => {
    const messages = buildDiagnosePrompt(rule, [{ kind: "no-anchors", line: 11 }], "text", "", "en");
    const user = messages[1].content;
    expect(user).toContain("line 12");
    expect(user).toContain("anchors");
  });

  it("sagt es ausdruecklich, wenn keine Lockerung geholfen hat", () => {
    const messages = buildDiagnosePrompt(rule, [], "text", "", "en");
    expect(messages[1].content).toContain("None of these relaxations");
  });

  it("nimmt die Anweisung mit, wenn es eine gibt", () => {
    const messages = buildDiagnosePrompt(rule, [], "text", "ersetze foo", "en");
    expect(messages[1].content).toContain("ersetze foo");
  });

  it("laesst die Anweisungszeile weg, wenn von Hand getippt wurde", () => {
    const messages = buildDiagnosePrompt(rule, [], "text", "", "en");
    expect(messages[1].content).not.toContain("Instruction:");
  });

  it("schickt den Spickzettel nicht mit", () => {
    // Regex ist Allgemeinwissen; ein kurzer Prompt ist der, bei dem kleine Modelle
    // noch das JSON treffen.
    const messages = buildDiagnosePrompt(rule, [], "text", "", "en");
    expect(messages[0].content).not.toContain("$&");
  });
});
