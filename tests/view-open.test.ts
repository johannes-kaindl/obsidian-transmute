import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { TFile } from "./__mocks__/obsidian";
import { findByClass } from "./helpers/dom";
import { TransmuteView, type TransmuteViewDeps } from "../src/obsidian/view";
import { TransmuteSession } from "../src/core/session";
import type { PresetDef } from "../src/core/settings";
import type { FamilyId, ThinkingLevel } from "../src/vendor/kit/sampling-profiles";
import type { ApiErrorCode } from "../src/vendor/kit/endpoint-source";
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

export interface FakeEndpoints {
  list: Array<{ id: string; label: string; defaultModel?: string }>;
  active?: string;
  choice?: { endpointId?: string; model?: string };
  lists?: Record<string, { models: string[]; reachable: boolean }>;
  /** Grund einer verwaisten Wahl (`source().reason`), wie ihn die Kit-Verbindung meldet. */
  reason?: ApiErrorCode;
}

/** Die Verbindung, wie die Modellzeile sie braucht (`ModelBarConnection`, Kit 0.87.0 bis 0.89.0, plus Familie und Backend fuer den Denk-Knopf). Ohne `endpoints` ein Adapter ohne Manager
 *  (die Zeile zeigt eine Liste ohne Gruppen); mit `endpoints` die Gruppen je Endpunkt, `setChoice` schreibt die Wahl und meldet an die Abonnenten wie `LlmConnection`. */
function fakeLlm(over: { family?: FamilyId | null; model?: string; endpoints?: FakeEndpoints } = {}) {
  let model = over.model ?? "";
  const fe: FakeEndpoints = over.endpoints ?? { list: [] };
  const subs = new Set<() => void>();
  const notify = (): void => { for (const cb of [...subs]) cb(); };
  const llm = {
    fe,
    subs,
    notify,
    models: vi.fn(() => Promise.resolve({ models: ["qwen", "gemma"], reachable: true })),
    setModel: vi.fn((m: string) => { model = m; return Promise.resolve(); }),
    modelInUse: () => model,
    source: () => ({ family: over.family ?? null, backend: "lmstudio" as const, defaultModel: "qwen", ...(fe.reason === undefined ? {} : { reason: fe.reason }) }),
    endpoints: () => fe.list,
    activeEndpointId: () => fe.active,
    modelsOf: vi.fn((id: string) => Promise.resolve(fe.lists?.[id] ?? { models: [], reachable: false })),
    choice: () => fe.choice ?? {},
    setChoice: vi.fn((c: { endpointId?: string; model?: string }) => { fe.choice = c; if (c.endpointId !== undefined) fe.active = c.endpointId; fe.reason = undefined; notify(); return Promise.resolve(); }),
    subscribe: (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
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
  it("die Denk-Steuerung folgt der Familie der Quelle: gpt-oss kann nicht ganz aus, das Dropdown zeigt die niedrigste Stufe (minimal, code-kit 0.65.0) und bietet kein \"off\"", async () => {
    type Dd = { getAttribute?(n: string): string | null; __component?: { getValue(): string; options: Record<string, string>; onChangeCB: ((v: string) => unknown) | null } };
    const d = deps("file", [], { llm: fakeLlm({ family: "gpt-oss", model: "irgendein-name" }) });
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, d);
    await oeffnen(view);
    const ctl = findByClass<{ children?: Dd[] }>(view.contentEl, "okit-thinking-control");
    const dd = (ctl?.children ?? []).find((c) => c.__component !== undefined);
    expect(dd).toBeDefined();
    expect(dd?.__component?.getValue()).toBe("minimal");
    expect(Object.keys(dd?.__component?.options ?? {})).toEqual(["minimal", "low", "medium", "high"]);
    await dd?.__component?.onChangeCB?.("low");
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

describe("Modellzeile mit Endpunkten (Kit 0.89.0: Gruppen, verwaiste Wahl, Selbst-Abo)", () => {
  type El = { children?: El[]; textContent?: string; value: string; className?: string; getAttribute?(n: string): string | null; _listeners?: Record<string, Array<() => void>> };
  const zwei = (): FakeEndpoints => ({
    list: [{ id: "a", label: "Lokal", defaultModel: "qwen" }, { id: "b", label: "Zweiter" }],
    active: "a",
    choice: {},
    lists: { a: { models: ["qwen", "gemma"], reachable: true }, b: { models: ["x1"], reachable: true } },
  });
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const oeffneMit = async (endpoints: FakeEndpoints) => {
    const llm = fakeLlm({ endpoints });
    const view = new TransmuteView({ app: fakeApp(1) } as unknown as WorkspaceLeaf, deps("file", [], { llm }));
    await oeffnen(view);
    await tick(); await tick();
    return { llm, view };
  };
  const gruppen = (view: TransmuteView): El[] => (findByClass<El>(view.contentEl, "okit-model-bar-select")?.children ?? []).filter((c) => (c.getAttribute?.("label") ?? null) !== null);
  const texte = (g: El): string[] => (g.children ?? []).map((o) => o.textContent ?? "");

  it("zeigt je Endpunkt eine Gruppe mit dessen Modellen", async () => {
    const { view } = await oeffneMit(zwei());
    const g = gruppen(view);
    expect(g.map((x) => x.getAttribute?.("label"))).toEqual(["Lokal", "Zweiter"]);
    expect(texte(g[0])).toEqual(expect.arrayContaining(["qwen", "gemma"]));
    expect(texte(g[1])).toContain("x1");
  });

  it("eine Wahl unter einem anderen Endpunkt ruft setChoice mit Endpunkt UND Modell, nie setModel", async () => {
    const { view, llm } = await oeffneMit(zwei());
    const select = findByClass<El>(view.contentEl, "okit-model-bar-select")!;
    const wert = gruppen(view)[1].children?.find((o) => o.textContent === "x1")?.getAttribute?.("value");
    expect(wert).toBeTruthy();
    select.value = wert as string;
    select._listeners?.change?.forEach((cb) => cb());
    await tick(); await tick();
    expect(llm.setChoice).toHaveBeenCalledWith({ endpointId: "b", model: "x1" });
    expect(llm.setModel).not.toHaveBeenCalled();
  });

  it("verwaiste Wahl: Automatisch mit Warnzeichen und Grund, die gespeicherte Wahl bleibt unangetastet", async () => {
    const e = zwei();
    e.choice = { endpointId: "gone", model: "alt" };
    e.reason = "not-found";
    const { view, llm } = await oeffneMit(e);
    const warn = findByClass<El>(view.contentEl, "okit-model-bar-warn")!;
    expect(warn.className).not.toContain("is-hidden");
    expect((warn.getAttribute?.("aria-label") ?? "").length).toBeGreaterThan(0);
    expect(findByClass<El>(view.contentEl, "okit-model-bar-select")?.value).toBe("");
    expect(e.choice).toEqual({ endpointId: "gone", model: "alt" });
    expect(llm.setChoice).not.toHaveBeenCalled();
  });

  it("Selbst-Abo: ein Wechsel, den die Verbindung meldet, zeichnet die Zeile neu; onClose meldet ab", async () => {
    const e = zwei();
    const { view, llm } = await oeffneMit(e);
    expect(llm.subs.size).toBe(1);
    expect(findByClass<El>(view.contentEl, "okit-model-bar-select")?.value).toBe("");
    e.choice = { endpointId: "b", model: "x1" };
    e.active = "b";
    llm.notify();
    await tick();
    expect(findByClass<El>(view.contentEl, "okit-model-bar-select")?.value).not.toBe("");
    await (view as unknown as { onClose(): Promise<void> }).onClose();
    expect(llm.subs.size).toBe(0);
  });
});
