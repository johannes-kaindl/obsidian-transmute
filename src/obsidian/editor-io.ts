import { MarkdownView, type Editor, type Workspace } from "obsidian";
import type { ScopeKind } from "../core/settings";
import type { Hit } from "../core/types";

/**
 * Die zuletzt genutzte Notiz im Hauptbereich.
 *
 * NICHT `getActiveViewOfType`: sobald man ins Seitenpanel klickt, IST das Panel die aktive
 * Ansicht — es gibt dann keine „aktive" Notiz und jede Aktion scheitert mit „öffne zuerst
 * eine Notiz", obwohl daneben eine offen ist. `rootSplit` klammert die Sidebars aus.
 * (Dieselbe Falle wie in yijing-oracle/src/obsidian/reading-writer.ts.)
 */
export function activeMarkdownView(workspace: Workspace): MarkdownView | null {
  const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
  return leaf?.view instanceof MarkdownView ? leaf.view : null;
}

export type ScopeRead =
  /** baseOffset = Dokument-Offset, an dem der gelesene Ausschnitt beginnt. */
  | { kind: "ok"; text: string; baseOffset: number }
  | { kind: "reading-mode" }
  | { kind: "no-selection" };

/**
 * Liest den Arbeitsbereich aus der Notiz.
 *
 * Im **Lesemodus** gibt es keine Editor-Auswahl und kein sicher beschreibbares Dokument —
 * eine Markierung dort ist eine reine Browser-Auswahl, die der Editor nicht kennt. Das
 * wird als eigener Fall gemeldet statt als „nichts ausgewählt": die Meldung soll sagen,
 * was zu tun ist, nicht was fehlt.
 */
export function readScope(view: MarkdownView, scope: ScopeKind): ScopeRead {
  if (view.getMode() !== "source") return { kind: "reading-mode" };

  const editor = view.editor;
  if (scope === "selection") {
    const text = editor.getSelection();
    if (text.length === 0) return { kind: "no-selection" };
    return { kind: "ok", text, baseOffset: editor.posToOffset(editor.getCursor("from")) };
  }
  return { kind: "ok", text: editor.getValue(), baseOffset: 0 };
}

/**
 * Wendet die ausgewählten Treffer als EINE Transaktion an.
 *
 * Bewusst nicht „ganzes Dokument durch neuen Text ersetzen": eine Transaktion aus
 * Einzeländerungen fasst Obsidian zu **einem** Undo-Schritt zusammen, lässt unberührten
 * Text unberührt und erhält Cursor und Scroll-Position. Deshalb braucht v0.1 auch kein
 * eigenes Snapshot-System — Cmd+Z genügt.
 *
 * @returns Anzahl angewandter Treffer.
 */
export function applyHitsToEditor(
  editor: Editor,
  hits: Hit[],
  selected: boolean[],
  baseOffset: number,
): number {
  const changes = hits
    .map((hit, index) => ({ hit, keep: selected[index] === true }))
    .filter((entry) => entry.keep)
    .map((entry) => entry.hit)
    .sort((a, b) => a.start - b.start)
    .map((hit) => ({
      from: editor.offsetToPos(baseOffset + hit.start),
      to: editor.offsetToPos(baseOffset + hit.end),
      text: hit.replacement,
    }));

  if (changes.length === 0) return 0;
  editor.transaction({ changes });
  return changes.length;
}
