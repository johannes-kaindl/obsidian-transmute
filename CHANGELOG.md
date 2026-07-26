# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- **A history of refinements, with a way back.** Refining is trial and error, and the
  third attempt can be worse than the first — until now the first was gone. Every round
  is kept; from the second one on the panel lists them with their instruction and match
  count, and one click goes back to any of them. Refining from an earlier version builds
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
