# Troubleshooting

Each entry starts with the message you see, exactly as the plugin shows it (English interface). If your interface is German, the same entry applies — the German wording is in `src/core/i18n/strings.ts` under the same key.

## The endpoint did not answer: …

**Cause:** The request to your server failed, timed out, or came back with an error status. The text after the colon says which.

**Fix:**
1. Make sure the server is running and a chat-capable model is loaded.
2. In **Settings → Community plugins → Transmute**, press **Test connections**. The row shows one of *Reachable*, *Connection refused*, *Unknown host*, *No answer in time*, *Answers, but not like an OpenAI-compatible API* or *Access denied — key missing or invalid*.
3. *Connection refused* / *Unknown host*: the address is wrong or the server is not running. Enter the base URL without a trailing `/v1`.
4. *No answer in time*: raise **Request timeout (ms)**, or pick a smaller model.
5. *Access denied — key missing or invalid*: add the API key on that endpoint's row.

## The model did not answer with JSON.

**Cause:** Even after one automatic retry, the answer contained no JSON object. Small models often ignore the format.

**Fix:** Press **Preview** again, or pick a larger model. See [Recover from "the model did not answer with JSON"](manual/how-to.md#recover-from-the-model-did-not-answer-with-json).

## The model only thought and gave no answer. Turn thinking off in the settings, or pick another model.

**Cause:** A reasoning model spent its whole token budget on thinking and returned nothing.

**Fix:** Switch **Ask reasoning models to skip thinking** on (or use the **Thinking off** toggle in the panel). A model that always thinks (shown as **Always thinks**) needs a different model.

## The model's answer was cut off at its token limit before anything usable came back. …

**Cause:** The server stopped the answer at its token limit.

**Fix:** Raise the token limit in the server, or ask for something shorter.

## The pattern found nothing in this text. …

**Cause:** The pattern is valid but matches nothing.

**Fix:** Press **Why doesn't this match?**. Transmute re-runs the pattern with one condition relaxed at a time and tells you which one made the difference, with line numbers. Or refine the instruction.

## The generated pattern is not valid: …

**Cause:** The model wrote a pattern JavaScript cannot compile, for example unbalanced parentheses. One automatic retry has already happened.

**Fix:** Press **Preview** again, or edit the pattern in the panel yourself.

## The pattern nests quantifiers, which can hang the editor. (also: "…repeats overlapping alternatives…", "…repeats a backreference without a bound.")

**Cause:** The safety screen rejected a pattern that can run for a very long time. It is never executed.

**Fix:** Refine the instruction ("without nested repetition"). For a pattern you wrote yourself, **Run it anyway** releases exactly that pattern after a timing test. See [Recover from an "unsafe pattern" error](manual/how-to.md#recover-from-an-unsafe-pattern-error).

## Stopped before running. On just … characters this pattern already took … ms …

**Cause:** The timing test on a short sample showed that the pattern would effectively never finish on the longest line. Obsidian cannot cancel a running pattern, so Transmute refuses to start it.

**Fix:** Shorten the line or un-nest the quantifiers.

## More than … matches. The pattern is too broad — narrow it down.

**Cause:** The pattern hit the match limit (500 per run).

**Fix:** Make the pattern more specific, or narrow the scope.

## Stopped after the time budget at line …. Showing what was found so far.

**Cause:** The run exceeded **Time budget for running the pattern (ms)**.

**Fix:** Raise the budget in the settings, or narrow the scope. See [Raise the time budget for a large note](manual/how-to.md#raise-the-time-budget-for-a-large-note).

## Open a note first. / Nothing selected.

**Cause:** Scope is **Whole note** without an open note, or **Selection** with nothing selected.

**Fix:** Open a note, or select the text first.

## Switch the note to editing view first — reading view has no editable text.

**Cause:** The note is in reading view.

**Fix:** Switch the note to editing view (Live Preview or Source mode).

## The note changed since the preview. Run the preview again so the matches line up.

**Cause:** You edited a matched span after the preview. Applying now would replace the wrong text.

**Fix:** Press **Preview** again.

## The note "…" is no longer open. Reopen it, or start a new preview.

**Cause:** A rule is pinned to the note it was generated for, and that note was closed.

**Fix:** Reopen the note, or start a new preview.

## The snapshot could not be written, so nothing was changed: …

**Cause:** A vault-wide replacement writes a snapshot first and stops if that fails (for example a full disk).

**Fix:** Fix the cause named after the colon, then apply again.

## Stopped after … of … files: …. Use undo to restore.

**Cause:** A write failed part-way through a vault-wide replacement.

**Fix:** Press **Undo**. It restores the snapshot. Files you edited after the replacement are left alone and counted ("… files were edited after the replacement and were left alone.").

## The LLM Endpoint Manager has no key stored for this endpoint. / …offers no usable endpoint.

**Cause:** With the LLM Endpoint Manager plugin installed, Transmute takes endpoints and keys from it.

**Fix:** Add the key, or check the endpoint, in the manager's settings.

## The model list stays empty, or the model is "no longer offered"

**Cause:** The dropdown reads `GET /v1/models` from the active endpoint. The message "The endpoint no longer offers "…". Pick another model." means the saved model is not loaded any more.

**Fix:** Load the model on the server, use the reload button next to the model dropdown, or pick another model.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/obsidian-transmute/issues) with your Obsidian version, the plugin version (Settings → Community plugins) and what you expected to happen.
