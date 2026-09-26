import { createChatClient, type ChatClient, type SseTransport } from "../src/vendor/kit-obsidian/chat-client";

/** Node hat kein `window`: eine Uhr ueber die globalen Timer (Kit-Vertrag: der Client bekommt sie injiziert). */
export const nodeClock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

export interface SeenPost { url: string; body: Record<string, unknown>; headers: Record<string, string> }

/** Fake-Transport im Kit-Vertrag: der Antwortkoerper kommt als ein Chunk, aufgeloest mit dem Status. */
export function fakeTransport(text: string, status = 200, seen: SeenPost[] = []): SseTransport {
  return {
    postStream: (url, body, headers, onChunk) => {
      seen.push({ url, body: body as Record<string, unknown>, headers });
      onChunk(text);
      return Promise.resolve(status);
    },
  };
}

/** Factory-Form, die `RuleClient` erwartet — mit dem Fake statt `requestUrl`. */
export function fakeChatFactory(transport: SseTransport): (timeoutMs: number) => ChatClient {
  return (timeoutMs) => createChatClient({ transport, clock: nodeClock, nonStreamTimeoutMs: timeoutMs });
}
