import { requestUrl } from "obsidian";
import type { JsonTransport } from "../core/llm/client";
import { classifyEndpointStatus, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";

type Wire = { status: number; text: string; timedOut: boolean; error: string | null };

/** requestUrl kennt weder Timeout noch Abort — deshalb der Promise.race-Wrapper.
 *  window statt activeWindow: der Timer beruehrt kein DOM, die Popout-Regel aus
 *  PROF-OBS-13 zielt auf DOM-gebundene Timer. `obsidianmd/prefer-window-timers`
 *  verlangt hier ausdruecklich window. */
function withTimeout(work: Promise<Wire>, timeoutMs: number): Promise<Wire> {
  return new Promise<Wire>((resolve) => {
    const timer = window.setTimeout(
      () => resolve({ status: 0, text: "", timedOut: true, error: null }),
      timeoutMs,
    );
    void work.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    });
  });
}

async function send(url: string, method: "GET" | "POST", body: string | undefined, timeoutMs: number): Promise<Wire> {
  const work = requestUrl({
    url,
    method,
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

  return withTimeout(work, timeoutMs);
}

export const obsidianTransport: JsonTransport = {
  postJson: async (url, body, timeoutMs) => {
    const res = await send(url, "POST", JSON.stringify(body), timeoutMs);
    if (res.timedOut) return { status: 0, text: "timeout" };
    if (res.error !== null) return { status: 0, text: res.error };
    return { status: res.status, text: res.text };
  },
  getJson: async (url, timeoutMs) => {
    const res = await send(url, "GET", undefined, timeoutMs);
    if (res.timedOut) return { status: 0, text: "timeout" };
    if (res.error !== null) return { status: 0, text: res.error };
    return { status: res.status, text: res.text };
  },
};

/** Erreichbarkeits-Probe gegen GET /v1/models. Die Klassifikation erwartet den
 *  geparsten Body — sie prueft auf die OpenAI-Modell-Listenform (data-Array). */
export async function probeEndpoint(url: string, timeoutMs: number): Promise<EndpointStatus> {
  const res = await send(`${normalizeEndpoint(url)}/v1/models`, "GET", undefined, timeoutMs);
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

export async function pingEndpoint(url: string, timeoutMs: number): Promise<boolean> {
  return (await probeEndpoint(url, timeoutMs)).reachable;
}
