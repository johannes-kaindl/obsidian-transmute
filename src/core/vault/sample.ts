export type SampleSource =
  | { kind: "active"; path: string }
  | { kind: "candidates"; paths: string[] }
  | { kind: "none" };

/**
 * Die offene Notiz gewinnt — aber nur, wenn der Filter sie ueberhaupt einschliesst.
 *
 * Sonst baut das Modell die Regel an einem Text, der gar nicht im Umfang liegt; die Regel
 * passt dann sichtbar zur offenen Notiz und trifft im Vault nichts.
 */
export function chooseSampleSource(
  activePath: string | null,
  candidates: string[],
  maxNotes = 3,
): SampleSource {
  if (candidates.length === 0) return { kind: "none" };
  if (activePath !== null && candidates.includes(activePath)) return { kind: "active", path: activePath };
  return { kind: "candidates", paths: candidates.slice(0, maxNotes) };
}

const head = (path: string): string => `--- ${path} ---\n`;

export function buildSample(parts: { path: string; text: string }[], maxChars: number): string {
  const chunks: string[] = [];
  let used = 0;
  for (const part of parts) {
    const label = head(part.path);
    const separator = chunks.length === 0 ? "" : "\n\n";
    const room = maxChars - used - separator.length - label.length;
    if (room <= 0) break;
    const body = part.text.length > room ? part.text.slice(0, room) : part.text;
    chunks.push(`${separator}${label}${body}`);
    used += separator.length + label.length + body.length;
  }
  return chunks.join("");
}
