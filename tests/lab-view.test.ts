import { describe, expect, it } from "vitest";
import { labView } from "../src/core/llm/lab-view";

const TOKEN = "Zk3QpWv8LmN2xY7aTb5RcD9e";

describe("labView — das Lab sieht den gesendeten Text", () => {
  const messages = [
    { role: "system" as const, content: "Du schreibst Regex." },
    { role: "user" as const, content: `Ersetze das Token.\nAuthorization: Bearer ${TOKEN}` },
  ];

  it("ersetzt ein Bearer-Token in den Nachrichten durch den Platzhalter", () => {
    const v = labView(messages, "{}", null);
    expect(v.messages[1]?.content).not.toContain(TOKEN);
    expect(v.messages[1]?.content).toMatch(/\[redacted-token-\d+\]/);
    expect(v.messages[0]?.content).toBe("Du schreibst Regex.");
  });

  it("schwaerzt auch die restaurierte Antwort und gibt dem Wert denselben Platzhalter", () => {
    const v = labView(messages, JSON.stringify({ regex: `Bearer ${TOKEN}` }), `ich lese Bearer ${TOKEN}`);
    const ph = /\[redacted-token-\d+\]/.exec(String(v.messages[1]?.content))?.[0];
    expect(ph).toBeDefined();
    expect(v.content).not.toContain(TOKEN);
    expect(v.content).toContain(ph as string);
    expect(v.reasoning).not.toContain(TOKEN);
    expect(v.reasoning).toContain(ph as string);
  });

  it("laesst Text ohne Geheimnis unveraendert und keine Denkspur als null", () => {
    const v = labView([{ role: "user", content: "foo bar" }], "ok", null);
    expect(v).toEqual({ messages: [{ role: "user", content: "foo bar" }], content: "ok", reasoning: null });
  });

  it("veraendert die Originale nicht", () => {
    labView(messages, "{}", null);
    expect(messages[1]?.content).toContain(TOKEN);
  });
});
