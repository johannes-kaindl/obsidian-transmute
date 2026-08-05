import { describe, it, expect } from "vitest";
import { RuleClient, type JsonTransport, type ClientConfig } from "../src/core/llm/client";

function recordingTransport(): { transport: JsonTransport; headers: (Record<string, string> | undefined)[] } {
  const headers: (Record<string, string> | undefined)[] = [];
  const transport: JsonTransport = {
    postJson: async (_url, _body, _ms, h) => {
      headers.push(h);
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) };
    },
    getJson: async (_url, _ms, h) => {
      headers.push(h);
      return { status: 200, text: JSON.stringify({ data: [{ id: "m1" }] }) };
    },
  };
  return { transport, headers };
}

const cfg = (apiKey?: string): ClientConfig => ({
  endpoint: "https://openrouter.ai/api",
  apiKey,
  model: "m1",
  timeoutMs: 1000,
  suppressReasoning: true,
});

describe("RuleClient — API-Schlüssel", () => {
  it("schickt den Bearer beim Chat-POST", async () => {
    const { transport, headers } = recordingTransport();
    await new RuleClient(transport, () => cfg("sk-x")).complete([{ role: "user", content: "hi" }]);
    expect(headers[0]).toEqual({ Authorization: "Bearer sk-x" });
  });

  it("schickt den Bearer bei listModels", async () => {
    const { transport, headers } = recordingTransport();
    await new RuleClient(transport, () => cfg("sk-x")).listModels({ url: "https://openrouter.ai/api", apiKey: "sk-x" });
    expect(headers[0]).toEqual({ Authorization: "Bearer sk-x" });
  });

  it("ohne Schlüssel bleibt der Header leer — lokale Server bekommen keinen Bearer", async () => {
    const { transport, headers } = recordingTransport();
    await new RuleClient(transport, () => cfg(undefined)).complete([{ role: "user", content: "hi" }]);
    expect(headers[0]).toEqual({});
  });
});
