import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { TFile } from "./__mocks__/obsidian";
import { findByClass } from "./helpers/dom";
import { TransmuteView, type TransmuteViewDeps } from "../src/obsidian/view";
import { TransmuteSession } from "../src/core/session";
import type { PresetDef } from "../src/core/settings";
import type { FamilyId, ThinkingLevel } from "../src/vendor/kit/sampling-profiles";
import "../src/core/i18n/strings";

/** Ein Vault mit `n` Notizen — die Zahl ist der ganze Gegenstand dieses Tests. */
function fakeApp(n: number): App {
  const store: Record<string, string> = {};
  for (let i = 0; i < n; i++) store[`notiz-${i}.md`] = "irgendein Text";
  return {
    scope: undefined,
    // Die Modellzeile des Kits fragt nach dem Endpoint Manager (Eintrag „Anderer Endpunkt …“): ohne Manager gibt es den Eintrag nicht.
    plugins: { plugins: {} },
    vault: {
      getMarkdownFiles: () => Object.keys(store).map((path) => new TFile(path, "md")),
      getFileByPath: (path: string) => (path in store ? new TFile(path, "md") : null),
      cachedRead: (file: { path: string }) => Promise.resolve(store[file.path]),
    },
    metadataCache: { getFileCache: () => ({}) },
    workspace: {
      rootSplit: {},
      getMostRecentLeaf: () => null,
    },
  } as unknown as App;
}

/** Die Verbindung, wie die Modellzeile sie braucht (`ModelBarConnection` plus Familie und Backend fuer den Denk-Knopf). */
function fakeLlm(over: { family?: FamilyId | null; model?: string } = {}) {
  let model = over.model ?? "";
  const llm = {
    models: vi.fn(() => Promise.resolve({ models: ["qwen", "gemma"], reachable: true })),
    setModel: vi.fn((m: string) => { model = m; return Promise.resolve(); }),
    modelInUse: () => model,
    source: () => ({ family: over.family ?? null, backend: "lmstudio" as const, defaultModel: "qwen" }),
  };
  return llm;
}

function deps(
  scope: "file" | "selection" | "vault",
  presets: PresetDef[] = [],
  extra: { session?: TransmuteSession; llm?: ReturnType<typeof fakeLlm>; level?: ThinkingLevel } = {},
): TransmuteViewDeps & { setLevel: ReturnType<typeof vi.fn> } {
  // EINE Sitzung fuer die Lebensdauer der View: `onOpen` haengt einen `onChange`-Horcher
  // an, und eine je Aufruf neu gebaute Sitzung wuerde ihn ins Leere haengen.
  const session = extra.session ?? new TransmuteSession(
    { complete: () => Promise.resolve({ ok: true as const, content: "", reasoning: null, truncated: false }), now: () => 0, newTurnId: () => "t" },
    () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
  );
  const setLevel = vi.fn(() => Promise.resolve());
  return {
    session: () => session,
    defaultScope: () => scope,
    showTargetField: () => false,
    llm: extra.llm ?? fakeLlm(),
    thinking: { current: () => extra.level ?? "off", onLevel: () => "low" as const, setLevel },
    setLevel,
    runOptions: () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
    confirmThreshold: () => 50,
    getPresets: () => presets,
  };
}

/** `onOpen` ist protected — der Test ruft den Lebenszyklus, nicht eine Interna. */
const oeffnen = async (view: TransmuteView): Promise<void> => {
  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  // `refreshCandidates` ist async (es liest Dateien fuer den Beispieltext) und zeichnet
  // erst danach. Ein Tick reicht dem Fake-Vault.
  await new Promise((r) => setTimeout(r, 0));
};

describe("TransmuteView.onOpen", () => {
  // Regression 2026-09-02: `onOpen` rief `draw()` und `refreshModels()`, aber nie
  // `refreshCandidates()`. Wer Obsidian mit gespeichertem Bereich „Vault" startete, sah
  // „Keine Notiz passt zu diesem Bereich" fuer einen vollen Vault — die Kandidaten kamen
  // erst, wenn man ein Filterfeld anfasste. Gemessen im test-vault: `vaultPaths: 0` bei
  // 12.002 Notizen.
  it("berechnet die Kandidaten schon beim Oeffnen, wenn der Bereich Vault ist", async () => {
    const view = new TransmuteView({ app: fakeApp(12) } as unknown as WorkspaceLeaf, deps("vault"));
    await oeffnen(view);

    const zeile = findByClass<{ textContent?: string }>(view.contentEl, "transmute-candidates");
    expect(zeile?.textContent).toContain("12");
    expect(zeile?.textContent).not.toContain("No note matches");
  });

  it("laesst den Umfangs-Block bei Bereich Datei ganz weg", async () => {
    const view = new TransmuteView({ app: fakeApp(12) } as unknown as WorkspaceLeaf, deps("file"));
    await oeffnen(view);
    expect(findByClass(view.contentEl, "transmute-scope-block")).toBeNull();
  });
});

describe("TransmuteView — Hub mit Bibliothek", () => {
  const preset: PresetDef = { id: "p1", name: "Leerzeilen trimmen", regex: " +$", flags: "gm", replacement: "" };
  const hubOf = (view: TransmuteView): { currentTab(): string; setTab(id: string): void } =>
    (view as unknown as { hub: { currentTab(): string; setTab(id: string): void } }).hub;

  it("startet im Arbeitsbereich und kennt zwei Tabs", async () => {
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file", [preset]));
    await oeffnen(view);
    expect(hubOf(view).currentTab()).toBe("work");
    expect(findByClass(view.contentEl, "okit-hub-tabs")).not.toBeNull();
  });

  it("zeichnet die Bibliothek beim Tab-Wechsel aus den aktuellen Presets", async () => {
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file", [preset]));
    await oeffnen(view);
    expect(findByClass(view.contentEl, "transmute-library-row")).toBeNull();
    hubOf(view).setTab("library");
    expect(hubOf(view).currentTab()).toBe("library");
    expect(findByClass<{ textContent?: string }>(view.contentEl, "transmute-library-row")?.textContent).toContain("Leerzeilen trimmen");
  });

  it("Ausfuehren aus der Bibliothek setzt Regel und Felder und wechselt in den Arbeitsbereich", async () => {
    const d = deps("file", [preset]);
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, d);
    // Gemerkter Text: ohne Notiz meldet `pinScope` nichts Brauchbares — dann darf der Tab bleiben.
    (view as unknown as { pinScope(): unknown }).pinScope = () => ({ path: "a.md", name: "a", scope: "file", text: "x  ", baseOffset: 0 });
    await oeffnen(view);
    hubOf(view).setTab("library");
    findByClass<{ click(): void }>(view.contentEl, "transmute-preset-btn")?.click();
    expect(hubOf(view).currentTab()).toBe("work");
    // Die Regel-Felder zeigen die Regel, nicht nur die Sitzung kennt sie.
    expect(findByClass<{ value?: string }>(view.contentEl, "transmute-regex")?.value).toBe(" +$");
    const st = d.session().state;
    expect(st.phase).toBe("preview");
    if (st.phase === "preview") expect(st.versions[st.active]?.rule.regex).toBe(" +$");
  });

  it("bleibt in der Bibliothek, wenn der Lauf nicht starten kann (keine Notiz gemerkt)", async () => {
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file", [preset]));
    (view as unknown as { pinScope(): unknown }).pinScope = () => null;
    await oeffnen(view);
    hubOf(view).setTab("library");
    findByClass<{ click(): void }>(view.contentEl, "transmute-preset-btn")?.click();
    expect(hubOf(view).currentTab()).toBe("library");
  });
});


describe("TransmuteView — Modellzeile des Kits", () => {
  const draw = (view: TransmuteView): void => { (view as unknown as { draw(): void }).draw(); };

  // Der Voll-Draw leert den Arbeitsbereich bei jedem Zustandswechsel: stuende die Zeile darin, wuerde sie jedes Mal neu gebaut (und die alte nie freigegeben).
  it("steht ueber dem Arbeitsbereich, nicht in ihm", async () => {
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file"));
    await oeffnen(view);
    expect(findByClass(view.contentEl, "okit-model-bar")).not.toBeNull();
    const panel = findByClass(view.contentEl, "transmute-panel");
    expect(panel).not.toBeNull();
    expect(findByClass(panel as never, "okit-model-bar")).toBeNull();
  });

  it("bleibt bei jedem Neuzeichnen dieselbe Zeile", async () => {
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file"));
    await oeffnen(view);
    const vorher = findByClass(view.contentEl, "okit-model-bar");
    draw(view);
    draw(view);
    expect(findByClass(view.contentEl, "okit-model-bar")).toBe(vorher);
  });

  it("ist waehrend der Erzeugung gesperrt und danach wieder bedienbar", async () => {
    // Die Sitzung wiederholt eine leere Antwort: jede offene Anfrage wird beantwortet, bis sie ausserhalb von „generating“ steht.
    const offen: Array<() => void> = [];
    const session = new TransmuteSession(
      { complete: () => new Promise((resolve) => { offen.push(() => resolve({ ok: true as const, content: "", reasoning: null, truncated: false })); }), now: () => 0, newTurnId: () => "t" },
      () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
    );
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file", [], { session }));
    await oeffnen(view);
    const select = (): { disabled?: boolean } | null => findByClass(view.contentEl, "okit-model-bar-select");
    expect(select()?.disabled).toBe(false);
    void session.generate("ersetze a durch b", "a");
    await new Promise((r) => setTimeout(r, 0));
    expect(session.state.phase).toBe("generating");
    expect(select()?.disabled).toBe(true);
    for (let i = 0; i < 50 && session.state.phase === "generating"; i++) {
      offen.splice(0).forEach((f) => f());
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(session.state.phase).not.toBe("generating");
    expect(select()?.disabled).toBe(false);
  });

  it("bietet die Modelle des Endpunkts und schreibt eine Wahl in die Verbindung", async () => {
    const llm = fakeLlm();
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file", [], { llm }));
    await oeffnen(view);
    const select = findByClass<{ textContent?: string; value: string; dispatchEvent?(e: unknown): void; listeners?: unknown }>(view.contentEl, "okit-model-bar-select");
    expect(select?.textContent).toContain("qwen");
    expect(select?.textContent).toContain("gemma");
    expect(llm.models).toHaveBeenCalled();
  });

  // Die Familie kommt aus der Quelle (Manager/Erkennung), nicht aus dem Modellnamen: „Modell“ heisst hier nichts, die Quelle sagt gpt-oss.
  it("der Denk-Knopf folgt der Familie der Quelle und nennt die niedrigste Stufe mit dem Grund im aria-label", async () => {
    const d = deps("file", [], { llm: fakeLlm({ family: "gpt-oss", model: "irgendein-name" }) });
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, d);
    await oeffnen(view);
    const knopf = findByClass<{ textContent?: string; getAttribute(n: string): string | null; click(): void }>(view.contentEl, "okit-thinking-toggle");
    expect(knopf?.textContent).toContain("Thinking: lowest level");
    expect(knopf?.getAttribute("aria-label")).toContain("Thinking can't be fully turned off here");
    knopf?.click();
    expect(d.setLevel).toHaveBeenCalledWith("low");
  });

  it("onClose meldet die Zeile ab", async () => {
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file"));
    await oeffnen(view);
    expect(findByClass(view.contentEl, "okit-model-bar")).not.toBeNull();
    await (view as unknown as { onClose(): Promise<void> }).onClose();
    expect(findByClass(view.contentEl, "okit-model-bar")).toBeNull();
  });
});
