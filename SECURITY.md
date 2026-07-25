# Security Policy

## Supported Versions

Security updates are provided for the most recently released version of Transmute. Older versions do not receive backported fixes — please update to the latest release.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public issues.

Instead, report them privately by email to **code@jkaindl.de** (PGP-encrypted mail is welcome). You will receive a prompt acknowledgement, and we will keep you informed as the fix progresses.

## Data Handling / Scope

Transmute is local-first by design, which is also its core security property:

- **Note content is sent only to the local endpoint you configure.** When you generate or refine a rule, the plugin sends a text sample of the active scope (file or selection, capped by the "Text sample sent to the model" setting) plus your instruction to the OpenAI-compatible chat endpoint set in the plugin settings (default `http://127.0.0.1:1234`). Nothing is sent anywhere else, and nothing is sent at all until you click "Generate" or "Refine".
- **No telemetry.** The plugin does not collect usage data or phone home.
- **Nothing goes to the cloud or to third parties** unless you deliberately point the endpoint list at a remote server yourself. No external services, no analytics, no remote logging are built in.
- **The trust anchor is the local server you control.** Because all note content flows exclusively to the endpoint(s) you configure, the security of your data rests on the server you run and trust (for example LM Studio or Ollama). Keep that server local and under your control.
- **Nothing is written without your review.** A generated rule is only ever a proposal: it is compiled, screened for unsafe regex constructs, and run read-only against your text so you can preview every match. The note itself is modified only when you click "Apply", and only for the matches you left checked.

If you have questions about the plugin's data handling beyond what is described here, the same private contact above applies.
