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

- **Note content is sent only to the endpoint you configure.** When you generate or refine a rule, the plugin sends a text sample of the active scope (the open note if it is in scope, otherwise up to the first three notes of the scope with their paths, capped by the "Text sample sent to the model" setting) plus your instruction, and when refining your earlier instructions and rules and up to three matching lines, to the chat endpoint set in the plugin settings (default `http://127.0.0.1:1234`) or supplied by the LLM Endpoint Manager. Nothing is sent anywhere else, and nothing is sent at all until you click "Generate" or "Refine".
- **No telemetry.** The plugin does not collect usage data or phone home.
- **Nothing goes to the cloud or to third parties** unless you deliberately point the endpoint list at a remote server yourself, or the LLM Endpoint Manager supplies a Claude endpoint (see the next point). No external services, no analytics, no remote logging are built in.
- **Claude (Anthropic) is possible, only through the LLM Endpoint Manager.** If the manager lists a Claude entry, the plugin can use it, and the sample described above then goes to Anthropic's API over the internet, from your device and with the key from the manager's keychain. With the choice on "Automatic" the first reachable, enabled chat entry in the manager's list order wins, so a Claude entry above your local one is used first; pick your local endpoint explicitly in the settings, or move it up in the manager's list, to stay local. Without the manager the plugin never talks to Claude.
- **The trust anchor is the endpoint you pick.** Because all note content flows exclusively to the endpoint(s) you configure or choose in the manager, the security of your data rests on the server you run and trust (for example LM Studio or Ollama) or, with Claude, on Anthropic. Keep the endpoint local and under your control if the notes must not leave your machine.
- **Nothing is written without your review.** A generated rule is only ever a proposal: it is compiled, screened for unsafe regex constructs, and run read-only against your text so you can preview every match. The note itself is modified only when you click "Apply", and only for the matches you left checked.

If you have questions about the plugin's data handling beyond what is described here, the same private contact above applies.
