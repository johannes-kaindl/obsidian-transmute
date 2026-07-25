import { describe, expect, it, vi } from "vitest";
import { TransmuteSession } from "../src/core/session";

const options = () => ({ sampleChars: 500, budgetMs: 1000 });
const answer = (regex: string) => JSON.stringify({ regex, flags: "", replacement: "X", explanation: "e" });

describe("TransmuteSession", () => {
  it("geht von idle ueber generating nach preview", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("foo") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    const seen: string[] = [];
    session.onChange((s) => seen.push(s.phase));
    await session.generate("ersetze foo", "foo bar");
    expect(seen).toContain("generating");
    expect(session.state.phase).toBe("preview");
    if (session.state.phase === "preview") {
      expect(session.state.hits).toHaveLength(1);
      expect(session.state.selected).toEqual([true]);
    }
  });

  it("nutzt genau einen Retry bei kaputtem JSON", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "nope" })
      .mockResolvedValueOnce({ ok: true, content: answer("foo") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(session.state.phase).toBe("preview");
  });

  it("gibt nach dem zweiten Fehlschlag auf und haelt die Rohantwort", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: "nope" });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(session.state.phase).toBe("error");
    if (session.state.phase === "error") {
      expect(session.state.messageKey).toBe("error.noJson");
      expect(session.state.raw).toBe("nope");
    }
  });

  it("gibt ein riskantes Muster mit Begruendung zurueck ans Modell", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: answer("(a+)+") })
      .mockResolvedValueOnce({ ok: true, content: answer("a+") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "aaa");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(session.state.phase).toBe("preview");
  });

  it("meldet ein durchgehend riskantes Muster mit dem Risiko-Key", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("(a+)+") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "aaa");
    expect(session.state.phase).toBe("error");
    if (session.state.phase === "error") expect(session.state.messageKey).toBe("risk.nested-quantifier");
  });

  it("behandelt null Treffer als preview, nicht als Fehler", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("zzz") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    expect(session.state.phase).toBe("preview");
    if (session.state.phase === "preview") expect(session.state.hits).toHaveLength(0);
  });

  it("meldet einen Endpunkt-Ausfall mit eigenem Key", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: false, error: "ECONNREFUSED" });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    expect(session.state.phase).toBe("error");
    if (session.state.phase === "error") {
      expect(session.state.messageKey).toBe("error.endpoint");
      expect(session.state.args[0]).toBe("ECONNREFUSED");
    }
  });

  it("schickt beim Nachschaerfen echte Treffer mit", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("foo") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("erste", "foo bar");
    await session.refine("aber anders", "foo bar");
    const lastCall = complete.mock.calls.at(-1)?.[0] as { content: string }[];
    expect(JSON.stringify(lastCall)).toContain("foo bar");
    expect(JSON.stringify(lastCall)).toContain("aber anders");
  });

  it("toggelt die Auswahl eines Treffers", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("o") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    session.toggle(0);
    if (session.state.phase === "preview") expect(session.state.selected[0]).toBe(false);
  });

  it("setzt alle Treffer gemeinsam", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("o") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    session.setAll(false);
    if (session.state.phase === "preview") expect(session.state.selected.every((s) => !s)).toBe(true);
  });
});
