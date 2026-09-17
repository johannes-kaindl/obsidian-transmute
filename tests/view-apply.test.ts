import { describe, expect, it, vi } from "vitest";
import type { App, Editor, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "./__mocks__/obsidian";
import { TransmuteSession } from "../src/core/session";
import { TransmuteView, type TransmuteViewDeps } from "../src/obsidian/view";
import type { PanelHandlers } from "../src/obsidian/view-render";
import "../src/core/i18n/strings";

/**
 * Regression (Johannes' Quicktasks 2026-09-16): "Anwenden" leerte bisher die ganze
 * Runde (Muster, Flags, Ersetzung) — ein zweites Anwenden mit kleiner Korrektur
 * brauchte deshalb jedes Mal eine neue Anfrage von vorn. Dieser Test faehrt genau den
 * Fall "zweimal Anwenden mit Aenderung dazwischen", den auch der GUI-Smoke prueft.
 */
function fakeEditor(initial: string): Editor {
  let text = initial;
  return {
    getValue: () => text,
    getSelection: () => "",
    getCursor: () => ({ line: 0, ch: 0 }),
    posToOffset: (_pos: { line: number; ch: number }) => 0,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    transaction: (tx: { changes: { from: { ch: number }; to: { ch: number }; text: string }[] }) => {
      // Rueckwaerts anwenden: die Offsets vor der jeweiligen Aenderung bleiben gueltig.
      const sorted = [...tx.changes].sort((a, b) => b.from.ch - a.from.ch);
      for (const change of sorted) {
        text = text.slice(0, change.from.ch) + change.text + text.slice(change.to.ch);
      }
    },
  } as unknown as Editor;
}

function fakeApp(editor: Editor, path: string): App {
  const file = new TFile(path, "md");
  const view = new MarkdownView() as unknown as { file: unknown; editor: Editor; getMode(): string };
  Object.assign(view, { file, editor, getMode: () => "source" });

  return {
    vault: {
      getMarkdownFiles: () => [file],
      getFileByPath: () => file,
      cachedRead: () => Promise.resolve(editor.getValue()),
    },
    metadataCache: { getFileCache: () => ({}) },
    workspace: {
      rootSplit: { id: "root" },
      getMostRecentLeaf: () => ({ view }),
      iterateRootLeaves: (cb: (leaf: { view: unknown }) => void) => cb({ view }),
    },
  } as unknown as App;
}

function deps(session: TransmuteSession): TransmuteViewDeps {
  return {
    session: () => session,
    defaultScope: () => "file",
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

describe("Anwenden im Geltungsbereich Datei", () => {
  it("leert das Formular nicht — ein zweites Anwenden mit Aenderung dazwischen funktioniert", async () => {
    const editor = fakeEditor("alte Schreibweise und alte Schreibweise");
    const app = fakeApp(editor, "notiz.md");
    const session = new TransmuteSession(
      { complete: () => Promise.resolve({ ok: true as const, content: "", reasoning: null, truncated: false }), now: () => 0 },
      () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
    );

    const view = new TransmuteView({ app } as unknown as WorkspaceLeaf, deps(session));
    await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    const handlers = (view as unknown as { handlers(): PanelHandlers }).handlers();

    handlers.onStartManual();
    session.editRule({ regex: "alte", flags: "g", replacement: "neue" }, editor.getValue());

    handlers.onApply();
    expect(editor.getValue()).toBe("neue Schreibweise und neue Schreibweise");

    // Das Formular steht noch: derselbe Session-Zustand, nicht "idle".
    expect(session.state.phase).toBe("preview");
    expect(session.activeVersion?.rule.regex).toBe("alte");
    expect(session.activeVersion?.rule.replacement).toBe("neue");

    // Aenderung dazwischen — gegen den FRISCHEN (schon einmal angewendeten) Text.
    session.editRule({ regex: "und", replacement: "sowie" }, editor.getValue());
    handlers.onApply();

    expect(editor.getValue()).toBe("neue Schreibweise sowie neue Schreibweise");
  });

  it("Zuruecksetzen leert die Runde bewusst, danach tut ein weiteres Anwenden nichts", async () => {
    const editor = fakeEditor("alte Schreibweise");
    const app = fakeApp(editor, "notiz.md");
    const session = new TransmuteSession(
      { complete: () => Promise.resolve({ ok: true as const, content: "", reasoning: null, truncated: false }), now: () => 0 },
      () => ({ sampleChars: 400, budgetMs: 2000, maxHits: 500 }),
    );

    const view = new TransmuteView({ app } as unknown as WorkspaceLeaf, deps(session));
    await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    const handlers = (view as unknown as { handlers(): PanelHandlers }).handlers();

    handlers.onStartManual();
    session.editRule({ regex: "alte", flags: "g", replacement: "neue" }, editor.getValue());
    handlers.onApply();
    expect(editor.getValue()).toBe("neue Schreibweise");

    handlers.onReset();
    expect(session.state.phase).toBe("idle");

    // Ohne erneutes Pinnen tut ein weiteres Anwenden nichts mehr — die Runde ist leer.
    handlers.onApply();
    expect(editor.getValue()).toBe("neue Schreibweise");
  });
});
