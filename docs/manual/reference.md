# Reference

Dry, exhaustive reference for **Transmute** (plugin id `transmute`, version 0.1.0,
minimum Obsidian 1.8.7, Desktop and Mobile). For the source-level architecture and
module layout, see [AGENTS.md](../../AGENTS.md).

The plugin's user-facing strings follow Obsidian's display language: **English is
canonical**, with a **German** translation. This reference quotes the English strings
verbatim. See [UI language](#ui-language) for how the language is detected.

## Commands

Registered under Obsidian's command palette (`Cmd/Ctrl-P`). The command id carries no
plugin prefix and the display name is sentence-case, per Obsidian's command
conventions; the palette itself prefixes it with the plugin name ("Transmute: Open
panel").

| Command id | Name | Behaviour |
| --- | --- | --- |
| `open-panel` | "Open panel" | Opens the Transmute panel in the right sidebar, or reveals it if already open. No default hotkey is assigned. |

The command name itself is not run through the i18n layer and stays "Open panel" in
both languages; the panel's internal buttons ("Generate"/"Erzeugen",
"Refine"/"Nachschärfen", "Apply"/"Anwenden") are separate, localized UI strings, listed
under [Panel](#panel) below.

## Ribbon

| Element | Value | Notes |
| --- | --- | --- |
| Ribbon icon | `replace` | Activates the panel. |
| Ribbon label | "Transmute" | Tooltip on the ribbon icon. |
| View type | `transmute-panel` | Internal Obsidian view-type identifier. |
| View title | "Transmute" | Display text of the sidebar view (`view.title`). |

## Panel

The panel is opened via the ribbon icon or the **"Open panel"** command and appears as
a view in the right sidebar. Its layout, top to bottom:

1. **Scope switch** — two buttons, **"Whole note"** and **"Selection"** (`view.scope.file` /
   `view.scope.selection`). The active one is highlighted. Starts at the configured
   [default scope](#settings).
2. **Instruction box** — a text area (placeholder: *"e.g. turn dates from DD.MM.YYYY
   into YYYY-MM-DD"*) plus a **"Generate"** button.
3. **Result area** — its content depends on the session phase:
   - *Idle* — empty.
   - *Generating* — a spinner and "Asking the model…".
   - *Preview* — see [Preview](#preview) below.
   - *Error* — a plain-language message (see [Error messages](#error-messages) and
     [Risk messages](#risk-messages)), with an expandable **"Show the model's raw
     answer"** section when a raw response is available.

### Preview

Shown once a rule has been generated and executed against the scope text:

- The pattern, rendered as `/regex/flags`.
- The model's one-sentence plain-language explanation, if it provided one.
- A warning if execution was stopped by the [time budget](#settings) — *"Stopped after
  the time budget at line N. Showing what was found so far."*
- Either *"No matches. Try refining the instruction."*, or a match count (*"N
  matches"*) with **"Select all"** / **"Select none"** links, followed by one row per
  match: a checkbox, the 1-based line number, and a before/after view of the line with
  the matched span highlighted.
- A refine text area (placeholder: *"e.g. but not inside code blocks"*) and a
  **"Refine"** button.
- An **"Apply"** button, disabled while no match is checked.

Clicking **"Apply"** writes only the checked matches (via `editor.replaceRange`, which
lands the change on Obsidian's own undo stack) and resets the session back to idle.

## Settings

Settings tab heading in Obsidian: **Transmute**, with two groups: **"Connection"** and
**"Behaviour"**.

### Connection

| Name (verbatim) | Description | Default |
| --- | --- | --- |
| "Endpoints" | Ordered list of OpenAI-compatible servers. The plugin pings them in order and uses the **first reachable** one. The settings tab renders a dynamic field per entry; an empty trailing field is the "add new" slot, committed on blur (not on every keystroke). Each row shows a reachability icon (loader / check / cross, with an accessible label) and, where applicable, a non-blocking input warning (missing scheme, malformed URL, missing port, placeholder IP). Two one-click preset buttons add `http://localhost:1234` (LM Studio) or `http://localhost:11434` (Ollama); a "Test connections" button re-probes every row. | `["http://127.0.0.1:1234"]` |
| "Model" | Which model id to request. A dropdown populated from the active endpoint's `/v1/models`, plus a reload button (`refresh-cw`). The top option, "(let the server choose)", sends an empty `model` field. | `""` (empty) |
| "Request timeout (ms)" | How long to wait for the model to answer a chat-completion request before giving up. Minimum enforced value: `1000`. | `120000` |

### Behaviour

| Name (verbatim) | Description | Default |
| --- | --- | --- |
| "Default scope" | Which scope ("Whole note" / "Selection") a freshly opened panel starts on. Switchable per session in the panel itself. | `file` (Whole note) |
| "Text sample sent to the model" | How many characters of the scope text are included with the instruction/refinement, so the model can see what it is matching against. Text longer than this is truncated with a trailing `…`. Minimum enforced value: `200`. | `2000` |
| "Time budget for running the pattern (ms)" | Wall-clock budget for a line-by-line pattern run. Execution is checked between lines (via a supplied clock, `performance.now()` in the running plugin); exceeding the budget stops the scan and returns the matches found so far, plus the line index it stopped at. Does not apply to multi-line patterns (see [Multi-line execution](#multi-line-execution)). Minimum enforced value: `200`. | `2000` |
| "Ask reasoning models to skip thinking" | When on, sends reasoning-suppression request parameters to the endpoint (`reasoning_effort: "none"`, `chat_template_kwargs.enable_thinking: false`, `reasoning_budget: 0`) — a union of the parameter names used by different local servers, so unrecognized ones are simply ignored. Independent of this setting, any `<think>…</think>` block in the raw answer is always stripped before JSON parsing. | `true` |

## The JSON contract

The system prompt asks the model to answer with **exactly one JSON object and nothing
else** — no prose, no code fence:

| Field | Meaning |
| --- | --- |
| `regex` | The pattern, without delimiters, escaped for JSON. |
| `flags` | Any of `gimsuy`. `g` is added automatically if missing. |
| `replacement` | The replacement string. `$1`…`$9` for capture groups, `$&` for the whole match, `$$` for a literal `$`. |
| `explanation` | One short sentence, in the user's language, describing what the pattern matches. |

The raw answer is parsed leniently before the JSON is decoded: any `<think>…</think>`
block is stripped, a fenced ```` ```json ... ``` ```` block is unwrapped if present, and
the **first balanced JSON object** in what remains is extracted (string literals are
tracked so a `}` inside a quoted string does not end the object early). If parsing or
schema validation fails, **one retry** is sent: the previous messages, the bad answer,
and the concrete problem, asking the model to answer again with valid JSON. A second
failure surfaces one of the [error messages](#error-messages) below instead of retrying
further — small local models can loop indefinitely on a bad prompt otherwise.

Allowed flags are `g`, `i`, `m`, `s`, `u`, `y`, `d`, `v`; any other flag character is
rejected with the "unknown flag" error before the pattern is even compiled.

## Risk messages

Before a syntactically valid pattern is compiled and run, a static heuristic
(`assessPattern`) screens it for constructs known to cause catastrophic backtracking.
A pattern that trips one of these rules is rejected outright — it is never executed,
regardless of the time budget:

| Rule | Message shown | What it catches |
| --- | --- | --- |
| `nested-quantifier` | "The pattern nests quantifiers, which can hang the editor." | A quantified group whose own body ends in an unbounded quantifier, e.g. `(a+)+`, `(\d+)+$`. |
| `quantified-alternation` | "The pattern repeats overlapping alternatives, which can hang the editor." | A quantified group containing alternation with a duplicate branch, e.g. `(a|a)+`, `(x|x)*`. |
| `unbounded-backreference` | "The pattern repeats a backreference without a bound." | An unbounded quantifier directly on a backreference, e.g. `(a)\1+`. |

Patterns that merely *look* similar but aren't actually risky pass through unchanged —
for example `(foo|bar)+` (distinct branches), `a+b+` (sibling quantifiers, not nested),
or an escaped `\(a+\)+` (not a capturing group at all).

## Error messages

| Message key | Text (EN) | When it appears |
| --- | --- | --- |
| `error.noEditor` | "Open a note first." | "Generate"/"Refine"/"Apply" clicked with no active Markdown editor. |
| `error.noSelection` | "Nothing selected." | Scope is "Selection" but the editor selection is empty. |
| `error.noJson` | "The model did not answer with JSON." | The model's answer (after stripping `<think>` and code fences) contains no balanced JSON object, even after the one automatic retry. |
| `error.badSchema` | "The model's answer was missing the pattern." | The parsed JSON has no non-empty `regex` string field. |
| `error.syntax` | "The generated pattern is not valid: {0}" | The pattern failed the safety screen for an unrelated reason, or `new RegExp(...)` itself threw (e.g. unbalanced parentheses). |
| `error.flags` | "The model used an unknown flag: {0}" | The `flags` field contains a character outside `gimsuyd v`. |
| `error.endpoint` | "The endpoint did not answer: {0}" | The HTTP request failed, timed out, or returned a non-2xx status. |

## UI language

The plugin's interface is bilingual. **English is the canonical language; German is
the translation.**

- The display language is read from Obsidian via `getLanguage()` (Obsidian 1.8+),
  wrapped defensively so a missing or renamed API never breaks plugin load.
- A locale starting with `de` selects German; every other value selects English.
- Detection happens **once, when the plugin loads.** Changing Obsidian's language
  afterwards does not retranslate a running session — reload the plugin (or restart
  Obsidian) to switch.
- Every user-facing string in the panel, the settings tab, and the notices goes through
  the shared i18n module (`src/core/i18n/strings.ts`), keyed and interpolated with
  `{0}`, `{1}`, … placeholders.

## Multi-line execution

Most generated patterns run **line by line** against the scope text, which is what
makes the [time budget](#settings) meaningful (execution is checked between lines). A
pattern is instead run **once against the full text** — with no time budget, since
there is no discrete step to check between — when either:

- its `flags` include `s` or `m`, or
- its `regex` source contains a literal `\n`.

The system prompt explicitly asks the model to prefer a line-by-line-compatible
pattern and only use multi-line constructs when the instruction actually calls for
them.

---

For the architecture, module layout, and contribution conventions, see
[AGENTS.md](../../AGENTS.md). Licensing: code under
[AGPL-3.0-or-later](../../LICENSE), documentation under
[CC BY-SA 4.0](../../LICENSE-DOCS).
