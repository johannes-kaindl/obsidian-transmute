import { describe, expect, it, vi } from "vitest";
import { RuleClient, extractModelIds, type JsonTransport } from "../src/core/llm/client";

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

describe("extractModelIds", () => {
  it("liest die ids aus data", () => {
    expect(extractModelIds({ data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
  });

  it("ist robust gegen kaputte Antworten", () => {
    expect(extractModelIds({})).toEqual([]);
    expect(extractModelIds(null)).toEqual([]);
    expect(extractModelIds({ data: [{ noid: 1 }] })).toEqual([]);
  });
});
