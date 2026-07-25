import { describe, expect, it, vi } from "vitest";
import { EndpointResolver } from "../src/obsidian/endpoint";

describe("EndpointResolver", () => {
  it("nimmt den ersten erreichbaren Endpunkt", async () => {
    const ping = vi.fn(async (e: string) => e === "b");
    const r = new EndpointResolver(() => ["a", "b"], ping);
    await expect(r.resolve()).resolves.toBe("b");
  });

  it("cached das Ergebnis ueber mehrere Aufrufe", async () => {
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => ["a"], ping);
    await r.resolve();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("cached einen Fehlschlag NICHT", async () => {
    const ping = vi.fn(async () => false);
    const r = new EndpointResolver(() => ["a"], ping);
    await r.resolve();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("teilt einen laufenden Resolve zwischen gleichzeitigen Aufrufern", async () => {
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => ["a"], ping);
    await Promise.all([r.resolve(), r.resolve()]);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("probt nach invalidate erneut", async () => {
    const ping = vi.fn(async () => true);
    const r = new EndpointResolver(() => ["a"], ping);
    await r.resolve();
    r.invalidate();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
