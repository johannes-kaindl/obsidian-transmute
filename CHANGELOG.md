# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
