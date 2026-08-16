# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- **The whole vault.** A rule can now run across every note instead of just the open one,
  filtered by folder, tag and a frontmatter property. The preview stays what it was — every
  file and every match is shown before anything is written, grouped by file and collapsed,
  so that 340 files are 340 lines rather than 1,204.
- **A snapshot before every vault-wide replacement**, written before the first change. If it
  cannot be written, nothing is. One button restores it afterwards; a file that was edited
  in the meantime is left alone and named rather than silently overwritten.
- **A confirmation above a configurable number of files** (50 by default), and a setting for
  how many snapshots to keep (5 by default).

### Fixed

- **The cancel button during a vault-wide run was decoration in exactly the case that
  needs it.** The UI yield sat behind an early `continue` for files that hit the match
  limit — a pattern like `[a-z]` hits it in every file, so the interface was never
  released and the click never arrived. Found by the first GUI smoke run against a real
  Obsidian with 12,002 notes; 403 green unit tests did not see it.
- **Progress no longer redraws the whole match list.** With 11,770 affected files that
  costs more than the run itself and blocks the very interface the progress is meant to
  inform. While a run is going, only the progress line is drawn — there is no complete
  result to show yet anyway.

### Changed

- Scope "whole vault" does not recompute on every keystroke — it has a button. Reading a few
  hundred notes is not something to do between two keys.
- A vault-wide rule no longer needs an open note. The example the model works from is taken
  from the open note when the filter includes it, and from the first matching notes
  otherwise — and which one it was is shown above the input.

## [0.4.0] — 2026-08-08

### Added

- **"Why doesn't this match?"** — when a pattern finds nothing, a button explains why and
  offers a correction you can accept with one click. Before asking the model, the plugin
  measures against the **whole** note whether the same pattern would match with one
  condition relaxed — ignoring case, dropping the anchors, dropping word boundaries,
  allowing flexible whitespace. Those findings go to the model as facts, with line
  numbers. If none of them match, "there is nothing of the kind in this text" is a
  measurement rather than a guess. The model is explicitly allowed to suggest nothing,
  because a tool that always invents a fix is a tool that invents.
- **An API key per endpoint row.** Hosted endpoints (OpenRouter and similar) need one; the
  field sits right next to the URL, masked, and never appears in plain text anywhere in the
  interface.
- **A "use first" button per row**, to reorder the fallback list without retyping it — the
  order of the list is the priority, so reordering is the only way to say which endpoint is
  preferred.
- **A role readout per row** — active, reachable, unreachable, or skipped — so a fallback
  list that silently skips a hosted endpoint over a missing key is visible instead of quiet.

### Changed

- The language of the interface is now stated to the model instead of left for it to
  infer. This also applies to the explanation of a generated rule.
- Endpoint lists from an older `data.json` (a plain list of URL strings) are migrated to the
  new config form automatically on load. No endpoint is lost in the process.

### Fixed

- A reasoning model that spends its entire token budget on thinking is now reported as
  such, instead of showing the generic endpoint error.
- An endpoint that answers with 401 or 403 is now reported as a missing or invalid key
  instead of "not an OpenAI-compatible endpoint" — which is the one case a hosted endpoint
  with a wrong key hits every time.

## [0.3.0] — 2026-07-27

### Added

- **The pattern is now a form, not a display.** Regex, replacement and flags are editable
  right in the panel; the preview recomputes after a short typing pause. `g` is shown but
  not offered — `compileRule` enforces it, and a switch that switches nothing would be a
  lie. Below the fields, the pattern still appears in `/pattern/flags` notation with the
  flags that actually ran.
- **A way in without the model.** "or write the pattern yourself" under the preview button
  opens the same preview with an empty pattern. No tab, no mode, no second state — and the
  way back is the same Discard button as always.
- **Copy the pattern** to the clipboard as `/pattern/flags`.
- **A static regex cheat sheet**, collapsible, right under the fields. No model, no
  network. It sits in the rule container, so it stays open while you type.
- **The model's reasoning**, collapsed, below the explanation — when thinking is on and the
  model actually thought.

### Changed

- **A rule edited by hand becomes its own history entry, "Edited by hand".** The model's
  version stays and remains selectable; typing further changes that one entry instead of
  growing the list. Refining from an edited version continues from *that* rule.
- **A risky pattern written by hand is now a warning, not a refusal.** The preview pauses,
  the reason is named, and "Run it anyway" releases it — for exactly that pattern. Change
  one character and the warning returns: a release for `(a+)+b` says nothing about
  `(a+)+bc`.
- **Rules with too many matches are stopped rather than shown** (limit: 500). A pattern
  like `a*` matches the empty string at every position; showing a truncated list and
  applying it anyway would break the one promise this plugin makes — that what happens is
  what you saw.

### Fixed

- **A released risky pattern can no longer freeze Obsidian.** "Run it anyway" now first
  runs the pattern against a 20-character sample and measures it. Backtracking blowup
  grows exponentially with input length, so a pattern that is already slow on 20
  characters would effectively never finish on a long line — and Obsidian cannot cancel a
  running pattern (no web workers). The message names the measurement and the longest line
  so the reasoning is checkable. This is a brake, not a guarantee.
- **The `/pattern/flags` line no longer goes stale while you type.** It sat in the rule
  container, which is deliberately not redrawn during editing, so it kept showing the
  previous round's pattern — the exact class of bug this plugin exists to prevent.
- **The model's explanation is dropped once you edit the rule by hand.** It described the
  model's pattern, not the one that now runs. The model's own version keeps its
  explanation in the history.
- The cheat sheet is easier to find: icon and accent colour instead of a bare disclosure
  triangle.
- `npm run lint` now fails on warnings (`--max-warnings 0`). ESLint exits 0 on warnings
  while the community store scanner reports them, so a finding could sit in a green gate.

## [0.2.0] — 2026-07-26

### Added

- **A history of refinements, with a way back.** Refining is trial and error, and the
  third attempt can be worse than the first — until now the first was gone. Every round
  is kept; from the second one on the panel lists them with their instruction and match
  count under a "History" label, and one click goes back to any of them. Refining from an earlier version builds
  on *that* version, and the later ones stay. Data model adopted from `image-to-markdown`.
- **Model picker and thinking toggle in the panel.** Both also live in the settings, but
  noticing mid-try that another model fits better should not cost two dialogs. A model
  the endpoint no longer offers is reported rather than silently swapped, and a model that
  always thinks (gpt-oss, harmony) shows a locked toggle instead of pretending.
- **A "discard" button** to start a transmutation over.
- **A rule now sticks to the note it was created on.** Preview pins that note; refining
  and applying go to it regardless of which tab has focus, and the panel names the note
  it is working on. Previously every step looked at whatever note was active, so
  switching tabs mid-round produced a warning about a question that was already settled.
- **Applying is refused if the note changed since the preview.** Matches carry offsets
  into the text as it was read; after an edit those same offsets point at different text,
  and applying would silently replace the wrong spans. This was reachable before — the
  pinning work exposed it. The note is now checked against the previewed snapshot first.
- Optional **"replace with"** field for the target pattern, enabled by a setting and off
  by default. Many instructions have no target pattern at all ("strip trailing
  whitespace", "make headings one level deeper"), so a mandatory second field would be in
  the way — but if you think in classic find/replace terms, you can switch it on. When
  filled it goes into the prompt as its own line; blank or whitespace-only is omitted
  rather than sent as an empty target.

- The waiting state now **spins and says what is happening** — that the model is writing
  the pattern, and that nothing in the note changes before Apply. A static line gave no
  way to tell "still working" from "crashed". The spin is dropped under
  `prefers-reduced-motion`. There is only that one sentence: a second line next to the
  spinner ("Asking the model…") said what the spinner already says.
- The **replacement pattern** is now shown next to the search pattern. Previously the
  panel showed only what was matched, never what it would be turned into — which is half
  the rule, and the half you need to judge whether it is right.

### Fixed

- **Two matches in one line looked like one match shown twice.** Each match row printed
  the whole line, before and after — so two dates in a sentence produced four nearly
  identical lines. The context around a match is now clipped to 30 characters per side,
  which also keeps long lines from overflowing the panel.
- **The displayed pattern was not the pattern that ran.** `g` is always forced (a rule
  without it would replace only the first match), but the panel showed the model's raw
  flags — so `/#alt/i` was displayed while `/#alt/gi` was executed. Anyone copying the
  pattern out or learning from it got a different rule than the one they saw. The flags
  are now normalised exactly as `RegExp` reports them.
- **"No matches" blamed the instruction.** The old wording ("try refining the instruction")
  claimed a cause it cannot know: the far more common reason is that the text no longer
  contains what is being searched for — for instance because the rule was already applied.
  The message now states the fact and names both possibilities.
- **Selecting text and running a rule reported "nothing selected".** In reading view there
  is no editor selection at all — a highlight there is a plain browser selection the editor
  never sees. Reading view is now its own, specific message ("switch the note to editing
  view") instead of a misleading one. The same cause made whole-note runs find nothing in
  reading view.
- **Undo took two presses.** Applying replaced the entire document with the new text. It now
  writes one editor transaction containing one change per selected match: a single undo
  step, untouched text left untouched, cursor and scroll position preserved.
- **Every action failed with "open a note first" while a note was open.** The panel looked
  up the note with `getActiveViewOfType`, but clicking into the sidebar makes the panel
  itself the active view — so there was no "active" note to find. It now asks the main
  area (`getMostRecentLeaf(rootSplit)`), which ignores the sidebars. Covered by a
  regression test.

### Changed

- The primary button is now **Preview** instead of **Generate** — it produces a preview;
  the separate Apply button is what actually changes the note.
- Panel layout: dropped the redundant heading (the tab already carries the title), added
  padding, equal-width scope buttons, and the pattern is set off on its own surface.

## [0.1.1] — 2026-07-25

### Fixed

- Release pipeline: `npm run gate` now also builds `main.js`. The vendored release
  workflow attests and uploads the bundle but never builds it itself — it relies on the
  gate having produced it. Without that step the first release cut a tag whose GitHub
  release was never created.

## [0.1.0] — 2026-07-25

### Added

- Natural-language search & replace: describe an instruction, a local OpenAI-compatible LLM
  turns it into a regular expression, a replacement pattern, and a plain-language explanation.
- Preview before applying — every match shown before/after with an individual checkbox, plus
  "Select all" / "Select none"; nothing is written to the note until "Apply" is clicked.
- Undo via Obsidian's own undo stack — applying writes through `editor.replaceRange`, so Cmd+Z
  reverts a replacement in one step, without a separate snapshot system.
- Iterative refinement — a follow-up instruction (e.g. "but not inside code blocks") is sent
  back to the model together with the conversation history and the actual matches found so far.
- Scope control — run on the whole note or on the current selection, with a configurable default.
- Model-agnostic model selection — the model list is read live from the endpoint's
  `GET /v1/models`; no model name is hard-coded, and leaving the setting empty lets the server
  choose.
- Ordered endpoint fallback list with one-click presets for LM Studio and Ollama, per-row
  reachability status, and input warnings (missing scheme, malformed URL, missing port,
  placeholder IP).
- Reasoning-model support — `<think>` blocks are stripped before JSON parsing, and reasoning
  suppression parameters are sent to the endpoint when enabled (default: on).
- Static ReDoS guard — generated patterns are screened for nested quantifiers, quantified
  alternation over identical branches, and unbounded backreferences before they ever run.
- Time-budgeted execution — a line-by-line scan is stopped once it exceeds the configured time
  budget, showing the matches found so far.
- Tolerant JSON parsing of the model's answer (code-fence stripping, first-balanced-object
  extraction) with a single automatic retry on a parse or validation error.
- Bilingual interface (English canonical, German translation) following Obsidian's display
  language.
