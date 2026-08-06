import { requestUrl } from "obsidian";
import type { JsonTransport } from "../core/llm/client";
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

export const obsidianTransport: JsonTransport = {
  postJson: async (url, body, timeoutMs, headers) => {
    const res = await send(url, "POST", JSON.stringify(body), timeoutMs, headers);
    if (res.timedOut) return { status: 0, text: "timeout" };
    if (res.error !== null) return { status: 0, text: res.error };
    return { status: res.status, text: res.text };
  },
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
