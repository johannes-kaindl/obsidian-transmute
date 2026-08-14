# Transmute

> 🇬🇧 English · [🇩🇪 Deutsch](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/README.de.md)

**Describe what to replace in plain language — a local LLM writes the regular expression, and you review every match before anything is written.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/obsidian-transmute?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/obsidian-transmute/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.8.7%2B%20·%20desktop%20%26%20mobile-7c3aed)

## Features

- **Natural-language search & replace.** Type what should change (e.g. "turn dates from DD.MM.YYYY into YYYY-MM-DD") and a local OpenAI-compatible LLM turns it into a JavaScript regular expression, a replacement pattern, and a one-sentence plain-language explanation of what the pattern matches.
- **Preview before anything is written.** Every match is shown before/after, line by line, with its own checkbox. Nothing changes in your note until you click **"Apply"** — and only the checked matches are written.
- **No separate undo system needed.** Applying writes through the editor, so the change lands in Obsidian's own undo stack — **Cmd+Z reverts it in one step**, exactly like any other edit.
- **Iterative refinement.** Not quite right? Type a follow-up such as "but not inside code blocks" and click **"Refine"** — the plugin sends the conversation history *and* the actual matches found so far back to the model, so it can see what it got wrong.
- **Scope control, up to the whole vault.** Run on the current note, on your selection, or across every note — filtered by folder, tag and a frontmatter property. The preview does not change with the scope: every affected file and every match is shown before anything is written, grouped by file and collapsed, so a rule touching 340 files is still 340 lines you can go through.
- **A snapshot before every vault-wide replacement.** The affected files are copied before the first change, and one button puts them back. If the snapshot cannot be written, nothing is written. A file you edited after the replacement is left alone and named, rather than silently overwritten.
- **A history you can go back through.** Refining is trial and error, and the third attempt can be worse than the first. Every round is kept: from the second one on, the panel lists them with their instruction and match count, and one click returns to any earlier version — the later ones stay. Refining from an earlier version continues *that* one.
- **The rule sticks to its note.** The note is pinned when the preview is generated, and the panel names it. Refining and applying go to that note no matter which tab has focus — and applying re-runs the rule first, so an edit elsewhere in the note (or a linter plugin rewriting your frontmatter on save) doesn't matter, while an edit to a matched span stops the write instead of silently replacing the wrong text.
- **Model and thinking switchable from the panel.** Both also live in settings, but noticing mid-try that another model fits better shouldn't cost two dialogs. A model the endpoint no longer offers is reported rather than silently swapped, and a model that always thinks (gpt-oss, harmony) shows a locked toggle instead of pretending it can be turned off.
- **Edit the pattern yourself.** Regex, replacement and flags are editable right in the panel, and the preview recomputes after a short typing pause. An edited rule becomes its own history entry ("Edited by hand"), so the model's version stays and remains one click away. `g` is shown but not offered — it is always on, and a switch that switches nothing would be a lie.
- **A way in without the model at all.** "or write the pattern yourself" opens the same preview with an empty pattern, for when you already know what you want and don't feel like waiting for a model. No separate mode, no second tab.
- **A cheat sheet where you're typing.** A collapsible regex reference sits right under the fields — no model, no network — and stays open while you work.
- **You decide about risky patterns you wrote yourself — with a measurement to back it up.** A hand-written pattern that trips the backtracking heuristic is a warning with a reason, not a refusal: "Run it anyway" releases it for exactly that pattern. Change one character and the warning is back — a release for `(a+)+b` says nothing about `(a+)+bc`. Before the release actually runs, the pattern is timed against a 20-character sample of the longest line: backtracking cost grows exponentially with input length, so a pattern that is already slow there would effectively never finish on a long line, and it is stopped with the measurement shown. This is a brake, not a guarantee — a pattern that passes the sample can still blow up on a much longer line.
- **"Why doesn't this match?"** When a pattern finds nothing, a button explains why — and offers a correction you can accept with one click. Before the model is asked anything, Transmute re-runs the same pattern against the **whole** note with one condition relaxed at a time (ignore case, drop the anchors, drop word boundaries, allow flexible whitespace) and reports what it measured, with line numbers. So the answer stands on a measurement, not on the excerpt the model gets to see: if none of the relaxations match either, "there is nothing of the kind in this text" is a finding rather than a guess. The model is explicitly allowed to suggest nothing — a tool that always produces a fix is a tool that invents one.
- **An optional "replace with" field.** Off by default — many instructions have no target pattern at all — but switchable on in settings if you think in classic find/replace terms.
- **Model-agnostic by design.** No model name is ever hard-coded. The model list is read live from the endpoint's `GET /v1/models`; leaving the setting empty lets the server pick whichever model is loaded.
- **Ordered endpoint fallback list, local or hosted.** Configure several OpenAI-compatible servers; the plugin tries them in order and uses the first one that answers. Each row carries its own optional API key, so a local LM Studio/Ollama server and a hosted provider can sit in the same list — one-click presets for LM Studio and Ollama, a per-row reachability status, and a reorder button.
- **Reasoning models handled correctly.** `<think>` blocks are stripped before the JSON answer is parsed, and — where the server supports it — reasoning is actively suppressed so thinking models answer faster and don't leak their chain of thought into the note.
- **A runaway pattern is caught before it runs.** Every *generated* pattern is screened by a static heuristic (nested quantifiers, quantified alternation, unbounded backreferences) before it is ever executed, and a generated pattern that trips it is rejected outright. Execution is additionally bounded by a time budget — but be aware of what that budget can and cannot do: it is checked *between* lines, so it stops a slow run over many lines, and it cannot stop a single match that has gone exponential on one very long line. Obsidian does not allow web workers, so a running match cannot be cancelled. That is why a *hand-written* pattern that trips the heuristic is released only after Transmute has measured it on a short sample first (see below).
- **Tolerant of imperfect model output.** The model's answer is parsed leniently — code fences are stripped, the first balanced JSON object is extracted — and a single retry with the concrete parse or validation error is sent back to the model before giving up with a clear message.
- **Bilingual interface.** English is canonical; the UI follows Obsidian's display language and ships a full German translation.

### In detail

Transmute solves a gap Obsidian leaves open: the built-in search is read-only, and the existing regex plugins (Regex Find/Replace, Search and Replace Regex, Apply Patterns) all assume you already know how to write a regular expression. Transmute lets you describe the edit in your own words instead. A ribbon icon (`replace`, label "Transmute") and the command **"Open panel"** open a sidebar panel: pick a scope, describe the change, click **"Preview"**, and the model's pattern is compiled, screened for catastrophic-backtracking risk, and run against your text — never blindly. The resulting hits are shown with highlighting; select or deselect individual matches (or use **"Select all"** / **"Select none"**), refine the instruction as many times as you like, and only write the note once you are satisfied.

## Requirements

- **Obsidian 1.8.7+** (desktop or mobile).
- **An OpenAI-compatible local server** (e.g. [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com)) with a chat-capable model loaded. New to local LLMs? The **[local LLM setup guide](https://uplink.jkaindl.de/llm-setup)** walks you through server, model and mobile access end to end. The endpoint and model are configured in the plugin settings — nothing leaves your machine.
- **On model size, if your interface is not English.** Transmute names the target language in every prompt, but a very small model may still drop that instruction while it is busy hitting the JSON format. Measured against a local LM Studio: a 35B mixture-of-experts model answered in German 5 times out of 5, a 2B model 4 out of 5. Patterns are unaffected — this is about the plain-language explanation and diagnosis. If you want reliable explanations in your own language, give it a mid-size model.

## Install

### Community plugins (recommended)

Search for **Transmute** in **Settings → Community plugins → Browse**, then click **Install** and **Enable**.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://git.jkaindl.de/jkaindl/obsidian-transmute/releases) and place them in `<vault>/.obsidian/plugins/transmute/`, then enable the plugin under **Settings → Community plugins**.

### From source

```bash
git clone https://git.jkaindl.de/jkaindl/obsidian-transmute
cd obsidian-transmute
npm install
npm run build   # produces main.js
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/transmute/` and reload Obsidian.

## Usage

1. Point the plugin at your local server (see [Configuration](#configuration) below) and make sure a model is loaded.
2. Click the ribbon icon **"Transmute"** (or run the command **"Open panel"**) to open the panel in the sidebar.
3. Pick a scope: **"Whole note"**, **"Selection"** or **"Whole vault"**. For the vault, narrow it down with the folder, tag and property fields — the line underneath tells you how many notes are in scope ("412 of 2140 notes").
4. Describe the change in the instruction box, e.g. *"turn dates from DD.MM.YYYY into YYYY-MM-DD"*, and click **"Preview"**.
5. Review the preview: the generated pattern, its plain-language explanation, and every match with a before/after line and a checkbox. Deselect anything you don't want, or use **"Select all"** / **"Select none"**.
6. Not quite right? Type a follow-up in the refine box (e.g. *"but not inside code blocks"*) and click **"Refine"** — the model sees the previous rounds and the actual matches it produced.
7. Refined more than once? The panel now shows a **history** above the pattern — click any earlier step to go back to it. Refining from there continues that version; the later ones stay in the list.
8. Click **"Apply"**. Only the checked matches are written, in a single editor transaction — so **Cmd+Z** reverts the whole thing in one step, and your cursor and scroll position survive. **"Discard"** throws the result away and leaves your instruction standing.

**Across the vault**, two things differ. The preview is not recomputed while you type — reading a few hundred notes is not something to do between two keystrokes, so it sits behind **"Compute preview"**; while it runs you get a progress line and a **"Cancel"** button that really stops it. And applying writes to files that are not open in an editor, so Cmd+Z cannot help: a snapshot is written first, above 50 affected files a dialog asks once more, and afterwards a **"Undo"** button restores the snapshot. Files that changed between preview and apply are skipped and named — never replaced against a text you did not see.

### Configuration

Open **Settings → Community plugins → Transmute**. Settings are grouped under **"Connection"** and **"Behaviour"**.

| Setting | Default | Effect |
|---|---|---|
| **Endpoints** | `["http://127.0.0.1:1234"]` | Ordered list of OpenAI-compatible servers, tried in order; the first reachable one is used. Each row can carry its own **API key** — leave it empty for a local server, set it to mix in a hosted provider (e.g. OpenRouter) alongside your local ones. One-click presets for LM Studio and Ollama, a "Use first" reorder button, a per-row reachability status, and a "Test connections" button. |
| **Model** | `""` (empty) | Which model to request. Empty lets the server choose whichever is loaded. A dropdown is filled from the active endpoint's `/v1/models`; use the reload button to refresh it. |
| **Request timeout (ms)** | `120000` | How long to wait for the model to answer before giving up. |
| **Default scope** | `file` (Whole note) | Which scope a new rule starts with — "Whole note", "Selection" or "Whole vault". Switchable per run in the panel. |
| **Text sample sent to the model** | `2000` (characters) | How much of the scope text is sent along with the instruction, so the model can see what it is matching against. |
| **Time budget for running the pattern (ms)** | `2000` | A pattern that runs longer than this on a line-by-line scan is stopped, and the matches found so far are shown with a notice. |
| **Ask before this many files** | `50` | A vault-wide replacement affecting at least this many files asks once more before writing. |
| **Snapshots to keep** | `5` | How many snapshot folders are kept under `<config dir>/plugins/transmute/snapshots/`. Older ones are removed after each replacement. |
| **Show a separate "replace with" field** | `false` | Adds a second, optional input for the target pattern. Off by default — many instructions ("strip trailing whitespace", "make headings one level deeper") have no target pattern at all. |
| **Ask reasoning models to skip thinking** | `true` | Sends reasoning-suppression parameters to the endpoint (and strips `<think>` blocks from the answer either way) so reasoning-capable local models answer faster and more reliably. Measured on this task: ~1.7 s and 5/5 correct with suppression, 26–56 s and 4/5 without. Also switchable from the panel. |

**Endpoint tip:** enter the base URL **without** a trailing `/v1` — the client appends `/v1` itself (a trailing `/v1` is stripped automatically either way, so both forms work).

## How it works

Transmute sends your instruction, plus a sample of the scope text, to the configured endpoint's `/v1/chat/completions` and asks for a single JSON object — `regex`, `flags`, `replacement`, `explanation` — never prose. The answer is parsed leniently (code fences and any `<think>` block are stripped, the first balanced JSON object is extracted), and one retry with the concrete error is sent back to the model if the first answer doesn't parse or validate.

Before the generated pattern ever runs, a static heuristic screens it for constructs known to cause catastrophic backtracking — nested quantifiers, quantified alternation over identical branches, unbounded backreferences — and rejects it with a plain-language reason if it looks dangerous. A pattern that passes is then executed line by line against the scope text under a configurable time budget; multi-line patterns (an `s`/`m` flag, or a literal `\n` in the pattern) run once against the full text instead, since a time budget only makes sense between discrete steps.

Nothing is written to your note until you click **"Apply"**. At that point, only the checked matches are applied — in reverse order, so earlier replacements never shift the offsets of later ones — and the result is written through Obsidian's editor API (`editor.replaceRange`), which is what puts the change on the normal undo stack.

## Manual

The full documentation follows the [Diátaxis](https://diataxis.fr) framework — see [docs/manual/index.md](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/docs/manual/index.md):

- **Tutorial** — get from zero to your first applied replacement.
- **How-to guides** — task-focused recipes (multiple endpoints, refining a rule, undoing, handling an unsafe-pattern error).
- **Reference** — settings, commands, error messages, the JSON contract.
- **Explanation** — why preview-before-apply is the core of the design, why there is no separate snapshot system, and why the safety guard has no web worker to lean on.

See the [changelog](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/CHANGELOG.md) for release notes.

## Related

**[ksawl/obsidian-alchemist](https://github.com/ksawl/obsidian-alchemist)** shares the alchemy/transmutation imagery but a different job: it is a general vault-hygiene toolkit. Transmute is narrowly about turning a plain-language instruction into a reviewed, applied regex replacement — it does not aim to cover vault hygiene more broadly.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/CONTRIBUTING.md) for the workflow (test-driven, `main` always green, feature work in `feat/<name>`, Conventional Commits) and [AGENTS.md](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/AGENTS.md) for the architecture and module conventions. The canonical repository lives on [Forgejo](https://git.jkaindl.de/jkaindl/obsidian-transmute); GitHub (`johannes-kaindl/obsidian-transmute`) is a mirror.

## License

- **Code:** [AGPL-3.0-or-later](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE). A commercial dual-license is available on request if the AGPL copyleft does not fit your use case.
- **Documentation and text:** [CC BY-SA 4.0](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
