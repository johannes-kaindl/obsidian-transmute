# Understanding Transmute

This is the *why* behind Transmute — the reasoning that shaped its design. It is meant
to be read, not followed step by step. If you want to *do* something, the tutorial and
how-to pages are the better starting points; this page explains the thinking those
pages quietly rely on.

Transmute turns a plain-language editing instruction into a regular expression using a
**local** LLM, then runs that pattern against your note. Every design decision below
follows from one conviction: the product is not "an LLM writes a regex" — that part is
almost incidental — the product is **trust in the moment the note actually changes**.

## Why preview-before-apply is the core of the design

It would be technically simpler to let the model's pattern run and rewrite the note in
one step. Transmute deliberately does not do that, and this is the single decision the
rest of the architecture bends around.

Consider what actually happens between "Generate" and "Apply". The session state
machine (`src/core/session.ts`) only ever moves into a `preview` phase — never
`applied` — and that preview phase carries the full list of matches (`Hit[]`) plus a
parallel `selected: boolean[]` array, all ticked by default. Nothing about generating a
rule touches the note. The regex is compiled, screened by the safety guard, and run
**read-only** against the scope text (`runRule` in `src/core/regex/execute.ts` builds a
list of `Hit` objects with `before`/`after` line snapshots; it never calls anything that
writes). The only function in the entire codebase that can put text into your note is
`writeScope` (`src/obsidian/editor-io.ts`), and it is called from exactly one place: the
view's `apply()` handler, which only runs when you click the **"Apply"** button.

This matters because a local LLM — especially the kind of small, fast model people
actually run at their desk — is not a reliable regex author. It will occasionally
propose a pattern that's subtly wrong: an off-by-one in a capture group, a
case-sensitivity mistake, a match that's technically correct but catches something you
didn't mean. A tool that trusted the model's first answer would be, at best, annoying
to use (silent corruption you have to notice and fix by hand) and at worst actively
dangerous to a note you care about. Making every match visible — with its own
before/after line and its own checkbox — turns "trust the model" into "verify one
concrete, readable claim per match," which is a much easier thing for a human to get
right. The **explanation** field in the model's JSON answer exists for the same reason:
even the pattern itself, `/…/…`, is not something most users can audit at a glance, so
the model is asked to also say in one sentence, in plain language, what it thinks it
matches.

The refinement loop follows the same logic one level up. When you type "but not inside
code blocks" and click **"Refine"**, Transmute does not just re-send your original
instruction with the new sentence appended — it sends the model the **actual matches
its own previous pattern produced** (`sampleHits` in `src/core/llm/prompt.ts`), so the
model is refining against ground truth rather than guessing blind a second time. Preview
is not just a safety gate at the end; it is also the feedback loop that makes iteration
useful.

## Why there is no snapshot system

A tool that rewrites your notes might reasonably be expected to keep its own history —
snapshots, a revert browser, something beyond the editor's normal undo. Transmute's
scope in v0.1 is deliberately narrower than that expectation, and the reason is a
one-line implementation detail with a large consequence: `writeScope` calls
`editor.replaceRange(text, range.from, range.to)` — never `Vault.modify()` or any other
direct file write.

`editor.replaceRange` is the same primitive Obsidian's own editing commands use, so a
Transmute apply is, from Obsidian's point of view, indistinguishable from you typing the
change yourself. It lands on Obsidian's **native undo/redo stack**, which means
**Cmd+Z already reverts it in one step** — no custom history UI, no separate snapshot
files on disk, no risk of Transmute's own undo mechanism getting out of sync with
Obsidian's. Building a parallel snapshot system on top of that would duplicate a
guarantee Obsidian already provides for free, for the scopes Transmute actually
supports in v0.1 (the whole active note, or the current selection) — both of which are
single-editor, single-buffer operations that the standard undo stack handles natively
and correctly.

This is a scope-bound answer, not a universal one, and it is worth being explicit about
the boundary: it holds because v0.1 only ever touches **one open editor buffer** per
apply. A hypothetical vault-wide "replace across N files" feature would touch files that
are not open in any editor, and Obsidian's per-editor undo stack has nothing to say
about a file nobody has open — that operation would need its own snapshot mechanism to
offer any safety net at all. That is precisely why vault-wide scope is listed as a
non-goal for v0.1 rather than a "later" checkbox on the current architecture: the
undo-stack argument that makes a separate snapshot system unnecessary today stops
applying the moment the scope grows past a single open buffer.

## Why the guard has no web worker

The obvious design for "stop a regex that's about to hang the editor" is a watchdog: run
the match in a worker thread, and kill the worker if it takes too long. Transmute does
not do this, for a concrete platform reason: **Obsidian's renderer does not allow web
workers.** A `new Worker(...)` call in a plugin simply is not an option here — there is
no separate thread to run the risky match on, and therefore nothing to safely cancel if
it runs long. A `String.prototype.replace` call that starts backtracking catastrophically
on the main thread cannot be interrupted from the outside; by the time you know it's a
problem, the UI is already frozen.

Given that constraint, Transmute defends in two layers that both run *before* the point
where interruption would even be needed:

1. **A static heuristic, before the pattern ever runs.** `assessPattern`
   (`src/core/regex/guard.ts`) inspects the *source* of the generated pattern — not its
   behaviour — for the specific shapes that are known to cause catastrophic
   backtracking: a quantified group whose body itself ends in an unbounded quantifier
   (`(a+)+`), a quantified group containing alternation with a duplicate branch
   (`(a|a)+`), or an unbounded quantifier directly on a backreference (`(a)\1+`). A
   pattern that matches one of these shapes is rejected outright, with a plain-language
   reason, and is never compiled into a `RegExp` at all. This is deliberately
   conservative in one direction only: a false positive here merely means Transmute asks
   you to rephrase the instruction, which is mildly annoying; a false negative would mean
   an unsafe pattern reaches step 2.
2. **A time-budgeted, chunked execution, for what the heuristic can't catch.** Even a
   pattern that passes the static check could still be slow against pathological input
   the model didn't anticipate. `runRule` (`src/core/regex/execute.ts`) does not run the
   whole scope text through the regex in one call; it walks the text **line by line**,
   checking an injected clock (`performance.now()` in the running plugin, a fake clock in
   tests) between lines against the configured time budget. If the budget is exceeded,
   execution stops and returns whatever matches were found up to that point, along with
   the line it stopped at — rather than hanging indefinitely or silently truncating
   without telling you.

The second layer only works because most instructions produce line-scoped patterns —
which is also why the system prompt explicitly asks the model to *prefer* a
line-by-line-compatible pattern. A pattern that genuinely needs multi-line matching (an
`s`/`m` flag, or a literal `\n` in the source) has to run once against the full text,
because a time budget only means something between discrete steps — there is nowhere to
check the clock in the middle of a single `RegExp.exec` call. For that path, the static
heuristic in step 1 is the *only* line of defense, which is precisely why it stays
deliberately conservative rather than being loosened to catch fewer false positives.

## Where to go deeper

This page deliberately stays out of the code. If you want the module layout — which
files are pure and testable, which touch Obsidian, how the session, the transport, and
the panel fit together — that lives in [`../../AGENTS.md`](../../AGENTS.md) at the
repository root, written for contributors and AI agents rather than end users.

---

*This documentation is licensed under [CC BY-SA 4.0](../../LICENSE-DOCS). The plugin
code is licensed under [AGPL-3.0-or-later](../../LICENSE).*
