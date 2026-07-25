import type { Hit } from "../types";

export type ExecuteResult = { hits: Hit[]; timedOut: boolean; timedOutAtLine: number | null };
export type ExecuteOptions = { budgetMs: number; now: () => number };

/** $1..$9, $&, $$ im Ersetzungsmuster aufloesen. */
function expand(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (_, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0];
    const idx = Number(token);
    return match[idx] ?? "";
  });
}

function collect(segment: string, re: RegExp, replacement: string, baseOffset: number, line: number, lineText: string): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment)) !== null) {
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
  return hits;
}

export function runRule(
  text: string,
  re: RegExp,
  replacement: string,
  multiline: boolean,
  opts: ExecuteOptions,
): ExecuteResult {
  if (multiline) {
    // Volltext-Pfad: kein Zeitbudget moeglich, hier traegt allein der Guard.
    const hits = collect(text, re, replacement, 0, 0, text);
    return { hits, timedOut: false, timedOutAtLine: null };
  }

  const start = opts.now();
  const lines = text.split("\n");
  const hits: Hit[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    if (opts.now() - start > opts.budgetMs) {
      return { hits, timedOut: true, timedOutAtLine: i };
    }
    const lineText = lines[i];
    hits.push(...collect(lineText, re, replacement, offset, i, lineText));
    offset += lineText.length + 1; // +1 fuer das \n
  }
  return { hits, timedOut: false, timedOutAtLine: null };
}
