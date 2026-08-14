import { TFile, type App } from "obsidian";
import {
  restoreDecision, selectSnapshotsToDelete, snapshotDirName,
  type SnapshotEntry, type SnapshotManifest,
} from "../core/vault/snapshot";
import type { RuleDraft } from "../core/types";

/** `configDir` statt ".obsidian" — der Pfad ist konfigurierbar (`hardcoded-config-path`). */
export function snapshotRoot(app: App): string {
  return `${app.vault.configDir}/plugins/transmute/snapshots`;
}

async function ensureDir(app: App, path: string): Promise<void> {
  if (await app.vault.adapter.exists(path)) return;
  const parent = path.slice(0, path.lastIndexOf("/"));
  if (parent.includes("/")) await ensureDir(app, parent);
  await app.vault.adapter.mkdir(path);
}

/**
 * Sichert die betroffenen Dateien und legt das Manifest an — VOR der ersten Aenderung.
 *
 * Die Hashes der geschriebenen Fassungen fehlen hier noch (`afterHash: null`); sie kommen
 * mit `finalizeSnapshot` nach. Waere das Manifest erst danach entstanden, waere ein
 * Absturz mitten im Schreiblauf nicht rueckholbar.
 *
 * Wirft, wenn eine Datei nicht gesichert werden kann — dann wird nichts geschrieben.
 */
export async function writeSnapshot(
  app: App,
  at: string,
  rule: RuleDraft,
  paths: string[],
  read: (path: string) => Promise<string | null>,
): Promise<string> {
  const dir = snapshotDirName(at);
  const root = `${snapshotRoot(app)}/${dir}`;
  await ensureDir(app, `${root}/files`);

  for (const path of paths) {
    const text = await read(path);
    if (text === null) throw new Error(path);
    const target = `${root}/files/${path}`;
    await ensureDir(app, target.slice(0, target.lastIndexOf("/")));
    await app.vault.adapter.write(target, text);
  }

  const manifest: SnapshotManifest = {
    at,
    rule,
    files: paths.map((path) => ({ path, hits: 0, afterHash: null })),
  };
  await app.vault.adapter.write(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
  return dir;
}

async function readManifest(app: App, dir: string): Promise<SnapshotManifest> {
  const raw = await app.vault.adapter.read(`${snapshotRoot(app)}/${dir}/manifest.json`);
  return JSON.parse(raw) as SnapshotManifest;
}

export async function finalizeSnapshot(app: App, dir: string, entries: SnapshotEntry[]): Promise<void> {
  const manifest = await readManifest(app, dir);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  manifest.files = manifest.files.map((f) => byPath.get(f.path) ?? f);
  await app.vault.adapter.write(
    `${snapshotRoot(app)}/${dir}/manifest.json`,
    JSON.stringify(manifest, null, 2),
  );
}

export async function rotateSnapshots(app: App, keep: number): Promise<void> {
  const root = snapshotRoot(app);
  if (!(await app.vault.adapter.exists(root))) return;
  const listing = await app.vault.adapter.list(root);
  const names = listing.folders.map((f) => f.slice(root.length + 1));
  for (const name of selectSnapshotsToDelete(names, keep)) {
    await app.vault.adapter.rmdir(`${root}/${name}`, true);
  }
}

export async function restoreSnapshot(
  app: App,
  dir: string,
  force: boolean,
): Promise<{ restored: number; changed: string[]; gone: string[] }> {
  const manifest = await readManifest(app, dir);
  const root = `${snapshotRoot(app)}/${dir}`;

  const out = { restored: 0, changed: [] as string[], gone: [] as string[] };
  for (const entry of manifest.files) {
    const target = app.vault.getFileByPath(entry.path);
    if (!(target instanceof TFile)) { out.gone.push(entry.path); continue; }

    const current = await app.vault.cachedRead(target);
    if (restoreDecision(entry, current) !== "restore" && !force) {
      out.changed.push(entry.path);
      continue;
    }
    const saved = await app.vault.adapter.read(`${root}/files/${entry.path}`);
    await app.vault.process(target, () => saved);
    out.restored += 1;
  }
  return out;
}
