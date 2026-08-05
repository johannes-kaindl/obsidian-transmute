import { describe, expect, it, afterEach, beforeAll, afterAll } from "vitest";
import { requestUrl } from "obsidian";
import { probeEndpoint, pingEndpoint } from "../src/obsidian/http";
import { authHeaders } from "../src/vendor/kit/endpoint_config";

const okBody = JSON.stringify({ data: [{ id: "m1" }] });

// Testumgebung ist "node" (kein jsdom, siehe vitest.config.ts) — http.ts braucht
// window.setTimeout/clearTimeout (PROF-OBS-13, s. Kommentar dort). Stub global.window
// mit den echten Node-Timern und mach das nach dieser Datei wieder rueckgaengig.
const hadWindow = "window" in globalThis;
const previousWindow = (globalThis as any).window;
beforeAll(() => {
  (globalThis as any).window = { setTimeout, clearTimeout };
});
afterAll(() => {
  if (hadWindow) (globalThis as any).window = previousWindow;
  else delete (globalThis as any).window;
});

afterEach(() => {
  (requestUrl as any).mockImplementation((..._args: any[]) => Promise.resolve({
    status: 200, headers: {}, text: "", json: {}, arrayBuffer: new ArrayBuffer(0),
  }));
});

describe("probeEndpoint/pingEndpoint — Schluessel-Weitergabe", () => {
  it("reicht authHeaders(ep.apiKey) an requestUrl durch, wenn ein Schluessel gesetzt ist", async () => {
    const calls: any[] = [];
    (requestUrl as any).mockImplementation((args: any) => {
      calls.push(args);
      return Promise.resolve({ status: 200, headers: {}, text: okBody, json: {}, arrayBuffer: new ArrayBuffer(0) });
    });

    const status = await probeEndpoint({ url: "https://api.example.com", apiKey: "sk-secret" }, 1000);

    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toEqual(authHeaders("sk-secret"));
    expect(calls[0].headers).toEqual({ Authorization: "Bearer sk-secret" });
    expect(status.reachable).toBe(true);
  });

  it("ohne Schluessel bleibt der Header leer — kein Authorization fuer lokale Server", async () => {
    const calls: any[] = [];
    (requestUrl as any).mockImplementation((args: any) => {
      calls.push(args);
      return Promise.resolve({ status: 200, headers: {}, text: okBody, json: {}, arrayBuffer: new ArrayBuffer(0) });
    });

    await probeEndpoint({ url: "https://api.example.com" }, 1000);

    expect(calls[0].headers).toEqual({});
  });

  it("pingEndpoint reicht den Schluessel ueber probeEndpoint ebenfalls durch", async () => {
    const calls: any[] = [];
    (requestUrl as any).mockImplementation((args: any) => {
      calls.push(args);
      return Promise.resolve({ status: 200, headers: {}, text: okBody, json: {}, arrayBuffer: new ArrayBuffer(0) });
    });

    const reachable = await pingEndpoint({ url: "https://api.example.com", apiKey: "sk-y" }, 1000);

    expect(calls[0].headers).toEqual({ Authorization: "Bearer sk-y" });
    expect(reachable).toBe(true);
  });

  it("fehlt der Schluessel an einem gehosteten Endpunkt (401), gilt er als nicht erreichbar — der stille Fehlschlag, den diese Kampagne beheben soll", async () => {
    (requestUrl as any).mockImplementation((args: any) => {
      const auth = args.headers?.Authorization;
      const status = auth === "Bearer sk-secret" ? 200 : 401;
      const text = status === 200 ? okBody : JSON.stringify({ error: "unauthorized" });
      return Promise.resolve({ status, headers: {}, text, json: {}, arrayBuffer: new ArrayBuffer(0) });
    });

    const withoutKey = await pingEndpoint({ url: "https://api.example.com" }, 1000);
    const withKey = await pingEndpoint({ url: "https://api.example.com", apiKey: "sk-secret" }, 1000);

    expect(withoutKey).toBe(false);
    expect(withKey).toBe(true);
  });
});
