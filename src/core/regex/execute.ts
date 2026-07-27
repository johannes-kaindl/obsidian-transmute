import type { Hit } from "../types";

export type ExecuteResult = { hits: Hit[]; timedOut: boolean; timedOutAtLine: number | null; tooMany: boolean };
export type ExecuteOptions = {
  budgetMs: number;
  now: () => number;
  /** Obergrenze fuer den GANZEN Lauf. Ein Muster wie a* trifft an jeder Position den
   *  Leerstring, und jeder Treffer traegt die volle Zeile in before und after mit —
   *  ohne Grenze waeren das auf einer langen Zeile Tausende Treffer samt DOM-Zeilen. */
  maxHits: number;
};

/** $1..$9, $&, $$ im Ersetzungsmuster aufloesen. */
function expand(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (_, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0];
    const idx = Number(token);
    return match[idx] ?? "";
  });
}

function collect(
  segment: string,
  re: RegExp,
  replacement: string,
  baseOffset: number,
  line: number,
  lineText: string,
  room: number,
): { hits: Hit[]; full: boolean } {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment)) !== null) {
    if (hits.length >= room) return { hits, full: true };
    const expanded = expand(replacement, match);
    const localStart = match.index;
    const localEnd = match.index + match[0].length;
    hits.push({
      line,
      lineStart: baseOffset,
      start: baseOffset + localStart,
      end: baseOffset + localEnd,
      matched: match[0],
      replacement: expanded,
      before: lineText,
      after: lineText.slice(0, localStart) + expanded + lineText.slice(localEnd),
    });
    // Leerer Treffer wuerde lastIndex nicht bewegen → manuell weiterschieben.
    if (match[0].length === 0) re.lastIndex++;
  }
  return { hits, full: false };
}

export function runRule(
  text: string,
  re: RegExp,
  replacement: string,
  multiline: boolean,
  opts: ExecuteOptions,
): ExecuteResult {
  if (multiline) {
    // Volltext-Pfad: kein Zeitbudget moeglich, hier tragen allein Guard und Obergrenze.
    const res = collect(text, re, replacement, 0, 0, text, opts.maxHits);
    return { hits: res.hits, timedOut: false, timedOutAtLine: null, tooMany: res.full };
  }

  const start = opts.now();
  const lines = text.split("\n");
  const hits: Hit[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    if (opts.now() - start > opts.budgetMs) {
      return { hits, timedOut: true, timedOutAtLine: i, tooMany: false };
    }
    const lineText = lines[i];
    // Das Restkontingent wandert mit: die Grenze gilt fuer den ganzen Lauf, nicht je Zeile.
    const res = collect(lineText, re, replacement, offset, i, lineText, opts.maxHits - hits.length);
    hits.push(...res.hits);
    if (res.full) return { hits, timedOut: false, timedOutAtLine: null, tooMany: true };
    offset += lineText.length + 1; // +1 fuer das \n
  }
  return { hits, timedOut: false, timedOutAtLine: null, tooMany: false };
}
