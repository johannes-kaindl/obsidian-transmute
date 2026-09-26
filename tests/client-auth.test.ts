import { describe, it, expect } from "vitest";
import { RuleClient, type JsonTransport, type ClientConfig } from "../src/core/llm/client";
import type { SseTransport } from "../src/vendor/kit-obsidian/chat-client";
import { fakeChatFactory } from "./chat-fake";

/** GET (Modell-Liste) und Chat-POST melden ihre Header in dieselbe Liste. */
function recording(): { chat: ReturnType<typeof fakeChatFactory>; get: JsonTransport; headers: (Record<string, string> | undefined)[] } {
  const headers: (Record<string, string> | undefined)[] = [];
  const post: SseTransport = {
    postStream: (_url, _body, h, onChunk) => {
      headers.push(h);
      onChunk(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      return Promise.resolve(200);
    },
  };
  const get: JsonTransport = {
    getJson: async (_url, _ms, h) => {
      headers.push(h);
      return { status: 200, text: JSON.stringify({ data: [{ id: "m1" }] }) };
    },
  };
  return { chat: fakeChatFactory(post), get, headers };
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
    const { chat, get, headers } = recording();
    await new RuleClient(chat, get, () => cfg("sk-x")).complete([{ role: "user", content: "hi" }]);
    expect(headers[0]).toEqual({ Authorization: "Bearer sk-x" });
  });

  it("schickt den Bearer bei listModels", async () => {
    const { chat, get, headers } = recording();
    await new RuleClient(chat, get, () => cfg("sk-x")).listModels({ url: "https://openrouter.ai/api", apiKey: "sk-x" });
    expect(headers[0]).toEqual({ Authorization: "Bearer sk-x" });
  });

  it("ohne Schlüssel bleibt der Header leer — lokale Server bekommen keinen Bearer", async () => {
    const { chat, get, headers } = recording();
    await new RuleClient(chat, get, () => cfg(undefined)).complete([{ role: "user", content: "hi" }]);
    expect(headers[0]).toEqual({});
  });
});
