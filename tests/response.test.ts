import { describe, expect, it } from "vitest";
import { extractChatContent, extractReasoning, parseRuleResponse } from "../src/core/llm/response";

const valid = '{"regex":"\\\\d+","flags":"g","replacement":"N","explanation":"Zahlen"}';

describe("parseRuleResponse", () => {
  it("liest blankes JSON", () => {
    const res = parseRuleResponse(valid);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.draft.regex).toBe("\\d+");
  });

  it("strippt einen Code-Fence", () => {
    const res = parseRuleResponse("```json\n" + valid + "\n```");
    expect(res.ok).toBe(true);
  });

  it("ignoriert fuehrende Prosa", () => {
    const res = parseRuleResponse("Sure, here you go:\n" + valid);
    expect(res.ok).toBe(true);
  });

  it("entfernt einen think-Block", () => {
    const res = parseRuleResponse("<think>hmm {\"nope\":1}</think>" + valid);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.draft.regex).toBe("\\d+");
  });

  it("kommt mit geschweiften Klammern im Regex-String klar", () => {
    const res = parseRuleResponse('{"regex":"a{2,3}","flags":"","replacement":"b","explanation":"x"}');
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.draft.regex).toBe("a{2,3}");
  });

  it("meldet fehlendes JSON", () => {
    expect(parseRuleResponse("I cannot do that.")).toMatchObject({ ok: false, reason: "no-json" });
  });

  it("meldet fehlendes regex-Feld als Schema-Fehler", () => {
    expect(parseRuleResponse('{"flags":"g"}')).toMatchObject({ ok: false, reason: "bad-schema" });
  });

  it("toleriert fehlende explanation", () => {
    const res = parseRuleResponse('{"regex":"a","flags":"","replacement":"b"}');
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(res.draft.explanation).toBe("");
  });
});

describe("extractChatContent", () => {
  it("zieht den Content aus einer OpenAI-kompatiblen Antwort", () => {
    expect(extractChatContent({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });

  it("gibt null bei einem Fehlerbody", () => {
    expect(extractChatContent({ error: { message: "boom" } })).toBeNull();
  });
});

describe("extractReasoning", () => {
  const body = (message: Record<string, unknown>) => ({ choices: [{ message }] });

  it("nimmt reasoning_content, wenn der Server es liefert", () => {
    expect(extractReasoning(body({ content: "{}", reasoning_content: "erst nachgedacht" }), "{}")).toBe("erst nachgedacht");
  });

  it("nimmt auch das kuerzere Feld reasoning", () => {
    expect(extractReasoning(body({ content: "{}", reasoning: "kurz gedacht" }), "{}")).toBe("kurz gedacht");
  });

  it("faellt auf den think-Block im Content zurueck", () => {
    const raw = "<think>laut gedacht</think>{}";
    expect(extractReasoning(body({ content: raw }), raw)).toBe("laut gedacht");
  });

  it("liefert null, wenn nicht gedacht wurde", () => {
    expect(extractReasoning(body({ content: "{}" }), "{}")).toBeNull();
  });

  it("wertet ein leeres Feld als nicht gedacht", () => {
    expect(extractReasoning(body({ content: "{}", reasoning_content: "   " }), "{}")).toBeNull();
  });

  it("kommt mit einer kaputten Antwort zurecht", () => {
    expect(extractReasoning(null, "{}")).toBeNull();
  });
});
