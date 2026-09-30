import { describe, expect, it } from "vitest";
import { chatSetupFor, makeChatClient, SHORTCUT_CLIENT_SLACK_MS } from "../src/obsidian/http";
import { RuleClient, type JsonTransport } from "../src/core/llm/client";
import { classifyShortcutFailure } from "../src/core/llm/shortcut-errors";
import { requestUrlTransport } from "../src/vendor/kit-obsidian/chat-transport";
import type { ShortcutResult, ShortcutRun } from "../src/vendor/kit-obsidian/shortcuts-bridge";
import { nodeClock } from "./chat-fake";

const via = (timeoutMs = 30_000) => ({ transport: "shortcuts" as const, shortcut: { name: "Apple LLM", timeoutMs } });
const noGet: JsonTransport = { getJson: () => Promise.resolve({ status: 200, text: "{}" }) };

function fakeBridge(result: ShortcutResult): { bridge: { run(r: ShortcutRun): Promise<ShortcutResult> }; calls: ShortcutRun[] } {
  const calls: ShortcutRun[] = [];
  return { calls, bridge: { run: (r) => { calls.push(r); return Promise.resolve(result); } } };
}

describe("chatSetupFor — Transportwahl", () => {
  it("HTTP-Endpunkt: requestUrl ohne Fallback, Frist wie eingestellt", () => {
    const s = chatSetupFor(120_000, { transport: "http" }, null);
    expect(s.choice.primary).toBe(requestUrlTransport);
    expect(s.choice.fallback).toBeUndefined();
    expect(s.nonStreamMs).toBe(120_000);
  });

  it("ohne Quelle (lokale Liste) gilt HTTP", () => {
    expect(chatSetupFor(120_000, undefined, null).choice.primary).toBe(requestUrlTransport);
  });

  it("Shortcuts-Endpunkt: eigener Transport", () => {
    const { bridge } = fakeBridge({ ok: true, result: "x", durationMs: 1 });
    expect(chatSetupFor(120_000, via(), bridge).choice.primary).not.toBe(requestUrlTransport);
  });

  it("Client-Frist ist mindestens Kurzbefehl-Frist plus Puffer, nie kuerzer als eingestellt", () => {
    const { bridge } = fakeBridge({ ok: true, result: "x", durationMs: 1 });
    expect(chatSetupFor(120_000, via(30_000), bridge).nonStreamMs).toBe(120_000);
    expect(chatSetupFor(120_000, via(200_000), bridge).nonStreamMs).toBe(200_000 + SHORTCUT_CLIENT_SLACK_MS);
  });

  it("Shortcuts-Endpunkt ohne Bruecke wirft", () => {
    expect(() => chatSetupFor(120_000, via(), null)).toThrow();
  });
});

describe("Anfrage ueber den Kurzbefehl", () => {
  const client = (bridge: { run(r: ShortcutRun): Promise<ShortcutResult> }, model: string) =>
    new RuleClient((ms, v) => makeChatClient(ms, v, bridge, { clock: nodeClock }), noGet, () => ({
      endpoint: "apple-shortcuts://on-device", model, timeoutMs: 120_000, suppressReasoning: false, via: via(),
    }));
  const msgs = [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "usr" }];

  it.each(["", "Apple Model"])("liefert die Antwort, Modell %j wird vertragen", async (model) => {
    const { bridge, calls } = fakeBridge({ ok: true, result: "Hallo", durationMs: 5 });
    const r = await client(bridge, model).complete(msgs);
    expect(r).toMatchObject({ ok: true, content: "Hallo" });
    expect(calls).toEqual([{ shortcut: "Apple LLM", input: "sys\n\nusr", timeoutMs: 30_000 }]);
  });

  it("Zeitueberschreitung kommt mit Kurzbefehl-Grund und Text der Bruecke an", async () => {
    const { bridge } = fakeBridge({ ok: false, reason: "timeout", message: "Kurzbefehl antwortet nicht", durationMs: 30_000 });
    const r = await client(bridge, "").complete(msgs);
    expect(r).toMatchObject({ ok: false, shortcutReason: "timeout", error: "Kurzbefehl antwortet nicht" });
  });

  it("ein HTTP-Fehler ohne Kurzbefehl bekommt keinen Kurzbefehl-Grund", async () => {
    const r = await new RuleClient(
      () => makeChatClient(1000, undefined, null, { clock: nodeClock }), noGet,
      () => ({ endpoint: "http://127.0.0.1:1", model: "m", timeoutMs: 1000, suppressReasoning: false }),
    ).complete(msgs).catch(() => null);
    expect(r === null || !("shortcutReason" in r)).toBe(true);
  });
});

describe("classifyShortcutFailure", () => {
  const body = (reason: string, message = "m") => JSON.stringify({ error: { message, reason } });
  it.each([[408, "timeout"], [429, "busy"], [499, "cancel"], [502, "error"]])("Status %i mit Grund %s", (status, reason) => {
    expect(classifyShortcutFailure(status, body(reason))).toEqual({ reason, detail: "m" });
  });
  it("501 ohne Grund ist die Werkzeug-Grenze", () => {
    expect(classifyShortcutFailure(501, JSON.stringify({ error: { message: "tools" } }))).toMatchObject({ reason: "unsupported" });
  });
  it("ohne lesbaren Koerper entscheidet der Status", () => {
    expect(classifyShortcutFailure(408, undefined)).toEqual({ reason: "timeout", detail: "" });
    expect(classifyShortcutFailure(500, "kein json")).toEqual({ reason: "error", detail: "kein json" });
  });
});
