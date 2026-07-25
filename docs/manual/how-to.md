# How-to guides

Task-focused recipes for getting things done with **Transmute**. Each section is a
self-contained recipe with steps. They assume the plugin is installed and a local
endpoint is already configured — if not, start with the [Tutorial](tutorial.md) or the
setup notes in the [README](../../README.md).

> The plugin's UI follows **Obsidian's display language** (English is canonical,
> German is the translation). This guide is written in English and quotes the English
> labels. The language is detected once when the plugin loads — reload the plugin to
> switch. See [Reference → UI language](reference.md#ui-language).

## Recipes

1. [Run on a selection instead of the whole note](#run-on-a-selection-instead-of-the-whole-note)
2. [Deselect individual matches before applying](#deselect-individual-matches-before-applying)
3. [Refine a rule that matched too much or too little](#refine-a-rule-that-matched-too-much-or-too-little)
4. [Undo (or redo) an applied replacement](#undo-or-redo-an-applied-replacement)
5. [Configure multiple endpoints (home + on the road)](#configure-multiple-endpoints-home--on-the-road)
6. [Point the plugin at Ollama instead of LM Studio](#point-the-plugin-at-ollama-instead-of-lm-studio)
7. [Pick or pin a specific model](#pick-or-pin-a-specific-model)
8. [Recover from an "unsafe pattern" error](#recover-from-an-unsafe-pattern-error)
9. [Recover from "the model did not answer with JSON"](#recover-from-the-model-did-not-answer-with-json)
10. [Raise the time budget for a large note](#raise-the-time-budget-for-a-large-note)
11. [Turn off reasoning suppression](#turn-off-reasoning-suppression)

---

## Run on a selection instead of the whole note

Use this when you only want the rule applied to part of a note — a single section, a
pasted block, a table — rather than the whole document.

1. Select the text you want to affect in the editor.
2. Open the Transmute panel (ribbon icon "Transmute").
3. Click the **"Selection"** button in the scope switch at the top of the panel.
4. Describe the change and click **"Generate"** as usual.

The instruction, the sample sent to the model, the preview, and the final "Apply" all
operate on the selected text only — nothing outside the selection is touched. If you
change your selection in the editor after generating a preview, re-run "Generate" (or
"Refine") so the plugin reads the new selection; the preview does not follow editor
changes automatically.

To make **"Selection"** the default every time you open the panel, set **"Default
scope"** to **"Selection"** in settings (see [Reference](reference.md#settings)).

---

## Deselect individual matches before applying

Use this when the pattern is basically right but caught one or two matches you don't
want to change.

1. Generate a rule as usual and look at the match list in the preview.
2. Click the checkbox next to any match you want to leave alone. Its row stays visible
   (so you can still see what it would have matched) but is excluded from "Apply".
3. Use **"Select none"** to start from nothing and tick only the matches you want, or
   **"Select all"** to go back to everything.
4. Click **"Apply"**. Only the ticked matches are written.

This is often faster than refining the instruction when only one or two matches are
wrong and the rest are fine.

---

## Refine a rule that matched too much or too little

Use this when the generated pattern is close but not quite right — it caught something
it shouldn't have, or missed something it should have.

1. After a rule is generated and you see the preview, look at what it actually matched.
2. In the refine box below the match list, describe the correction in plain language,
   for example:
   - `but not inside code blocks`
   - `also match single-digit days like 5.7.2026`
   - `only in headings`
3. Click **"Refine"**.

Transmute sends the model the full history of instructions and previous answers *plus*
the real matches the current pattern produced — so refining is not a blind restart; the
model sees exactly what its own pattern did. You can refine as many times as you like
before applying; each round replaces the preview with a new one.

---

## Undo (or redo) an applied replacement

Transmute does not have its own history browser — it deliberately relies on Obsidian's
built-in undo instead (see [Explanation](explanation.md#why-there-is-no-snapshot-system)
for why).

1. After clicking **"Apply"**, place the cursor in the note that was changed (it is
   already active, since Transmute always operates on the active note).
2. Press **Cmd+Z** (macOS) or **Ctrl+Z** (Windows/Linux) to revert the replacement in
   one step.
3. Press **Cmd+Shift+Z** / **Ctrl+Shift+Z** to redo it.

This works exactly like any other manual edit, because that is what it is under the
hood: Transmute writes through the editor's own `replaceRange`, not by rewriting the
file directly.

---

## Configure multiple endpoints (home + on the road)

Use this when the machine running your local model isn't always the one you're
editing on — for example a desktop running LM Studio, and a phone or laptop that
reaches it over the LAN or a VPN.

**The idea:** put `http://127.0.0.1:1234` first (works on the machine running LM
Studio itself) and a LAN address second (works from another device). Transmute tries
them in order and uses the first one that answers, so the same settings work
everywhere.

1. Open **Settings → Community plugins → Transmute**, under **"Connection" → "Endpoints"**.
2. You'll see one input field per endpoint, plus an empty field at the bottom that acts
   as "add new".
3. Click into the empty field and enter the LAN address of the machine running your
   server, e.g. `http://192.168.178.27:1234`.
4. Press Tab or click away (the row commits on blur, not on every keystroke). A
   reachability icon appears next to the new row.
5. Click **"Test connections"** to re-check every row at once.

Notes:

- **Order = priority.** Transmute tries endpoints top to bottom and uses the first one
  that answers.
- **Removing an endpoint:** clear its field and click away. The empty row disappears.
- **Warnings, not blocks.** A row can show a warning icon (missing `http://`, missing
  port, a documentation-placeholder IP) without preventing you from saving it — these
  are hints, not validation errors.

---

## Point the plugin at Ollama instead of LM Studio

1. Start Ollama with a model pulled (`ollama pull <model>` if you haven't already) — it
   listens on port `11434` by default.
2. Open **Settings → Community plugins → Transmute**, under **"Connection" →
   "Endpoints"**.
3. Click the **"Ollama"** preset button — it adds `http://localhost:11434` to the
   endpoint list. (There's a matching **"LM Studio"** preset for `http://127.0.0.1:1234`.)
4. If you no longer want the LM Studio default tried first, clear its field to remove
   it, or leave both in place — Transmute falls through to whichever answers first.

---

## Pick or pin a specific model

By default the **"Model"** setting is empty, which lets the server use whichever model
is currently loaded.

1. Open **Settings → Community plugins → Transmute**, under **"Connection" → "Model"**.
2. Use the dropdown to pick a specific model id, populated from the active endpoint's
   `/v1/models`.
3. If you've since loaded a different model on the server, click the reload icon
   (`refresh-cw`) next to the dropdown to refresh the list.
4. To go back to "let the server choose", pick the empty option at the top of the
   dropdown (labelled "(let the server choose)").

---

## Recover from an "unsafe pattern" error

Occasionally the model proposes a regular expression that Transmute's safety guard
rejects before it is ever run — for example one containing a nested quantifier like
`(a+)+`, which can hang on certain inputs. The panel shows a message such as *"The
pattern nests quantifiers, which can hang the editor."*

This is not a bug to work around — the guard exists precisely to stop that pattern from
running. To move forward:

1. Rephrase the instruction to be more specific about what should and shouldn't match —
   vague instructions are more likely to produce an unsafe generalization.
2. Click **"Generate"** again (or **"Refine"** if you already had a working rule and
   this happened during a refinement).
3. If it keeps happening for the same kind of instruction, try breaking it into two
   simpler rules applied one after another instead of one broad rule.

See [Reference → Risk messages](reference.md#risk-messages) for the full list of
rejected constructs, and [Explanation](explanation.md#why-the-guard-has-no-web-worker)
for why this check happens before execution rather than by cancelling a running match.

---

## Recover from "the model did not answer with JSON"

Small or heavily quantized local models occasionally answer with prose instead of the
required JSON object, or wrap it in something the parser can't recover. Transmute
already retries once automatically with the parse error sent back to the model before
showing this message — so if you see it, the retry also failed.

1. Click **"Generate"** (or **"Refine"**) again; a second independent attempt often
   succeeds, especially with models that sample with some randomness.
2. If it fails consistently, try a larger or more instruction-following model — the
   JSON contract has no hard schema enforcement on the server side (deliberately, to
   stay usable with any OpenAI-compatible server), so the model's own instruction
   -following quality matters.
3. Simplify the instruction; very long or ambiguous instructions are more likely to
   derail smaller models before they get to the JSON.

---

## Raise the time budget for a large note

If a note is very large and a line-by-line pattern needs more than the default 2
seconds to scan it, the panel shows *"Stopped after the time budget at line N. Showing
what was found so far."* rather than hanging indefinitely.

1. Open **Settings → Community plugins → Transmute**, under **"Behaviour" → "Time
   budget for running the pattern (ms)"**.
2. Raise the value (for example to `5000` for five seconds).
3. Re-run **"Generate"**.

Note that this setting only affects line-by-line execution. Multi-line patterns (using
an `s`/`m` flag, or containing a literal `\n`) run once against the whole text and are
not subject to the time budget — see
[Explanation](explanation.md#why-the-guard-has-no-web-worker) for why.

---

## Turn off reasoning suppression

**"Ask reasoning models to skip thinking"** is on by default, which asks
reasoning-capable local models (thinking-mode Qwen, DeepSeek-R1-style models, etc.) to
skip their visible chain-of-thought for faster, more direct answers. `<think>` blocks
are stripped from the answer either way before parsing, so turning this off does not
change correctness — only response latency and, for some models, answer quality.

1. Open **Settings → Community plugins → Transmute**, under **"Behaviour" → "Ask
   reasoning models to skip thinking"**.
2. Toggle it off if you are using a non-reasoning model (where the setting has no
   effect) or if you specifically want a reasoning model to think before answering.

---

For the architecture and module layout behind all of this, see
[AGENTS.md](../../AGENTS.md) in the repository root.
