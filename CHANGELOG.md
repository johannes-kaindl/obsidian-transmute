# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Changed

- Kit pins raised to obsidian-kit 0.69.1 / code-kit 0.36.0 (from 0.61.0 / 0.34.0); the four modules the newer connection needs (`anthropic-wire`, `override-guard`, `anthropic-transport`, `plugin-api`) are vendored, the bundle grows by about 16 KB.
- Settings, "Request" section: when a request would make LM Studio load a different model and push a loaded one out (JIT loading), the section warns about it. Next to the hint "model family detected" there is a button "Set family in the manager" that opens the LLM Endpoint Manager's settings. Where "off" is not possible (Gemma 4 on LM Studio, Claude), the thinking control reads "Thinking: lowest level" and the reason is in its tooltip; for Claude the field is called "Thinking effort (effort)". New styles for the section are in `styles.css` (`REQUEST_SECTION_CSS`).
- Code-kit 0.36.0 adds the endpoint role "used for search, does not write" and makes the folder filter fail closed on an unreadable path. Neither changes anything here: this plugin has no search-only endpoints, and the folder filter answers the same for every path checked (sibling folders, `..`, NUL).

## [0.14.2] — 2026-10-23

### Changed

- Kit update (code-kit 0.28.0 → 0.34.0). Whether a model on LM Studio thinks or sees images now comes from its metadata instead of only its name, so the thinking toggle can appear for more models. Claude models are recognised as models that take images and, from the Fable, Opus 4.7 and Sonnet 5 generations on, as models whose thinking cannot be switched off.
- The folder filter of a vault-wide run uses the shared kit module `folder-scope`: whole folder names only (`10_Not` no longer reaches into `10_Notizen`), names that differ only in Unicode normal form match, and a folder containing `..` holds nothing. With an empty folder and "include subfolders" switched off, only the notes in the top level of the vault are taken; before, every note in every folder was taken.
- The selection a rule was previewed on is found again by the shared kit module `text-anchor`, and the context around a hit is clipped by `clip-context`; both answer as the local versions did, nothing changes on screen.

## [0.14.1] — 2026-10-16

### Changed

- Vendored `obsidian-kit` 0.61.0 (was 0.60.1) and `code-kit` 0.28.0 (was 0.27.1). You will notice four things:
- Gemma 4 in LM Studio no longer breaks a rule. LM Studio ignores "thinking off" for this model and writes the thought into the answer text, in front of the rule; the plugin now cuts it off, so the rule it reads is the model's answer and not a draft from its thinking.
- With "thinking off" on Gemma 4 in LM Studio the plugin now sends the lowest thinking level, because LM Studio ignores "none" there. The model still thinks a little (a few more tokens and a bit more time). The thinking button says so ("cannot be fully turned off here"), and the "Request" section shows the same note.
- When no endpoint answers and you use the local endpoint list, the message is now the kit's: "No endpoint reachable. Check the endpoint list in the settings — the test button says which one answers." It adds the hint about the test button. With the LLM Endpoint Manager the message still names the actual reason.
- A backend or model family that this version does not know yet no longer makes a request fail; the "Request" section names it and sends only the standard fields.

## [0.14.0] — 2026-10-14

### Added

- **A "Reset panel" command**, and "Reset" in the panel now asks first when a preview is showing. The preview and its history are discarded; the note stays unchanged. Without a preview, Reset works without a question as before.

### Changed

- **Snapshots are kept by day, week and month instead of "the last 5".** After a vault-wide replacement the snapshot folders are thinned the way backups usually are: the newest six of today, the oldest of each of the last 7 days, 4 weeks and 6 months. The newest snapshot is always kept, so "Undo" for the last replacement keeps working. The setting "Snapshots to keep" is gone; older folders are read as before, and a folder whose name carries no time is never deleted. New snapshot folders carry milliseconds in their name (`2026-08-14T17-02-11-123Z`).
- **The model's reasoning is shown as formatted text** instead of a plain block (links and images in it are neutralised first).
- **The ribbon tooltip and the command "Open panel" follow the interface language.**
- **The thinking button is the kit's** (same label, icon and spacing as in the other plugins). For a model without an "off" (gpt-oss) the button reads "Thinking: minimal" instead of "Thinking off" and switches between minimal and the chosen level; before, it was disabled and said "Always thinks".
- **In a narrow sidebar the scope buttons and the model row wrap instead of being cut off.**

### Fixed

- **Error messages name the real reason when the LLM Endpoint Manager has no endpoint for you:** a missing API key, an endpoint switched off there, an endpoint that no longer exists, or a manager that does not answer — one text each, in English and German — instead of one generic "no usable endpoint" (obsidian-kit 0.60.0).
- **The warning about discarded request settings lists them sorted** instead of in the order they were stored (obsidian-kit 0.60.1, code-kit 0.27.1).
- **The Apple Intelligence hint under the endpoint choice now appears when you pick that endpoint**, not only after reopening the settings.

## [0.13.1] — 2026-10-14

### Changed

- **The model ID in the endpoint list stays visible.** At normal window width the model ID in an endpoint row is no longer cut off; a very long ID gets its own line, and in a narrow window the block of model field and buttons moves to a second row as a whole (obsidian-kit 0.59.1).

## [0.13.0] — 2026-10-12

### Added

- **A "Library" tab in the panel.** A tab bar (the kit's hub) now switches between "Workspace" (the panel as before) and "Library": your saved rules as a list with a "Run" button per row. "Run" fills in the saved pattern and replacement for the current note or selection and switches back to the workspace, where the preview appears — no model call. The row of preset buttons under "or write the pattern yourself" is gone; the rules live in the tab.

### Fixed

- **Running a saved rule now shows it in the pattern and replacement fields.** Before, the preview was computed from the rule but the two fields stayed empty.

### Changed

- **Kit pins raised to obsidian-kit 0.59.0 / code-kit 0.24.0** (from 0.57.0; the 0.58.0 release only adds test helpers, nothing visible). Visible effects:
  - **Settings, endpoint list:** the "move to top" and "remove endpoint" buttons stay together in one row instead of the trash can wrapping alone into a second line; the key and model fields are a little narrower and the address stays fully visible.
  - **Settings, "Request" section:** for an endpoint whose model family is not known yet it now reads "Family: not detected yet · Backend: not detected yet" with a note that this is normal for a freshly added endpoint (the LLM Endpoint Manager records family and backend), and the fields say "Not sent yet — waiting for the model family" instead of "Not sent — the model family is unknown".
- Kit pins raised to obsidian-kit 0.57.0 / code-kit 0.24.0. Classifying a failed Shortcuts call (timeout, busy, cancelled, unsupported) now uses the kit's shared `classifyShortcutFailure` instead of a local copy; it returns the same reason and message for every status and error body, so nothing changes for you.

## [0.12.0] — 2026-10-12

### Changed

- **The connection now comes from obsidian-kit 0.56.0 and code-kit 0.23.0.** Visible effects:
  - **Context length per endpoint row.** Below a reachable row with a model the settings show "Context: loaded N · max M tokens" (only "max M" while the model is not loaded; nothing when the server names no number), read from LM Studio or Ollama with a 5-second limit per attempt.
  - **The model dropdown of a row offers "— (server picks)" again** (the screenshot in the settings docs shows it). Choosing it removes the row's model, so the server decides.
  - **Long streamed answers render faster and leak less** (incremental guard against remote content in model output), and closing the panel while an answer is still rendering no longer cuts off the last guard pass.
  - **The `<think>` stripping that checks every answer is linear.** A degenerate answer with tens of thousands of `<think>` tags used to freeze for seconds.
  - The wording of the status icons and input hints in the endpoint list is now the kit's (English and German).
- **Reading the rule from a model answer comes from code-kit `llm-json`.** Of the existing cases nothing changes, but:
  - JSON behind prose that contains brackets (`see [1]: {…}`) is found now; before it was reported as "no JSON".
  - A bracket pair that is not JSON in front of the real object no longer hides it.
  - **An unclosed `<think>` now drops everything after it** (before, a JSON behind it was still read). This applies to the rule and to the diagnosis text.
  - With several stray `</think>` the text is cut up to the last one.
  - Reading is linear for degenerate answers (measured up to 50 000 repetitions: a few milliseconds).
- **The version history uses code-kit `rounds`** (selecting, appending and the "tune again builds on the active version" cut). Nothing changes for you: stepping back and tuning again still appends after the last version and builds on the one you selected, and nothing is cut off.

### Removed

- Internal: `extractChatContent`, `extractFinishReason` and `extractReasoning` (unused since 0.8.0).

## [0.11.0] — 2026-10-11

### Changed

- **The global *Model* setting is gone; each endpoint row carries its own model.** An existing value moves once into the rows that had none. The model dropdown in the panel now writes into the active row (with the LLM Endpoint Manager: into the choice), and "let the server choose" empties it. With the Manager, the panel now shows the model that is actually used, including the Manager's default, instead of only an explicit choice.
- The connection now comes from obsidian-kit 0.53.0 and code-kit 0.21.1. A fenced Mermaid diagram in a model answer that could load remote content is shown as plain text.
- The connection now masks `Bearer` tokens more broadly (code-kit 0.21.x: from 8 characters, case-insensitive, `=` allowed in the token). Prose such as "Bearer authentication" is sent to the model as `Bearer [redacted-token]` and comes back that way in the answer.

### Fixed

- A model answer with tens of thousands of unclosed `<think>` tags no longer freezes the panel: stripping thinking blocks is now linear (50,000 tags took 2.5 s, now under a millisecond). With two or more stray `</think>` the text is cut after the last one.

## [0.10.1] — 2026-10-10

### Documentation

- Re-captured the settings screenshot to show the shared endpoint list and request section.

## [0.10.0] — 2026-10-09

### Changed

- **The model connection now comes from obsidian-kit 0.51.2** (`createLlmConnection`) and code-kit 0.15.0 instead of a local resolver and client. The settings tab shows the kit's endpoint list and a new collapsible **Request** section (sampling values and thinking level per mode, with a note on what is actually sent).
- **Longer wait for the first answer.** The request now waits up to 15 minutes for an answer (was 2 minutes), so a model that is still loading no longer runs into a timeout. An Apple Shortcut keeps its own limit plus a margin.
- **One client per endpoint**, and the backend (LM Studio, Ollama, …) is detected once per endpoint and remembered for 30 seconds.
- **Secrets are redacted before sending, and restored in the answer.** Keys of well-known providers, `Bearer` tokens (16 characters or more) and private-key blocks in the text sample go to the model as placeholders (`[redacted-token-1]`); if the model repeats one in its rule, the rule you see and apply carries the original. The server never sees the secret.
- **The llm-lab log shows the text that was sent**, with the placeholders, not the originals. A secret in your text never reaches the lab log.
- **API keys move to Obsidian's keychain.** An existing key in `data.json` is moved on the first run; afterwards `data.json` holds only a reference. Needs Obsidian 1.11.4 or newer (`minAppVersion` was 1.8.7).
- **The endpoint's model choice only counts with the LLM Endpoint Manager.** Without it, an old manager choice can no longer override the model of the local list.

### Removed

- The setting **Request timeout (ms)**: the limits come from the connection now (see above).
- The setting **Ask reasoning models to skip thinking**: use the thinking level of the **Structured** mode in the **Request** section instead, or the **Thinking** toggle in the panel (off = off, on = the last level you chose, "low" at first). An existing "off" stays off; an existing "on" becomes the level "low".
- The separate **Model** row in the settings: the model is chosen per endpoint row ("global model") or, with the manager, in the endpoint section.

### Notes

- The temperature stays `0` for every request, so the same text and instruction give the same rule. The **Request** section shows the mode's profile temperature (0.1) for information; it does not apply here.

## [0.9.1] — 2026-10-03

### Changed

- The README now embeds all three screenshots (preview, vault scope, settings).
- Internal design notes moved out of the repository; the user documentation is unchanged.

## [0.9.0] — 2026-09-30

### Added

- The GitHub release now also carries a ready-to-unpack `transmute.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.
- **Apple Intelligence (on-device) as an endpoint.** With the LLM Endpoint Manager 0.4.0 the endpoint dropdown also offers "Apple Intelligence (on-device)"; the request then runs through an Apple Shortcut instead of HTTP. Limits: the answer arrives all at once, is capped at about 4096 tokens, Shortcuts briefly comes to the front, and only one request runs at a time. The Model field stays empty. Failures of the shortcut (timeout, busy, cancelled, error) show their own message. See the how-to "Use the Apple Intelligence endpoint".

### Changed

- obsidian-kit 0.46.0 and code-kit 0.9.0 (was 0.43.0 and 0.7.0, chat client 0.44.0, help row 0.43.0). Brings the shortcut bridge and transport choice; the endpoint dropdown, model picker and other kit parts are updated with it.

## [0.8.0] — 2026-09-26

### Changed
- **Chat client from obsidian-kit 0.43.0** (`createChatClient`, non-streaming over Obsidian's `requestUrl` as before), replacing the local client. Visible effects:
  - An error body inside an HTTP `200` answer (LM Studio answers a wrong path that way) is now reported with the server's own message instead of falling through as an empty answer.
  - A timeout is now reported as "no data for N s" (the wait limit from the settings) instead of the bare word "timeout".
  - Error messages from the server are cut to one line of at most 200 characters (before: 300).
  - A model's inline `<think>` block and its reasoning fields are separated by the client, as before; a rule is still sent with temperature 0.
- **Lab recording through `logToLab`** (kit `lab-client`): a Lab with another `apiVersion` is named once per session in the console instead of looking like "no Lab".
- Kit vendoring raised to 0.43.0 (adds `chat-client`, `chat-transport`, `clock`, `lab-client`, `sse`).
- The README is shorter: the **Features** and **Usage** sections (with the settings table) moved word for word to `docs/manual/features-and-usage.md` (German: `features-and-usage.de.md`); the README keeps a short version of each and a new short **Configuration** section, all linking there.

## [0.7.0] — 2026-09-26

### Added

- Help row at the top of the settings with links to the documentation and the issue tracker.
- Documentation index (`docs/README.md`) and a troubleshooting page that lists the plugin's messages with cause and fix.

### Fixed

- Documentation named the button "Generate" and listed two scopes; it is "Preview" and there are three (note, selection, vault).

## [0.6.1] — 2026-09-26

### Fixed

- README: the snapshot location no longer uses an angle-bracket placeholder (`<config dir>`), which the Community Store scan flagged as unfilled placeholder text.

## [0.6.0] — 2026-09-25

### Added

- **Endpoints from the LLM Endpoint Manager.** If the LLM Endpoint Manager plugin is installed, Transmute now takes its endpoint (and keys, stored in the keychain) from there: Settings show an endpoint picker, a model picker and a "copy local endpoints into the manager" button instead of the local list. Behaviour change worth knowing: with the manager active it decides alone — there is no silent fallback to the local list when it offers no endpoint (a missing key gets its own message pointing at the manager), and the panel's model field then writes the manager choice, not the local model setting. The local list and model setting stay as the fallback when the manager is absent, and are unchanged in that case.

- **llm-lab integration** — every model call now carries a `feature` tag
  (`rule:apply`/`rule:diagnose`) so the two call shapes on the same port are distinguishable
  downstream, and reports itself to llm-lab when the plugin is installed (model, endpoint,
  messages, latency, a stable `promptTemplate`, and a `turnId` grouping a diagnosis with the
  version it explains). No effect when llm-lab is absent.
- **Presets** — a saved rule (pattern, flags, replacement) can be fired from the sidebar
  with one click, no model round-trip needed. Managed in Settings.
- **A built-in "Remove line breaks in paragraphs" preset**, seeded for new installs —
  joins soft-wrapped lines of a paragraph while leaving blank lines, headings, lists,
  blockquotes, tables and code-fence lines untouched. (Known limitation: lines strictly
  *inside* a fenced code block are still joined — only the fence lines themselves are
  protected, since a stateless pattern cannot track "inside a fence" across lines.)

### Fixed

- **Applying a rule no longer empties the form.** Pattern, flags and replacement now stay
  on screen after "Apply", so a second application with a small correction doesn't need
  a fresh request. A new explicit "Reset" button clears the round on purpose.
- **Thinking toggle now shows its state without relying on color alone** (UI-STANDARD §8,
  state-button contract) — `aria-pressed` was missing entirely, and a locked (always-on
  thinker) toggle carried only `aria-disabled` instead of the native `disabled` property.
  Fixed: `aria-pressed` follows the state on every render, `disabled` is now the native
  button property, and the icon switches `brain` ↔ `brain-cog` for on/off instead of always
  showing `brain`.
- `\n` and `\t` in a replacement pattern are now interpreted as a line break / tab,
  instead of being inserted as the literal two-character string (JavaScript's
  `String.replace` only understands `$`-tokens, not backslash escapes).
- A model answer cut off at the token limit is now detected via `finish_reason` instead of
  silently passing as complete. A usable partial answer is shown with a warning, not
  blocked; an answer cut off with nothing usable gets its own error naming the limit.

## [0.5.0] — 2026-08-16

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
