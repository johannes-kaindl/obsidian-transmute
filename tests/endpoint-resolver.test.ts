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
