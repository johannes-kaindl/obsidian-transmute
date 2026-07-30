# Contributing to Transmute

Thanks for your interest in improving **Transmute** — an Obsidian plugin that turns a plain-language search-and-replace instruction into a previewed, applied regular expression via a local LLM.

Contributions of all sizes are welcome: bug reports, fixes, docs, and features. Before you start, please skim [`AGENTS.md`](AGENTS.md) in the repo root — it holds the architecture, module layout, and the detailed engineering conventions. This document is the contributor-facing summary. The conventions below follow the workspace's leading **comply-or-explain** convention: deviate when you have a good reason, and say why in the PR.

## Branch model

- `main` is always green — it must build, pass tests, and typecheck at every commit.
- Do feature work on a `feat/<name>` branch.
- Merge into `main` with `--no-ff` so the history keeps the merge structure.
- Direct pushes to `main` happen only with explicit authorization.

## Commits

- Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat|fix|docs|chore|refactor|test(scope): …`. The description itself may be written in German.
- Stage **only the files you actually touched**. Never use `git add -A`.
- When an AI tool made a substantial contribution to a commit, add a trailer:

  ```
  Co-Authored-By: Claude Opus <Version> (1M context) <noreply@anthropic.com>
  ```

- Don't bypass the pre-commit hooks (no `--no-verify`).

## Tags and remotes

- Releases are tagged with [SemVer](https://semver.org/) **without** a `v` prefix — e.g. `1.2.3`, not `v1.2.3`.
- [Forgejo](https://git.jkaindl.de/jkaindl/obsidian-transmute) is the canonical, primary remote (`origin`).
- The [GitHub repository](https://github.com/johannes-kaindl/obsidian-transmute) is a **mirror** only (used for the community plugin registry and release CI). Open your contributions against Forgejo.

## Quality gate

Run these locally before you commit, and make sure they're green:

- **Tests:** `npm test` — the suite is test-driven and currently has 78 tests (Vitest).
- **Typecheck:** `npm run typecheck` (and `npm run typecheck:test` for the test sources) — must be clean.
- **Lint:** `npm run lint` — an inline-`eslint-disable` gate followed by ESLint, including the `eslint-plugin-obsidianmd` store-review checks.
- **Purity:** `npm run check:pure` — `src/core/` must never import `obsidian`; the reusable regex/LLM/session logic has to stay testable in plain Node.
- **All of the above at once:** `npm run gate`.
- **Pre-commit hooks:** let them run; don't skip them with `--no-verify`.

The project is test-driven, so new behavior should arrive with tests.

All user-facing strings (UI labels, settings, notices) go through the i18n module (`src/core/i18n/strings.ts`) with English canonical + German translation; never hard-code UI text — see [`AGENTS.md`](AGENTS.md) § Conventions (PROF-OBS-07).

## Architecture in one paragraph

`src/core/` is the pure kernel — prompt building, response parsing, regex compilation, the ReDoS guard, execution, and the session state machine — with no `obsidian` import anywhere in the tree (`npm run check:pure` enforces this). `src/obsidian/` is the thin adapter layer: the settings tab, the sidebar view and its DOM rendering, the `requestUrl`-based HTTP transport, and editor I/O. `src/vendor/kit/` holds verbatim snapshots from `obsidian-kit` (endpoint handling, i18n, reasoning suppression, settings merge) — never hand-edit those files; change the kit and re-run `tools/sync-kit.sh` instead. The full rationale lives in [`AGENTS.md`](AGENTS.md).

## Where to work

- File issues and open pull requests on **Forgejo**: <https://git.jkaindl.de/jkaindl/obsidian-transmute>. (GitHub is a mirror, not the place for contributions.)
- For larger features, work through **brainstorm → spec → plan → TDD**. Smaller fixes can go straight to a `feat/<name>` branch with tests.
- The detailed conventions, architecture, and module layout live in [`AGENTS.md`](AGENTS.md).

## License of contributions

This project is dual-licensed by content type:

- **Code** is licensed under **AGPL-3.0-or-later** (see [`LICENSE`](LICENSE)). By contributing code, you agree that your contribution is licensed under AGPL-3.0-or-later.
- **Documentation and other text** is licensed under **CC BY-SA 4.0** (see [`LICENSE-DOCS`](LICENSE-DOCS)). By contributing docs, you agree that your contribution is licensed under CC BY-SA 4.0.

A commercial dual-license is available on request for users for whom the AGPL copyleft is not a fit.
