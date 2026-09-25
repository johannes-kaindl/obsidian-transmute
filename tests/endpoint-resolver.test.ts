import { describe, expect, it, vi } from "vitest";
import { EndpointResolver } from "../src/obsidian/endpoint";
import type { EndpointConfig } from "../src/vendor/kit/endpoint_config";

const cfg = (url: string): EndpointConfig => ({ url });

describe("EndpointResolver", () => {
  it("nimmt den ersten erreichbaren Endpunkt", async () => {
    const ping = vi.fn(async (e: EndpointConfig) => e.url === "b");
    const r = new EndpointResolver(() => [cfg("a"), cfg("b")], ping);
    await expect(r.resolve()).resolves.toEqual(cfg("b"));
  });

  it("cached das Ergebnis ueber mehrere Aufrufe", async () => {
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => [cfg("a")], ping);
    await r.resolve();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("cached einen Fehlschlag NICHT", async () => {
    const ping = vi.fn(async () => false);
    const r = new EndpointResolver(() => [cfg("a")], ping);
    await r.resolve();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("teilt einen laufenden Resolve zwischen gleichzeitigen Aufrufern", async () => {
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => [cfg("a")], ping);
    await Promise.all([r.resolve(), r.resolve()]);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("probt nach invalidate erneut", async () => {
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => [cfg("a")], ping);
    await r.resolve();
    r.invalidate();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("reicht apiKey an ping durch und behaelt ihn im aufgeloesten Eintrag — fehlt er hier, gilt ein gehosteter Endpunkt nie als erreichbar", async () => {
    const withKey: EndpointConfig = { url: "https://api.example.com", apiKey: "sk-secret" };
    const ping = vi.fn(async (e: EndpointConfig) => e.apiKey === "sk-secret");
    const r = new EndpointResolver(() => [withKey], ping);

    const resolved = await r.resolve();

    expect(ping).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-secret" }));
    expect(resolved).toEqual(expect.objectContaining({ apiKey: "sk-secret" }));
  });
});

describe("EndpointResolver — Manager-Vorrang (Kit endpoint-source)", () => {
  const managerApi = (over: Partial<Record<string, unknown>> = {}) => ({
    version: 1 as const,
    list: vi.fn(() => []),
    get: vi.fn(() => null),
    resolve: vi.fn(async () => ({ id: "m1", label: "M", config: { url: "http://manager", apiKey: "k" }, defaultModel: "qwen-x" })),
    materialize: vi.fn(async () => ({ error: "not-found" as const })),
    models: vi.fn(async () => []),
    importEndpoints: vi.fn(async () => ({ added: [], merged: [], skipped: [] })),
    on: vi.fn(() => () => {}),
    ...over,
  });

  it("nimmt den Manager, wenn er da ist, und ignoriert die lokale Liste", async () => {
    const ping = vi.fn(async () => true);
    const api = managerApi();
    const r = new EndpointResolver(() => [cfg("lokal")], ping, { manager: () => api, choice: () => ({}) });
    await expect(r.resolve()).resolves.toEqual({ url: "http://manager", apiKey: "k" });
    expect(api.resolve).toHaveBeenCalledWith("chat", { caller: "transmute" });
    expect(ping).not.toHaveBeenCalled();
    expect(r.last?.kind).toBe("manager");
    expect(r.last?.sentModel).toBe("qwen-x");
  });

  it("cached den Manager-Pfad nicht — der Manager cached sich selbst", async () => {
    const api = managerApi();
    const r = new EndpointResolver(() => [], async () => true, { manager: () => api, choice: () => ({}) });
    await r.resolve();
    await r.resolve();
    expect(api.resolve).toHaveBeenCalledTimes(2);
  });

  it("die Modellwahl des Nutzers schlaegt den Standard des Endpunkts", async () => {
    const api = managerApi();
    const r = new EndpointResolver(() => [], async () => true, { manager: () => api, choice: () => ({ model: "mein-modell" }) });
    await r.resolve();
    expect(r.last?.model).toBe("mein-modell");
  });

  it("meldet den Grund, wenn der Manager keinen Endpunkt liefert — ohne lokalen Rueckfall", async () => {
    const api = managerApi({ resolve: vi.fn(async () => ({ error: "secret-missing" as const })) });
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => [cfg("lokal")], ping, { manager: () => api, choice: () => ({}) });
    await expect(r.resolve()).resolves.toBeNull();
    expect(r.last?.reason).toBe("secret-missing");
    expect(ping).not.toHaveBeenCalled();
  });

  it("faellt ohne Manager auf die lokale Liste zurueck und ignoriert dann eine alte Modellwahl", async () => {
    const r = new EndpointResolver(() => [cfg("lokal")], async () => true, { manager: () => null, choice: () => ({ model: "alt-vom-manager" }) });
    await expect(r.resolve()).resolves.toEqual(cfg("lokal"));
    expect(r.last?.kind).toBe("local");
    expect(r.last?.model).toBe("");
  });

  it("ein gecachter lokaler Endpunkt gilt nicht mehr, sobald ein Manager auftaucht", async () => {
    let manager: ReturnType<typeof managerApi> | null = null;
    const r = new EndpointResolver(() => [cfg("lokal")], async () => true, { manager: () => manager, choice: () => ({}) });
    await expect(r.resolve()).resolves.toEqual(cfg("lokal"));
    manager = managerApi();
    await expect(r.resolve()).resolves.toEqual({ url: "http://manager", apiKey: "k" });
  });
});
