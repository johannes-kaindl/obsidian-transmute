import { requestUrl } from "obsidian";
import type { JsonTransport } from "../core/llm/client";
import { createChatClient, type ChatClient } from "../vendor/kit-obsidian/chat-client";
import { createShortcutsChatTransport, requestUrlTransport, transportFor, type TransportChoice } from "../vendor/kit-obsidian/chat-transport";
import type { ShortcutsBridge } from "../vendor/kit-obsidian/shortcuts-bridge";
import type { ClockPort } from "../vendor/kit-obsidian/clock";
import type { ChatVia } from "../core/llm/client";
import { classifyEndpointStatus, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { withTimeout } from "../vendor/kit/timeout";

type Wire = { status: number; text: string; timedOut: boolean; error: string | null };

/** Timeout-Wrapper aus dem Kit — requestUrl kennt weder Timeout noch Abort.
 *  window statt activeWindow als Timer-Port: der Timer beruehrt kein DOM, die
 *  Popout-Regel aus PROF-OBS-13 zielt auf DOM-gebundene Timer, und
 *  `obsidianmd/prefer-window-timers` verlangt hier ausdruecklich window. Die Bindung
 *  an window gehoert deshalb in diese Schicht, nicht in das pure Kit-Modul. */
async function send(
  url: string,
  method: "GET" | "POST",
  body: string | undefined,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<Wire> {
  const work = requestUrl({
    url,
    method,
    headers,
    contentType: body === undefined ? undefined : "application/json",
    body,
    throw: false,
  })
    .then((res) => ({ status: res.status, text: res.text, timedOut: false, error: null }))
    .catch((err: unknown) => ({
      status: 0,
      text: "",
      timedOut: false,
      error: err instanceof Error ? err.message : String(err),
    }));

  const raced = await withTimeout(work, timeoutMs, window);
  return raced.timedOut ? { status: 0, text: "", timedOut: true, error: null } : raced.value;
}

/** Chat-Client fuer eine Anfrage OHNE Stream ueber `requestUrl` (Hauptprozess, kein Origin —
 *  damit gibt es keine CORS-Weigerung, also auch keinen Fallback). Die Frist ist die ganze
 *  Wartezeit: ohne Stream gibt es kein Lebenszeichen. Abbruch und Frist wirken ueber den
 *  Signal-Weg des Clients; die Anfrage selbst laeuft im Hintergrund zu Ende, ihr Ergebnis verfaellt. */
/** Puffer auf die Kurzbefehl-Frist: die Bruecke meldet ihr Timeout selbst (408), der Client darf
 *  nicht vorher abbrechen, waehrend sie noch wartet. */
export const SHORTCUT_CLIENT_SLACK_MS = 10_000;

/** Transportwahl und Frist fuer einen aufgeloesten Endpunkt. HTTP: `requestUrl` ohne Fallback.
 *  Kurzbefehl (Apple Intelligence): one-shot ueber die Bruecke; die Frist ist mindestens
 *  Kurzbefehl-Frist plus Puffer. Wirft, wenn ein Shortcuts-Endpunkt ohne Bruecke oder ohne
 *  Kurzbefehl-Angabe ankommt (Konfigurationsfehler, kein stiller HTTP-Rueckfall). */
export function chatSetupFor(
  timeoutMs: number, via: ChatVia | undefined, bridge: Pick<ShortcutsBridge, "run"> | null,
): { choice: TransportChoice; nonStreamMs: number } {
  const shortcut = via?.shortcut;
  const choice = transportFor(via ?? {}, {
    http: requestUrlTransport,
    ...(bridge && shortcut ? { shortcuts: createShortcutsChatTransport({ bridge, shortcut }) } : {}),
  });
  const nonStreamMs = via?.transport === "shortcuts" && shortcut ? Math.max(timeoutMs, shortcut.timeoutMs + SHORTCUT_CLIENT_SLACK_MS) : timeoutMs;
  return { choice, nonStreamMs };
}

export function makeChatClient(
  timeoutMs: number, via: ChatVia | undefined, bridge: Pick<ShortcutsBridge, "run"> | null,
  deps: { clock?: ClockPort } = {},
): ChatClient {
  const { choice, nonStreamMs } = chatSetupFor(timeoutMs, via, bridge);
  return createChatClient({
    transport: choice.primary, ...(choice.fallback ? { fallbackTransport: choice.fallback } : {}),
    nonStreamTimeoutMs: nonStreamMs, ...(deps.clock ? { clock: deps.clock } : {}),
  });
}

export const obsidianTransport: JsonTransport = {
  getJson: async (url, timeoutMs, headers) => {
    const res = await send(url, "GET", undefined, timeoutMs, headers);
    if (res.timedOut) return { status: 0, text: "timeout" };
    if (res.error !== null) return { status: 0, text: res.error };
    return { status: res.status, text: res.text };
  },
};

/** Erreichbarkeits-Probe gegen GET /v1/models.
 *
 *  Nimmt den ganzen Eintrag, nicht die URL: ohne den Schlüssel antwortet ein gehosteter
 *  Anbieter mit 401, der Endpunkt gilt als nicht erreichbar und wird still übersprungen —
 *  das Feature wirkt tot, ohne dass irgendwo eine Meldung erscheint. */
export async function probeEndpoint(ep: EndpointConfig, timeoutMs: number): Promise<EndpointStatus> {
  const res = await send(
    `${normalizeEndpoint(ep.url)}/v1/models`, "GET", undefined, timeoutMs, authHeaders(ep.apiKey),
  );
  if (res.timedOut) return classifyEndpointStatus({ kind: "timeout" });
  if (res.error !== null) return classifyEndpointStatus({ kind: "error", message: res.error });

  let body: unknown = null;
  try {
    body = JSON.parse(res.text);
  } catch {
    // Kein JSON — classifyEndpointStatus stuft das als not-an-llm-api ein.
  }
  return classifyEndpointStatus({ kind: "response", status: res.status, body });
}

export async function pingEndpoint(ep: EndpointConfig, timeoutMs: number): Promise<boolean> {
  return (await probeEndpoint(ep, timeoutMs)).reachable;
}
