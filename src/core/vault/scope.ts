/** Welche Notizen ein vault-weiter Lauf anfasst. Alle gesetzten Bedingungen sind verundet. */
export type VaultFilter = {
  /** null = ganzer Vault. Ohne fuehrenden/abschliessenden Schraegstrich. */
  folder: string | null;
  includeSubfolders: boolean;
  /** Mit oder ohne fuehrendes Doppelkreuz — beides wird akzeptiert. */
  tag: string | null;
  field: { key: string; value: string } | null;
};

/** Die Metadaten einer Notiz, so wie der Adapter sie aus dem metadataCache reicht. */
export type Candidate = {
  path: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
};

export const EMPTY_FILTER: VaultFilter = {
  folder: null,
  includeSubfolders: true,
  tag: null,
  field: null,
};

function normalizeTag(tag: string): string {
  return (tag.startsWith("#") ? tag.slice(1) : tag).toLowerCase();
}

/**
 * Ein Filter-Tag trifft auch verschachtelte Tags: #projekt trifft #projekt/aktiv.
 *
 * Andersherum NICHT — #projekt/aktiv trifft kein blankes #projekt. Obsidian behandelt
 * verschachtelte Tags genauso, und wer nach dem Oberbegriff filtert, meint die Familie.
 */
function hasTag(tags: string[], wanted: string): boolean {
  const want = normalizeTag(wanted);
  return tags.some((t) => {
    const have = normalizeTag(t);
    return have === want || have.startsWith(`${want}/`);
  });
}

/**
 * Ein Frontmatter-Wert kann ein Skalar oder eine Liste sein.
 *
 * `status: aktiv` und `status: [aktiv, alt]` sind beide gaengig; ein Vergleich, der nur
 * den Skalar kennt, laesst die Listen-Notizen still aus dem Umfang fallen.
 */
function fieldMatches(value: unknown, wanted: string): boolean {
  if (Array.isArray(value)) return value.some((v) => fieldMatches(v, wanted));
  if (value === null || value === undefined) return false;
  return String(value).toLowerCase() === wanted.toLowerCase();
}

function inFolder(path: string, folder: string, includeSubfolders: boolean): boolean {
  const prefix = folder.replace(/^\/+|\/+$/g, "");
  if (prefix === "") return true;
  if (!path.startsWith(`${prefix}/`)) return false;
  if (includeSubfolders) return true;
  return !path.slice(prefix.length + 1).includes("/");
}

export function selectCandidates(all: Candidate[], filter: VaultFilter): string[] {
  return all
    .filter((cand) => {
      if (filter.folder !== null && !inFolder(cand.path, filter.folder, filter.includeSubfolders)) return false;
      if (filter.tag !== null && !hasTag(cand.tags, filter.tag)) return false;
      if (filter.field !== null && !fieldMatches(cand.frontmatter[filter.field.key], filter.field.value)) return false;
      return true;
    })
    .map((cand) => cand.path);
}
