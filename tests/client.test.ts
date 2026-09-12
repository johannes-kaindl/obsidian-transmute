import { describe, expect, it, vi } from "vitest";
import { RuleClient, type JsonTransport } from "../src/core/llm/client";

const config = () => ({ endpoint: "http://127.0.0.1:1234", model: "m", timeoutMs: 1000, suppressReasoning: true });

function transportWith(text: string, status = 200): JsonTransport {
  return {
    postJson: vi.fn().mockResolvedValue({ status, text }),
    getJson: vi.fn().mockResolvedValue({ status, text }),
  };
}

describe("RuleClient.complete", () => {
  it("gibt den Content der Antwort zurueck", async () => {
    const client = new RuleClient(transportWith('{"choices":[{"message":{"content":"hi"}}]}'), config);
    await expect(client.complete([{ role: "user", content: "x" }])).resolves.toEqual({
      ok: true,
      content: "hi",
      reasoning: null,
      truncated: false,
    });
  });

  it("ruft /v1/chat/completions am normalisierten Endpoint auf", async () => {
    const transport = transportWith('{"choices":[{"message":{"content":"hi"}}]}');
    const client = new RuleClient(transport, () => ({ ...config(), endpoint: "http://127.0.0.1:1234/v1" }));
    await client.complete([{ role: "user", content: "x" }]);
    expect(transport.postJson).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/v1/chat/completions",
      expect.anything(),
      1000,
      {},
    );
  });

  it("meldet einen HTTP-Fehler als Fehlertext", async () => {
    const client = new RuleClient(transportWith('{"error":{"message":"boom"}}', 400), config);
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain("boom");
  });

  it("meldet leeren Content als Fehler statt als Erfolg", async () => {
    const client = new RuleClient(transportWith("{}"), config);
    expect((await client.complete([{ role: "user", content: "x" }])).ok).toBe(false);
  });

  it("schickt kein hartkodiertes Modell mit", async () => {
    const transport = transportWith('{"choices":[{"message":{"content":"hi"}}]}');
    const client = new RuleClient(transport, () => ({ ...config(), model: "" }));
    await client.complete([{ role: "user", content: "x" }]);
    const body = (transport.postJson as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1];
    expect((body as { model: string }).model).toBe("");
  });
});

describe("leerer Content", () => {
  const body = (message: Record<string, unknown>) => JSON.stringify({ choices: [{ message }] });

  it("meldet gesondert, wenn nur nachgedacht wurde", async () => {
    const client = new RuleClient(transportWith(body({ content: "", reasoning_content: "viel gedacht" })), config);
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.thoughtOnly).toBe(true);
  });

  it("bleibt bei der Endpunkt-Meldung, wenn auch kein Gedankengang da ist", async () => {
    const client = new RuleClient(transportWith(body({ content: "" })), config);
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
    const client = new RuleClient(
      transportWith(body({ message: { content: "{\"regex\":" }, finish_reason: "length" })),
      config,
    );
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: true, content: "{\"regex\":", truncated: true });
  });

  it("markiert eine VOLLSTAENDIGE Antwort nicht als abgeschnitten", async () => {
    const client = new RuleClient(
      transportWith(body({ message: { content: "hi" }, finish_reason: "stop" })),
      config,
    );
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res).toMatchObject({ ok: true, truncated: false });
  });

  it("markiert abgeschnitten UND leer gesondert, statt als 'leere Antwort' durchzufallen", async () => {
    const client = new RuleClient(
      transportWith(body({ message: { content: "" }, finish_reason: "length" })),
      config,
    );
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.truncatedEmpty).toBe(true);
  });
});
