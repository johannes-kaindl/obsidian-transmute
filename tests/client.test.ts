import { describe, expect, it, vi } from "vitest";
import { RuleClient, type JsonTransport } from "../src/core/llm/client";
import { fakeChatFactory, fakeTransport, type SeenPost } from "./chat-fake";

const config = () => ({ endpoint: "http://127.0.0.1:1234", model: "m", timeoutMs: 1000, suppressReasoning: true });

const noGet: JsonTransport = { getJson: vi.fn().mockResolvedValue({ status: 200, text: "{}" }) };

/** Ein RuleClient, dessen Chat-POST `text` mit `status` beantwortet; `seen` sammelt die gesendeten Anfragen. */
function clientWith(text: string, status = 200, cfg: () => ReturnType<typeof config> = config, seen: SeenPost[] = []): RuleClient {
  return new RuleClient(fakeChatFactory(fakeTransport(text, status, seen)), noGet, cfg);
}

describe("RuleClient.complete", () => {
  it("gibt den Content der Antwort zurueck", async () => {
    const client = clientWith('{"choices":[{"message":{"content":"hi"}}]}');
    await expect(client.complete([{ role: "user", content: "x" }])).resolves.toEqual({
      ok: true,
      content: "hi",
      reasoning: null,
      truncated: false,
    });
  });

  it("ruft /v1/chat/completions am normalisierten Endpoint auf, ohne Stream und mit Temperatur 0", async () => {
    const seen: SeenPost[] = [];
    const client = clientWith('{"choices":[{"message":{"content":"hi"}}]}', 200, () => ({ ...config(), endpoint: "http://127.0.0.1:1234/v1" }), seen);
    await client.complete([{ role: "user", content: "x" }]);
    expect(seen[0]?.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(seen[0]?.body).toMatchObject({ stream: false, temperature: 0 });
  });

  it("meldet einen HTTP-Fehler als Fehlertext", async () => {
    const client = clientWith('{"error":{"message":"boom"}}', 400);
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain("boom");
  });

  it("meldet leeren Content als Fehler statt als Erfolg", async () => {
    const client = clientWith("{}");
    expect((await client.complete([{ role: "user", content: "x" }])).ok).toBe(false);
  });

  it("schickt kein hartkodiertes Modell mit", async () => {
    const seen: SeenPost[] = [];
    const client = clientWith('{"choices":[{"message":{"content":"hi"}}]}', 200, () => ({ ...config(), model: "" }), seen);
    await client.complete([{ role: "user", content: "x" }]);
    expect(seen[0]?.body.model).toBe("");
  });

  it("trennt Inline-<think> vom Ergebnis", async () => {
    const client = clientWith('{"choices":[{"message":{"content":"<think>laut gedacht</think>hi"}}]}');
    await expect(client.complete([{ role: "user", content: "x" }])).resolves.toEqual({ ok: true, content: "hi", reasoning: "laut gedacht", truncated: false });
  });

  it("meldet einen Fehlerkoerper trotz Status 200 als Fehler mit der Servermeldung", async () => {
    const client = clientWith('{"error":{"message":"Unexpected endpoint"}}');
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain("Unexpected endpoint");
  });

  it("meldet den Timeout als Fehler", async () => {
    const hang = { postStream: (_u: string, _b: unknown, _h: unknown, _c: unknown, signal: AbortSignal) => new Promise<number>((_res, rej) => signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); })) };
    const client = new RuleClient(fakeChatFactory(hang as never), noGet, () => ({ ...config(), timeoutMs: 20 }));
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain("no data");
  });
});

describe("leerer Content", () => {
  const body = (message: Record<string, unknown>) => JSON.stringify({ choices: [{ message }] });

  it("meldet gesondert, wenn nur nachgedacht wurde", async () => {
    const client = clientWith(body({ content: "", reasoning_content: "viel gedacht" }));
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.thoughtOnly).toBe(true);
  });

  it("bleibt bei der Endpunkt-Meldung, wenn auch kein Gedankengang da ist", async () => {
    const client = clientWith(body({ content: "" }));
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.thoughtOnly).toBeUndefined();
  });
});

// Bug (gemessen image-to-markdown, 2026-08-30): non-streaming setzt kein max_tokens und
// liest kein finish_reason — eine am Server-Default abgeschnittene Antwort sah bislang wie
// eine vollstaendige aus. finish_reason steht im selben JSON, das ohnehin geparst wird.
describe("abgeschnittene Antwort (finish_reason)", () => {
  const body = (choice: Record<string, unknown>) => JSON.stringify({ choices: [choice] });

  it("meldet einen verwertbaren Teiltext weiter als Erfolg, markiert ihn aber als abgeschnitten", async () => {
    const client = clientWith(body({ message: { content: "{\"regex\":" }, finish_reason: "length" }));
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: true, content: "{\"regex\":", truncated: true });
  });

  it("markiert eine VOLLSTAENDIGE Antwort nicht als abgeschnitten", async () => {
    const client = clientWith(body({ message: { content: "hi" }, finish_reason: "stop" }));
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: true, truncated: false });
  });

  it("markiert abgeschnitten UND leer gesondert, statt als 'leere Antwort' durchzufallen", async () => {
    const client = clientWith(body({ message: { content: "" }, finish_reason: "length" }));
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.truncatedEmpty).toBe(true);
  });
});
