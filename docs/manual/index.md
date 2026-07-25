# Transmute — Manual

Describe what to replace in plain language — a local LLM writes the regular expression, and you review every match before anything is written.

This manual is organized along the four [Diátaxis](https://diataxis.fr/) quadrants. Each quadrant serves a different need: pick the one that matches what you are trying to do right now.

The manual is written in English. The plugin's interface, however, is bilingual and follows Obsidian's display language (English canonical, German translated), so labels are quoted in English with the German equivalent noted where it helps. See [Reference → UI language](reference.md#ui-language) for the details.

## The four quadrants

### [Tutorial](tutorial.md)

*Learning-oriented.* A guided, start-to-finish walkthrough that takes you from a fresh install to your first applied replacement. Start here if you have never used the plugin: it gets you to first success — point the plugin at a local endpoint, open the panel (ribbon icon "Transmute"), describe a change, and click "Apply".

### [How-to guides](how-to.md)

*Task-oriented.* Short, goal-directed recipes for specific jobs once you know your way around — for example running on a selection instead of the whole note, refining a rule that matched too much, configuring a second endpoint for when you're away from your desk, or recovering from an "unsafe pattern" error.

### [Reference](reference.md)

*Information-oriented.* The dry, lookup-style facts: every setting and its default (under the "Connection" and "Behaviour" headings), the command and its id, the ribbon icon, every error and risk message the panel can show, and the JSON contract the model is asked to answer with.

### [Explanation](explanation.md)

*Understanding-oriented.* The design and rationale behind the plugin: why preview-before-apply is the actual product rather than a nicety, why there is no separate snapshot/undo system, and why the safety guard against runaway patterns works without a web worker. Module and source layout live in [AGENTS.md](../../AGENTS.md), not here.

## Not sure where to start?

- **New here?** Read the [Tutorial](tutorial.md) first.
- **Know what you want to do?** Jump to the matching [How-to guide](how-to.md).
- **Looking up a setting, error, or command?** Go to the [Reference](reference.md).
- **Want to understand a design decision?** See the [Explanation](explanation.md).

---

Back to the [project README](../../README.md).
