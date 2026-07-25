import { describe, expect, it } from "vitest";
import { MarkdownView } from "./__mocks__/obsidian";
import { activeMarkdownView, applyHitsToEditor, readScope, viewForPath } from "../src/obsidian/editor-io";
import type { Editor, MarkdownView as MarkdownViewType, Workspace } from "obsidian";
import type { Hit } from "../src/core/types";

function workspaceWith(view: unknown): Workspace {
  return {
    rootSplit: { id: "root" },
    getMostRecentLeaf: () => ({ view }),
  } as unknown as Workspace;
}

function fakeEditor(text: string, selection = ""): Editor {
  return {
    getValue: () => text,
    getSelection: () => selection,
    getCursor: () => ({ line: 0, ch: 0 }),
    posToOffset: () => 7,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    transaction: () => undefined,
  } as unknown as Editor;
}

function fakeView(mode: string, editor: Editor): MarkdownViewType {
  const view = new MarkdownView() as unknown as MarkdownViewType;
  Object.assign(view, { getMode: () => mode, editor });
  return view;
}

describe("activeMarkdownView", () => {
  // Regression 0.2.0: mit getActiveViewOfType lieferte das beim Klick ins Seitenpanel
  // null — das Panel ist dann die aktive Ansicht und jede Aktion scheiterte mit
  // "oeffne zuerst eine Notiz", obwohl daneben eine Notiz offen war.
  it("findet die Notiz im Hauptbereich, auch wenn das Panel den Fokus hat", () => {
    const view = new MarkdownView();
    expect(activeMarkdownView(workspaceWith(view))).toBe(view);
  });

  it("gibt null zurueck, wenn im Hauptbereich keine Markdown-Notiz liegt", () => {
    expect(activeMarkdownView(workspaceWith({ notAView: true }))).toBeNull();
  });

  it("fragt den rootSplit ab, nicht den gesamten Workspace", () => {
    let asked: unknown = "nie aufgerufen";
    const workspace = {
      rootSplit: { id: "root" },
      getMostRecentLeaf: (container: unknown) => {
        asked = container;
        return null;
      },
    } as unknown as Workspace;
    activeMarkdownView(workspace);
    expect(asked).toEqual({ id: "root" });
  });
});

describe("viewForPath", () => {
  function workspaceWithLeaves(views: unknown[]): Workspace {
    return {
      iterateRootLeaves: (cb: (leaf: unknown) => void) => {
        for (const view of views) cb({ view });
      },
    } as unknown as Workspace;
  }

  function viewFor(path: string): MarkdownViewType {
    const view = new MarkdownView() as unknown as MarkdownViewType;
    Object.assign(view, { file: { path } });
    return view;
  }

  // Damit eine Regel an ihrer Notiz haengen bleibt: beim Nachschaerfen darf es egal sein,
  // welcher Reiter gerade Fokus hat.
  it("findet die Notiz zum Pfad, auch wenn ein anderer Reiter vorn ist", () => {
    const wanted = viewFor("Ordner/Ziel.md");
    const workspace = workspaceWithLeaves([viewFor("Andere.md"), wanted]);
    expect(viewForPath(workspace, "Ordner/Ziel.md")).toBe(wanted);
  });

  it("gibt null zurueck, wenn die Notiz nicht mehr offen ist", () => {
    expect(viewForPath(workspaceWithLeaves([viewFor("Andere.md")]), "Weg.md")).toBeNull();
  });

  it("ignoriert Blaetter ohne Markdown-Ansicht", () => {
    expect(viewForPath(workspaceWithLeaves([{ file: { path: "Ziel.md" } }]), "Ziel.md")).toBeNull();
  });
});

describe("readScope", () => {
  // Regression 0.2.0: im Lesemodus gibt es keine Editor-Auswahl — eine Markierung dort
  // ist eine reine Browser-Auswahl. Vorher meldete das "nichts ausgewaehlt", was den
  // Nutzer im Kreis schickte, obwohl sichtbar Text markiert war.
  it("meldet den Lesemodus als eigenen Fall, nicht als fehlende Auswahl", () => {
    const view = fakeView("preview", fakeEditor("inhalt", "markiert"));
    expect(readScope(view, "selection")).toEqual({ kind: "reading-mode" });
    expect(readScope(view, "file")).toEqual({ kind: "reading-mode" });
  });

  it("liest die ganze Notiz im file-Modus ab Offset 0", () => {
    const view = fakeView("source", fakeEditor("eins\nzwei"));
    expect(readScope(view, "file")).toEqual({ kind: "ok", text: "eins\nzwei", baseOffset: 0 });
  });

  it("liest die Auswahl mit ihrem Dokument-Offset", () => {
    const view = fakeView("source", fakeEditor("eins zwei", "zwei"));
    expect(readScope(view, "selection")).toEqual({ kind: "ok", text: "zwei", baseOffset: 7 });
  });

  it("meldet eine leere Auswahl als no-selection", () => {
    const view = fakeView("source", fakeEditor("eins"));
    expect(readScope(view, "selection")).toEqual({ kind: "no-selection" });
  });
});

const hit = (start: number, end: number, replacement: string): Hit => ({
  line: 0,
  lineStart: 0,
  start,
  end,
  matched: "",
  replacement,
  before: "",
  after: "",
});

describe("applyHitsToEditor", () => {
  function recordingEditor(): { editor: Editor; calls: unknown[] } {
    const calls: unknown[] = [];
    const editor = {
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      transaction: (tx: unknown) => calls.push(tx),
    } as unknown as Editor;
    return { editor, calls };
  }

  // Regression 0.2.0: vorher wurde das ganze Dokument durch den neuen Text ersetzt.
  // Das kostete zwei Undo-Schritte und warf Cursor sowie Scroll-Position weg.
  it("schreibt EINE Transaktion mit einer Aenderung je Treffer", () => {
    const { editor, calls } = recordingEditor();
    const applied = applyHitsToEditor(editor, [hit(0, 3, "X"), hit(4, 7, "Y")], [true, true], 0);
    expect(applied).toBe(2);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { changes: unknown[] }).changes).toHaveLength(2);
  });

  it("verschiebt die Aenderungen um den Offset des Ausschnitts", () => {
    const { editor, calls } = recordingEditor();
    applyHitsToEditor(editor, [hit(0, 3, "X")], [true], 100);
    const change = (calls[0] as { changes: { from: { ch: number }; to: { ch: number } }[] }).changes[0];
    expect(change.from.ch).toBe(100);
    expect(change.to.ch).toBe(103);
  });

  it("laesst abgewaehlte Treffer weg", () => {
    const { editor, calls } = recordingEditor();
    const applied = applyHitsToEditor(editor, [hit(0, 3, "X"), hit(4, 7, "Y")], [false, true], 0);
    expect(applied).toBe(1);
    expect((calls[0] as { changes: unknown[] }).changes).toHaveLength(1);
  });

  it("schreibt gar nicht, wenn nichts ausgewaehlt ist", () => {
    const { editor, calls } = recordingEditor();
    expect(applyHitsToEditor(editor, [hit(0, 3, "X")], [false], 0)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("sortiert die Aenderungen aufsteigend", () => {
    const { editor, calls } = recordingEditor();
    applyHitsToEditor(editor, [hit(10, 12, "spaet"), hit(0, 2, "frueh")], [true, true], 0);
    const changes = (calls[0] as { changes: { from: { ch: number } }[] }).changes;
    expect(changes[0].from.ch).toBe(0);
    expect(changes[1].from.ch).toBe(10);
  });
});
