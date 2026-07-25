# Tutorial: Your first applied replacement

This is a hands-on, learning-oriented walkthrough. By the end you will have taken a
plain-language instruction, watched a local model turn it into a regular expression,
reviewed every match, and applied it — entirely on your own machine, with an undo
available the whole time.

We will do this together, one step at a time, with a concrete example. This is not a
catalogue of every option; it is one path from nothing to your first success. Once you
have felt how the pieces fit, the [How-to guides](how-to.md) and the
[Reference](reference.md) will show you the rest.

What you need before we start:

- Obsidian 1.8.7 or newer (Desktop or Mobile).
- A note with a handful of European-style dates in it (`DD.MM.YYYY`, e.g. `25.07.2026`)
  somewhere in the text — a meeting log, a journal, anything with a date or two.

Let's go.

## Step 1 — Start a local server

Transmute does not include an AI model. It talks to an OpenAI-compatible server that
*you* run on your own machine, and that server does the actual work of turning your
instruction into a regular expression. For this tutorial we will use
[LM Studio](https://lmstudio.ai), because it has a friendly interface and a built-in
model browser — but [Ollama](https://ollama.com) works just as well.

1. Download and open LM Studio.
2. Search for and download a chat-capable model — nothing special is required; a
   general-purpose instruction-following model is enough.
3. Load that model, then start the local server.

Note the address LM Studio is serving on: **LM Studio listens on port `1234`**, so its
address is `http://127.0.0.1:1234` — which happens to be Transmute's default endpoint,
so if you are using LM Studio there is nothing to change here.

## Step 2 — Install and enable the plugin

Install Transmute from **Settings → Community plugins → Browse** (search for
"Transmute" and click **Install**), or use any of the other install paths in the
[README](../../README.md). Then open **Settings → Community plugins** and enable
**Transmute**.

When it is enabled you will see a new icon in the left ribbon labelled **"Transmute"**
(a `replace` icon). We will use it in Step 4.

## Step 3 — Check the connection (usually nothing to do)

Open **Settings** and find the Transmute settings tab. Under the **"Connection"**
heading you will see the endpoint list, defaulting to `http://127.0.0.1:1234`. Each
row shows a reachability icon once it has been checked — a green check means the
server answered. If you are running LM Studio on the default port, this should already
be green and there is nothing further to configure.

If you are using Ollama instead, click the **"Ollama"** preset button to add
`http://localhost:11434` to the list — Transmute tries endpoints in order and uses the
first one that answers, so you can keep both configured.

You can leave **"Model"** empty — the server will use whichever model you loaded, and
the model that actually answered is what Transmute uses.

## Step 4 — Open the panel

Click the ribbon icon **"Transmute"** on the left (or run the command **"Open panel"**
from the command palette). A panel opens in the right sidebar.

Open your note with the dates in it and make sure it is the **active** note — the one
you are looking at — since the panel always works on the note you have open.

## Step 5 — Pick a scope and describe the change

At the top of the panel you'll see a scope switch with two buttons: **"Whole note"**
and **"Selection"**. For this first run, leave it on **"Whole note"** so the plugin
sees every date at once.

In the instruction box, type:

```
turn dates from DD.MM.YYYY into YYYY-MM-DD
```

Then click **"Generate"**.

## Step 6 — Watch it think, then review the preview

The panel shows **"Asking the model…"** briefly while the request is in flight. When it
returns, you'll see:

- The generated pattern, shown as `/…/…` with its flags.
- A one-sentence explanation of what the pattern matches.
- A list of every match found in your note, each with a checkbox, the line number, and
  a before/after view with the change highlighted.

Every checkbox starts **ticked**. Nothing in your note has changed yet — this is a
preview, not an edit. Read through the matches: do they look right? If a date got
matched that shouldn't have (or one was missed), leave it for the next step.

## Step 7 — Refine if needed

Suppose one of your matches turned out to be inside a code block, and you'd rather
leave code examples alone. Instead of starting over, type into the refine box at the
bottom of the preview:

```
but not inside code blocks
```

and click **"Refine"**. Transmute sends the model your original instruction, its first
answer, the actual matches it found, and this new instruction — so the model can see
exactly what it got wrong and adjust. A new preview replaces the old one.

(If nothing needs fixing, skip this step entirely and go straight to applying.)

## Step 8 — Apply, and see the undo safety net

When the preview looks right, click **"Apply"**. Only the checked matches are written,
all at once, through Obsidian's own editor — which means the change lands on
Obsidian's normal undo stack exactly like any manual edit.

Try it: press **Cmd+Z** (or **Ctrl+Z** on Windows/Linux). The replacement is undone in
one step, no separate history or snapshot browser required. Press **Cmd+Shift+Z** to
redo it.

## What you learned

In this tutorial you:

- Started a **local server** (LM Studio) and confirmed Transmute's default endpoint
  reaches it.
- **Installed and enabled** Transmute, and opened its panel from the ribbon.
- Described a change in **plain language** and watched the model turn it into a regex
  with an explanation.
- Reviewed a **preview** of every match before anything was written.
- **Refined** the rule with a follow-up instruction, without starting over.
- **Applied** the change and confirmed it undoes in one step via Obsidian's own
  **Cmd+Z**.

Most importantly, you now have a feel for the rhythm of the tool: describe, review,
refine if needed, apply.

## Where to go next

- For task-focused recipes — running on a selection, configuring a second endpoint,
  deselecting individual matches, recovering from an "unsafe pattern" error — see the
  [How-to guides](how-to.md).
- For the exact list of settings, defaults, error messages, and the JSON contract, see
  the [Reference](reference.md).

This tutorial and the rest of the documentation are licensed under
[CC BY-SA 4.0](../../LICENSE-DOCS).
