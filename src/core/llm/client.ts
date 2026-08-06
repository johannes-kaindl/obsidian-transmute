import { extractModelIds } from "../../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../../vendor/kit/endpoint_config";
import { suppressParams } from "../../vendor/kit/reasoning";
import { effectiveSuppress } from "../reasoning-toggle";
import type { ChatMessage } from "../types";
import { extractChatContent, extractReasoning } from "./response";

/** Netz-Port. Die Implementierung lebt in der obsidian-Schicht (requestUrl) —
 *  hier bleibt der Kern obsidian-frei und in Node testbar (PROF-OBS-12). */
export interface JsonTransport {
  postJson(url: string, body: unknown, timeoutMs: number, headers?: Record<string, string>): Promise<{ status: number; text: string }>;
  getJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<{ status: number; text: string }>;
}

export type CompleteResult =
  | { ok: true; content: string; reasoning: string | null }
  /** thoughtOnly: Der Aufruf gelang, aber das Modell hat sein Token-Budget vollstaendig
   *  ins Denken gesteckt — gemessen bei qwen3.6 unter LM Studio (512 von 551 Tokens).
   *  Das ist die tueckischere Fehlerklasse als ein toter Port: kein Fehlerstatus, nur
   *  ein leerer String, der sich als leere Modellantwort tarnt. */
  | { ok: false; error: string; thoughtOnly?: boolean };

export type ClientConfig = {
  endpoint: string;
  /** Schlüssel des aktiven Endpunkts. Leer/fehlend = lokaler Server ohne Auth. */
  apiKey?: string;
  model: string;
  timeoutMs: number;
  suppressReasoning: boolean;
};

function errorMessage(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) {
      const err = (body as { error?: unknown }).error;
      if (typeof err === "string") return err;
      if (typeof err === "object" && err !== null) {
        const msg = (err as { message?: unknown }).message;
        if (typeof msg === "string") return msg;
      }
    }
  } catch {
    // Kein JSON — der Rohtext ist die beste verfuegbare Meldung.
  }
  return text.slice(0, 300);
}

export class RuleClient {
  constructor(
    private readonly transport: JsonTransport,
    private readonly config: () => ClientConfig,
  ) {}

  async complete(messages: ChatMessage[]): Promise<CompleteResult> {
    const cfg = this.config();
    // normalizeEndpoint strippt ein trailing /v1; wir haengen es kontrolliert wieder an.
    // Ohne das baut der Client …/v1/v1/chat/completions — und LM Studio antwortet auf
    // falsche Pfade mit HTTP 200 plus Fehler-Body, also ohne erkennbaren Fehler.
    const base = normalizeEndpoint(cfg.endpoint);
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature: 0,
      stream: false,
      // effectiveSuppress: ein Modell, das immer denkt, laesst sich nicht bitten — die
      // Parameter zu schicken erzeugt dort nur Rauschen im Request.
      ...suppressParams(effectiveSuppress(cfg.model, cfg.suppressReasoning)),
    };

    const res = await this.transport.postJson(
      `${base}/v1/chat/completions`, body, cfg.timeoutMs, authHeaders(cfg.apiKey),
    );
    if (res.status < 200 || res.status >= 300) return { ok: false, error: errorMessage(res.text) };

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      return { ok: false, error: res.text.slice(0, 300) };
    }

    const content = extractChatContent(parsed);
    if (content === null || content.trim().length === 0) {
      const reasoning = extractReasoning(parsed, content ?? "");
      if (reasoning !== null) return { ok: false, error: reasoning.slice(0, 300), thoughtOnly: true };
      return { ok: false, error: errorMessage(res.text) };
    }
    return { ok: true, content, reasoning: extractReasoning(parsed, content) };
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
