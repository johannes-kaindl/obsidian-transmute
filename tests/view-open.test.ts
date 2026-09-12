import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { TFile } from "./__mocks__/obsidian";
import { findByClass } from "./helpers/dom";
import { TransmuteView, type TransmuteViewDeps } from "../src/obsidian/view";
import { TransmuteSession } from "../src/core/session";
import "../src/core/i18n/strings";

/** Ein Vault mit `n` Notizen — die Zahl ist der ganze Gegenstand dieses Tests. */
function fakeApp(n: number): App {
  const store: Record<string, string> = {};
  for (let i = 0; i < n; i++) store[`notiz-${i}.md`] = "irgendein Text";
  return {
    scope: undefined,
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

function deps(scope: "file" | "selection" | "vault"): TransmuteViewDeps {
  // EINE Sitzung fuer die Lebensdauer der View: `onOpen` haengt einen `onChange`-Horcher
  // an, und eine je Aufruf neu gebaute Sitzung wuerde ihn ins Leere haengen.
  const session = new TransmuteSession(
    { complete: () => Promise.resolve({ ok: true as const, content: "", reasoning: null }), now: () => 0 },
    () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
  );
  return {
    session: () => session,
    defaultScope: () => scope,
    showTargetField: () => false,
    listModels: () => Promise.resolve([]),
    getModel: () => "",
    setModel: vi.fn(),
    getSuppressReasoning: () => false,
    setSuppressReasoning: vi.fn(),
    runOptions: () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
    confirmThreshold: () => 50,
    snapshotKeep: () => 5,
    getPresets: () => [],
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
