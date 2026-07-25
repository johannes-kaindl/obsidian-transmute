export type Snippet = { lead: string; lag: string };

/**
 * Kuerzt den Kontext um eine Fundstelle auf `radius` Zeichen je Seite.
 *
 * Ohne das wiederholt die Trefferliste bei mehreren Treffern in derselben Zeile denselben
 * Zeilentext viermal (je Treffer einmal vorher, einmal nachher) — das liest sich wie ein
 * doppelt angezeigter Treffer. Mit Kuerzung steht in jeder Zeile nur, was sich aendert.
 */
export function clipContext(line: string, start: number, end: number, radius = 30): Snippet {
  const before = line.slice(0, start);
  const after = line.slice(end);

  const lead = before.length > radius ? `…${before.slice(before.length - radius)}` : before;
  const lag = after.length > radius ? `${after.slice(0, radius)}…` : after;

  return { lead, lag };
}
