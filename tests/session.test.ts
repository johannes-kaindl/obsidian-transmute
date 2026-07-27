import { describe, expect, it, vi } from "vitest";
import { TransmuteSession } from "../src/core/session";

const options = () => ({ sampleChars: 500, budgetMs: 1000, maxHits: 500 });
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
      expect(session.activeVersion!.hits).toHaveLength(1);
      expect(session.activeVersion!.selected).toEqual([true]);
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
    if (session.state.phase === "preview") expect(session.activeVersion!.hits).toHaveLength(0);
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
    if (session.state.phase === "preview") expect(session.activeVersion!.selected[0]).toBe(false);
  });

  it("setzt alle Treffer gemeinsam", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("o") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("x", "foo");
    session.setAll(false);
    if (session.state.phase === "preview") expect(session.activeVersion!.selected.every((s) => !s)).toBe(true);
  });
});

describe("TransmuteSession.revalidate", () => {
  async function previewed() {
    const complete = vi.fn().mockResolvedValue({ ok: true, content: answer("#alt") });
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("tag umbenennen", "Ein #alt Tag.");
    return session;
  }

  // Der reale Ausloeser: ein Linter schreibt beim Speichern "updated:" ins Frontmatter.
  // Der Fundtext ist unveraendert, nur seine Position hat sich verschoben — das darf
  // das Anwenden nicht blockieren.
  it("akzeptiert verschobenen Text, solange dieselben Ersetzungen herauskommen", async () => {
    const session = await previewed();
    const fresh = session.revalidate("---\nupdated: 13:51\n---\n\nEin #alt Tag.");
    expect(fresh.kind).toBe("ok");
    if (fresh.kind === "ok") expect(fresh.hits[0].matched).toBe("#alt");
  });

  it("meldet eine Aenderung, wenn ein Treffer dazugekommen ist", async () => {
    const session = await previewed();
    expect(session.revalidate("Ein #alt Tag und noch ein #alt Tag.").kind).toBe("changed");
  });

  it("meldet eine Aenderung, wenn der Fundtext weg ist", async () => {
    const session = await previewed();
    expect(session.revalidate("Nichts mehr davon.").kind).toBe("changed");
  });

  it("meldet eine Aenderung, wenn gar keine Vorschau laeuft", () => {
    const complete = vi.fn();
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    expect(session.revalidate("egal").kind).toBe("changed");
  });
});

describe("TransmuteSession — Verlauf", () => {
  const rule = (regex: string) => ({ ok: true, content: answer(regex) });

  async function twoRounds() {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(rule("#alt"))
      .mockResolvedValueOnce(rule("#alt\\b"));
    const session = new TransmuteSession({ complete, now: () => 0 }, options);
    await session.generate("tag umbenennen", "Ein #alt Tag und ein #alter Begriff.");
    await session.refine("nur exakt #alt", "Ein #alt Tag und ein #alter Begriff.");
    return { session, complete };
  }

  it("haelt jeden Stand fest und zeigt den letzten", async () => {
    const { session } = await twoRounds();
    expect(session.state.phase).toBe("preview");
    if (session.state.phase === "preview") {
      expect(session.state.versions).toHaveLength(2);
      expect(session.state.active).toBe(1);
      expect(session.state.versions[0].instruction).toBe("tag umbenennen");
      expect(session.state.versions[1].instruction).toBe("nur exakt #alt");
    }
  });

  // Der Grund fuer das Feature: der dritte Versuch kann schlechter sein als der erste.
  it("wechselt zu einem frueheren Stand zurueck, ohne die spaeteren zu verlieren", async () => {
    const { session } = await twoRounds();
    session.selectVersion(0);
    expect(session.activeVersion?.rule.regex).toBe("#alt");
    if (session.state.phase === "preview") expect(session.state.versions).toHaveLength(2);
  });

  it("ignoriert Wechsel auf einen Stand, den es nicht gibt", async () => {
    const { session } = await twoRounds();
    session.selectVersion(9);
    expect(session.activeVersion?.rule.regex).toBe("#alt\\b");
  });

  it("haelt die Haekchen je Stand, nicht je Sitzung", async () => {
    const { session } = await twoRounds();
    session.setAll(false);
    session.selectVersion(0);
    expect(session.activeVersion?.selected.every((on) => on)).toBe(true);
    session.selectVersion(1);
    expect(session.activeVersion?.selected.some((on) => on)).toBe(false);
  });

  // Wer im Verlauf zurueckgeht und von dort nachschaerft, meint diesen Stand — nicht den
  // letzten. Sonst waere die Rueckwahl folgenlos.
  it("baut ein Nachschaerfen auf dem aktiven Stand auf, nicht auf dem letzten", async () => {
    const { session, complete } = await twoRounds();
    session.selectVersion(0);
    complete.mockResolvedValueOnce(rule("#alt$"));
    await session.refine("noch anders", "Ein #alt Tag.");

    const messages = complete.mock.calls[2][0] as { role: string; content: string }[];
    const assistantTurns = messages.filter((m) => m.role === "assistant");
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].content).toContain("#alt");
    expect(assistantTurns[0].content).not.toContain("#alt\\\\b");
  });

  it("verwirft mit reset den ganzen Verlauf", async () => {
    const { session } = await twoRounds();
    session.reset();
    expect(session.state.phase).toBe("idle");
    expect(session.activeVersion).toBeNull();
  });
});
