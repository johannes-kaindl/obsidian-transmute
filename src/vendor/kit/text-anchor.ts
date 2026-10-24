// vendored from code-kit@0.36.0, src/ts/pure/text-anchor.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Find a quoted passage again in a text that has changed since it was quoted — by the words, not by the position.
 *
 *  Origin: obsidian-transmute `src/core/anchor.ts` `locateRegion` (49fd3cd, blob b6fde824): check the stored position, else take the one
 *  occurrence, else `null` when it is gone or ambiguous. Second need: Diachronic anchors a review entry to its mark by quote and context
 *  (W3C TextQuoteSelector). Without a `prefix`/`suffix` this gives the same answer as `locateRegion`, shown on every text, hint and quote
 *  over a two-letter alphabet in `tests/text-anchor.test.ts` against a verbatim reference copy. What differs, and why:
 *
 *  1. **Context decides between equal quotes.** With several occurrences each is scored by the length of the text before it that ends
 *     like `prefix` plus the length of the text after it that starts like `suffix`; a single best wins, a tie is `ambiguous` and
 *     `candidates` counts the tied best ones (not every occurrence). `locateRegion` could only give up.
 *  2. **The hint holds only if the context holds.** A hint that points at the quote counts when no context was quoted (as in
 *     `locateRegion`) or when the text around it still equals `prefix` and `suffix` exactly. A hint that points at *the same words in
 *     another place* — text moved, a second occurrence now sits there — would otherwise anchor a change at the wrong place.
 *     When the hint is rejected the search runs; a single occurrence is found at its own position all the same.
 *  3. **A hint that cannot be one is ignored** (negative, fractional, `NaN`, infinite, past the end) instead of being sliced with.
 *  4. **An empty quote is `missing`:** it anchors nothing (`locateRegion` found an empty string at any offset).
 *
 *  Not here: fuzzy matching for a quote that was reworded (Hypothesis-style repair). A quote that is not in the text is `missing`.
 *  Occurrences are counted with overlaps (`aa` in `aaa` is two), as `locateRegion` does. Offsets are UTF-16 code units, the unit
 *  CodeMirror and `replace-span.ts` use. Pure: no I/O, no clock. */

export interface TextQuote { exact: string; prefix?: string; suffix?: string }
export type LocateResult = { kind: "found"; start: number; end: number } | { kind: "missing" } | { kind: "ambiguous"; candidates: number };

const DEFAULT_CONTEXT = 32;

/** How many characters before `at` equal the end of `prefix`, counted back from `at`. */
function tailMatch(text: string, at: number, prefix: string): number {
  let k = 0;
  while (k < prefix.length && at - 1 - k >= 0 && text.charCodeAt(at - 1 - k) === prefix.charCodeAt(prefix.length - 1 - k)) k++;
  return k;
}

/** How many characters from `at` on equal the start of `suffix`. */
function headMatch(text: string, at: number, suffix: string): number {
  let k = 0;
  while (k < suffix.length && at + k < text.length && text.charCodeAt(at + k) === suffix.charCodeAt(k)) k++;
  return k;
}

export function locateQuote(text: string, quote: TextQuote, hint?: number): LocateResult {
  const { exact } = quote;
  const prefix = quote.prefix ?? "";
  const suffix = quote.suffix ?? "";
  if (exact === "") return { kind: "missing" };
  const len = exact.length;

  if (hint !== undefined && Number.isInteger(hint) && hint >= 0 && text.startsWith(exact, hint)) {
    const contextHolds = (prefix === "" || tailMatch(text, hint, prefix) === prefix.length) && (suffix === "" || headMatch(text, hint + len, suffix) === suffix.length);
    if (contextHolds) return { kind: "found", start: hint, end: hint + len };
  }

  let total = 0, best = -1, bestScore = -1, tied = 0;
  for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) {
    total++;
    const score = tailMatch(text, i, prefix) + headMatch(text, i + len, suffix);
    if (score > bestScore) { bestScore = score; best = i; tied = 1; }
    else if (score === bestScore) tied++;
  }
  if (total === 0) return { kind: "missing" };
  if (tied === 1) return { kind: "found", start: best, end: best + len };
  return { kind: "ambiguous", candidates: tied };
}

/** The quote for `text[start, end)` with up to `context` characters (default 32) on each side; what is there at the edges of the text.
 *  A span outside the text or reversed is clamped. `prefix` and `suffix` are always present, empty at the edges. */
export function quoteAt(text: string, start: number, end: number, context: number = DEFAULT_CONTEXT): TextQuote {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));
  return { exact: text.slice(a, b), prefix: text.slice(Math.max(0, a - context), a), suffix: text.slice(b, b + context) };
}
