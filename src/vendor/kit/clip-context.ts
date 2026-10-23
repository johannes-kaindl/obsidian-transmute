// vendored from code-kit@0.34.0, src/ts/pure/clip-context.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Clip the text around a hit to `radius` characters on each side, so a list of hits in one line shows only what differs.
 *
 *  Origin: obsidian-transmute `src/core/snippet.ts` `clipContext` (8626db9, blob 6e2f5bad), taken over unchanged — signature and
 *  behaviour are the same, shown by `tests/clip-context.test.ts` against a verbatim reference copy on every combination of line length
 *  0–80, hit position at the edges, the middle and the radius boundary, and radius 0, 5, 30. Second need: Diachronic shows each
 *  suggestion on its card with the words around it. Only the comment is rewritten (English).
 *
 *  Without the clip a list repeats the whole line once before and once after every hit in it, which reads like a hit shown twice; with it
 *  each row holds only what changes. The ellipsis `…` marks a cut side. `start`/`end` are offsets into `line` (UTF-16 code units) and are
 *  not validated: they are passed to `slice` as they come, as in the original. Pure: no I/O, no clock. */

export type Snippet = { lead: string; lag: string };

export function clipContext(line: string, start: number, end: number, radius = 30): Snippet {
  const before = line.slice(0, start);
  const after = line.slice(end);

  const lead = before.length > radius ? `…${before.slice(before.length - radius)}` : before;
  const lag = after.length > radius ? `${after.slice(0, radius)}…` : after;

  return { lead, lag };
}
