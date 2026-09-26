import { extractModelIds } from "../../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../../vendor/kit/endpoint_config";
import { suppressParams } from "../../vendor/kit/reasoning";
import type { ChatClient } from "../../vendor/kit-obsidian/chat-client";
import { effectiveSuppress } from "../reasoning-toggle";
import type { ChatMessage } from "../types";

/** Netz-Port fuer die Modell-Liste (GET). Der Chat-Aufruf laeuft ueber den Kit-Chat-Client;
 *  die Implementierung lebt in der obsidian-Schicht (requestUrl) — hier bleibt der Kern
 *  obsidian-frei und in Node testbar (PROF-OBS-12). */
export interface JsonTransport {
  getJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<{ status: number; text: string }>;
}

export type CompleteResult =
  /** truncated: finish_reason === "length" — am Token-Limit abgeschnitten. Kein Fehler,
   *  der Teiltext bleibt verwertbar; nur wer ihn zeigt, muss es sagen koennen (sonst sieht
   *  ein abgeschnittenes Ergebnis wie ein vollstaendiges aus). */
  | { ok: true; content: string; reasoning: string | null; truncated: boolean }
  /** thoughtOnly: Der Aufruf gelang, aber das Modell hat sein Token-Budget vollstaendig
   *  ins Denken gesteckt — gemessen bei qwen3.6 unter LM Studio (512 von 551 Tokens).
   *  Das ist die tueckischere Fehlerklasse als ein toter Port: kein Fehlerstatus, nur
   *  ein leerer String, der sich als leere Modellantwort tarnt.
   *  truncatedEmpty: abgeschnitten UND ohne verwertbaren Text — die Meldung muss das
   *  Limit nennen, nicht "leere Antwort" (REGISTRY "Abgeschnittene LLM-Antwort …"). */
  | { ok: false; error: string; thoughtOnly?: boolean; truncatedEmpty?: boolean };

export type ClientConfig = {
  endpoint: string;
  /** Schlüssel des aktiven Endpunkts. Leer/fehlend = lokaler Server ohne Auth. */
  apiKey?: string;
  model: string;
  timeoutMs: number;
  suppressReasoning: boolean;
};

/** Ein Chat-Client je Zeitlimit: die Frist ist Teil der Instanz (`nonStreamTimeoutMs`). */
export type ChatClientFactory = (timeoutMs: number) => ChatClient;

export class RuleClient {
  private chat: { timeoutMs: number; client: ChatClient } | null = null;

  constructor(
    private readonly makeChat: ChatClientFactory,
    private readonly transport: JsonTransport,
    private readonly config: () => ClientConfig,
  ) {}

  private chatFor(timeoutMs: number): ChatClient {
    if (this.chat?.timeoutMs !== timeoutMs) this.chat = { timeoutMs, client: this.makeChat(timeoutMs) };
    return this.chat.client;
  }

  async complete(messages: ChatMessage[]): Promise<CompleteResult> {
    const cfg = this.config();
    // temperature ist Sache dieses Plugins, nicht des Clients: eine Regel soll bei gleicher
    // Eingabe gleich ausfallen. effectiveSuppress: ein Modell, das immer denkt, laesst sich
    // nicht bitten — die Parameter zu schicken erzeugt dort nur Rauschen im Request.
    const r = await this.chatFor(cfg.timeoutMs).complete({
      endpoint: { url: cfg.endpoint, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) },
      model: cfg.model,
      messages,
      params: { temperature: 0, ...suppressParams(effectiveSuppress(cfg.model, cfg.suppressReasoning)) },
      stream: false,
    });

    if (!r.ok) {
      // Abgeschnitten ohne Text: die Meldung muss das Limit nennen, nicht „leere Antwort“.
      if (r.kind === "truncated") return { ok: false, error: "length", truncatedEmpty: true };
      return { ok: false, error: r.detail };
    }
    if (r.content.trim().length === 0) {
      if (r.reasoning.trim().length > 0) return { ok: false, error: r.reasoning.slice(0, 300), thoughtOnly: true };
      return { ok: false, error: "empty answer" };
    }
    return { ok: true, content: r.content, reasoning: r.reasoning !== "" ? r.reasoning : null, truncated: r.truncated };
  }

  async listModels(ep: EndpointConfig): Promise<string[]> {
    const cfg = this.config();
    const res = await this.transport.getJson(
      `${normalizeEndpoint(ep.url)}/v1/models`, cfg.timeoutMs, authHeaders(ep.apiKey),
    );
    if (res.status < 200 || res.status >= 300) return [];
    try {
      return extractModelIds(JSON.parse(res.text));
    } catch {
      return [];
    }
  }
}
