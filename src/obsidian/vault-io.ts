import { TFile, type App } from "obsidian";
import { evaluate, type EvalOptions } from "../core/regex/evaluate";
import { applyHitsToText, sameHits } from "../core/vault/apply";
import type { FileHits, ReadFile } from "../core/vault/run";
import { selectCandidates, type Candidate, type VaultFilter } from "../core/vault/scope";
import { hashText, type SnapshotEntry } from "../core/vault/snapshot";
import type { RuleDraft } from "../core/types";

type FileCache = { frontmatter?: Record<string, unknown>; tags?: { tag: string }[] } | null;

/**
 * Tags stehen an zwei Stellen: im Frontmatter (`tags:`) und im Text (`#tag`).
 *
 * Der metadataCache fuehrt sie getrennt — wer nur eine Quelle liest, laesst die Haelfte
 * der Notizen aus dem Umfang fallen.
 */
function tagsOf(cache: FileCache): string[] {
  const out: string[] = [];
  const fm = cache?.frontmatter?.tags;
  if (Array.isArray(fm)) out.push(...fm.map((t) => String(t)));
  else if (typeof fm === "string") out.push(fm);
  for (const t of cache?.tags ?? []) out.push(t.tag);
  return out;
}

export function listCandidates(app: App, filter: VaultFilter): string[] {
  // getMarkdownFiles() statt gefiltertem getFiles() — Scanner-Regel `vault/iterate`.
  const all: Candidate[] = app.vault.getMarkdownFiles().map((file) => {
    const cache = app.metadataCache.getFileCache(file);
    return {
      path: file.path,
      tags: tagsOf(cache),
      frontmatter: cache?.frontmatter ?? {},
    };
  });
  return selectCandidates(all, filter);
}

function fileAt(app: App, path: string): TFile | null {
  const file = app.vault.getFileByPath(path);
  return file instanceof TFile ? file : null;
}

export function makeReader(app: App): ReadFile {
  return async (path) => {
    const file = fileAt(app, path);
    if (file === null) return null;
    try {
      // cachedRead statt read: derselbe Inhalt, aber ohne Platte, wenn Obsidian ihn hat.
      return await app.vault.cachedRead(file);
    } catch {
      return null;
    }
  };
}

export type WriteOutcome = {
  written: number;
  hits: number;
  skippedChanged: string[];
  entries: SnapshotEntry[];
  failedAt: { path: string; message: string } | null;
};

/**
 * Schreibt die ausgewaehlten Treffer.
 *
 * Der Drift-Schutz sitzt IM `process`-Callback: dort liegt der frische Inhalt ohnehin
 * vor, und `process` macht read-modify-write atomar. Weicht die Treffermenge ab, bleibt
 * die Datei unveraendert — neu zu ersetzen hiesse, Treffer zu schreiben, die niemand
 * gesehen hat.
 *
 * Voraussetzung: der Snapshot der betroffenen Dateien liegt bereits. Diese Funktion
 * sichert nicht selbst.
 */
export async function writeSelected(
  app: App,
  files: FileHits[],
  rule: RuleDraft,
  allowRisky: boolean,
  evalOpts: EvalOptions,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<WriteOutcome> {
  const todo = files.filter((f) => f.selected.some((s) => s));
  const out: WriteOutcome = {
    written: 0, hits: 0, skippedChanged: [], entries: [], failedAt: null,
  };

  let done = 0;
  for (const file of todo) {
    const target = fileAt(app, file.path);
    if (target === null) { out.skippedChanged.push(file.path); continue; }

    let drifted = false;
    let after: string | null = null;
    try {
      await app.vault.process(target, (data) => {
        const res = evaluate(rule, data, allowRisky, evalOpts);
        if (res.kind !== "ok" || !sameHits(res.hits, file.hits)) {
          drifted = true;
          return data;
        }
        after = applyHitsToText(data, file.hits, file.selected);
        return after;
      });
    } catch (err) {
      out.failedAt = { path: file.path, message: err instanceof Error ? err.message : String(err) };
      break;
    }

    done += 1;
    onProgress?.(done, todo.length, file.path);

    if (drifted || after === null) { out.skippedChanged.push(file.path); continue; }
    const count = file.selected.filter((s) => s).length;
    out.written += 1;
    out.hits += count;
    out.entries.push({ path: file.path, hits: count, afterHash: hashText(after) });
  }

  return out;
}
