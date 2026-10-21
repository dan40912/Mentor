# Mentor

Hand one piece of work between AI agents while keeping its goal, decisions, outputs and review history.

Mentor runs locally. Its Web app handles assignment and decisions; its optional Obsidian integration handles notes and reading. A task Markdown file is the shared source of truth. Round cards separate the request, the agent’s interpretation, registered outputs and machine checks. A human still accepts the result.

[繁體中文](README.zh-TW.md) · [GitHub](https://github.com/dan40912/Mentor) · [MIT](LICENSE)

> **Development version v0.1; UI is Traditional Chinese.** This branch includes an Obsidian sidebar, theme, templates and reversible index plans. Obsidian desktop and human usability acceptance remain unverified. One real Codex execution → Claude review smoke test passed; this does not verify every provider, platform or visual result. See the [requirement and evidence tracker](docs/implementation/mentor-obsidian-status.md).

![Mentor workflow home](docs/images/workflow-home.jpg)

Current Web home with fictional demo data; no live AI run is shown.

## What it helps with

Use it for local document work that needs scope decisions, agent handoffs, artifact review and reusable lessons. It is not an unattended publishing service or a guarantee that quota and authentication failures resolve automatically.

| Entry | Purpose |
| --- | --- |
| Now (現在) | The next human decision, answer or review, plus recent work |
| Tasks (任務) | Create, clarify, preview a plan, execute, review and revise |
| Outputs and knowledge (成果與知識) | Open registered outputs and expand feedback, recall and activity |
| More tools (更多工具) | Handoff history, conversations, projects and role settings |
| Optional Obsidian sidebar | Prepare tasks from a note or selection, inspect the same task, preview organization and save handoffs |

## Quick start

Requires Node.js 20+. Uses Node built-ins and vanilla JavaScript with no runtime packages; npm install is unnecessary.

```sh
git clone https://github.com/dan40912/Mentor.git
cd Mentor
npm run demo
```

Open the printed URL, normally [127.0.0.1:4317](http://127.0.0.1:4317). **Each demo launch recreates `.demo-home/`**; never keep real work there. You can read fictional tasks, make sample decisions and inspect handoffs without an AI login. The demo does not automatically replace subsequent agent calls with fake CLI calls: executing AI work uses your logged-in account and quota.

For your own separate data directory:

```sh
npm start -- --home ~/mentor-data --port 4318
```

Without arguments, npm start uses this checkout’s `vault/` and `outputs/`. `MENTOR_HOME` and `PORT` are also supported. Stop with Ctrl+C. Use a different port and home when another Mentor service is running.

## Complete one task

1. Choose 新任務 and state the goal, allowed changes and restrictions.
2. Check the task card and follow-up questions. Correct any mismatch between your original request and the AI’s interpretation.
3. Choose 預覽計畫. Read the exact scope, work items, output location and acceptance conditions before approving that revision.
4. Execute, then read round cards and open the actual artifacts. Agent claims, machine checks and human acceptance remain separate.
5. Before switching agents, confirm the prior run stopped. Change the subsequent assignment or prepare a compact handoff containing the goal, human corrections, boundaries, revision, evidence and next action. Full history remains available through indexes.
6. Review the acceptance list yourself and keep untested items unverified. Save useful lessons for later tasks.

Real execution needs an installed, logged-in Codex, Claude Code or GitHub Copilot CLI. Model access, fees and limits depend on your account. Mentor supplies no model subscription and does not guarantee automatic quota switching. Reading and manual handoff remain possible without a CLI.

## Work in Obsidian

```sh
npm run package:obsidian
```

Open `dist/mentor-obsidian` as a **separate demonstration Vault** in Obsidian desktop. Select the Mentor theme, review and enable the plugin yourself, then pair using the Web app’s 連接 Obsidian action. Only `http://127.0.0.1:port` is supported. Credentials stay in memory and must be paired again after restart.

- Original light/dark document, table, Properties and Callout styles.
- A home note and eight Markdown templates, without Dataview or Templater.
- Preview a note or selection before sending it to AI. Oversized input is rejected, not silently truncated.
- Preview an index for the current folder, edit and regenerate the preview, then apply selected operations. Writes stay within `Mentor 整理/`; source notes are not moved. This is a filename index, not an AI summary.
- Inspect organization history, retry partial failures and undo unchanged results. Later human edits remain intact as conflicts. Interrupted operations require explicit reconciliation before retrying.

Markdown remains readable when the theme or plugin is disabled. The packager does not install into a real Vault; dist is rebuildable output. Back up before upgrading and replace main.js, organization.js, manifest.json and styles.css together. [Setup, recovery and limitations](docs/obsidian-work-center.md) (Traditional Chinese).

## Data, permissions and privacy

- Tasks live in `MENTOR_HOME/vault`, artifacts in `MENTOR_HOME/outputs`; settings and diaries are local too. Back up the whole home and your Obsidian Vault separately.
- Keep human notes outside the generated awc:begin / awc:end block. Do not manually change serialized task state.
- Selected sources and prompts go to the configured AI service through its CLI. Local storage does not mean offline inference. Saved work history may contain source material.
- Organization journals contain before/after content and follow your Vault’s sync and backup settings. Never commit private notes, credentials or real execution records.
- Loopback, Host/Origin, session and CSRF protections remain. The plugin uses a limited pairing bridge; revocation does not stop already-running work.
- Codex uses its CLI sandbox. Claude and Copilot rely mainly on tool allowlists and working directories; Mentor adds no OS sandbox. Isolation is not equivalent across providers.
- DONE, exit code zero, self-review and file existence do not constitute human acceptance. Check unknown results after restart before continuing.

See [SECURITY.md](SECURITY.md).

## Measurement and testing

Round cards expose prompt/response character and UTF-8 byte counts. Successful Codex/Claude calls can also save allowlisted CLI-reported token counters and locally measured elapsed time. Missing counters remain unknown. Claude cost is a client estimate, not your bill; no Codex price is inferred. Provider cache/input definitions differ, so the fields are not interchangeable. Older turns and failed calls may lack telemetry. Compact handoffs retain necessary constraints even beyond the recommended 8,000 characters. Smaller text alone proves no token savings.

```sh
npm test
npm run measure:handoff -- /absolute/MENTOR_HOME/vault/TASK-id.md
```

Normal tests use fictional fixtures and fake CLIs without spending model quota. [CI](.github/workflows/ci.yml) defines Linux/macOS/Windows with Node 20/22/24; a passing matrix does not verify live providers or Obsidian desktop.

Optional real-provider smoke test:

```sh
node scripts/live-cross-ai.mjs --run
```

This consumes logged-in Codex and Claude quota, creates an isolated fictional CSS task in .lab-home, and saves evidence. It never accepts work on your behalf or proves Obsidian visual quality. See the [evidence tracker](docs/implementation/mentor-obsidian-status.md).

## Troubleshooting and current limits

| Problem | Action |
| --- | --- |
| Port in use | Set --port and pair with that same address |
| CLI missing, logged out or model unavailable | Check the CLI/account in a terminal; select an available model under More tools |
| Pairing expired | Check the local service and pair again; never paste credentials into notes |
| Stale plan or undo conflict | Preview again and inspect current files; preserve newer edits |
| Uncertain result after stopping | Inspect artifacts and history before restarting work |
| Removing the integration | Disable plugin/theme, revoke pairing and back up notes/journals before removing plugin files |

Still pending: correction impact analysis, additional organization flows, reliable before/after token benchmarks, human onboarding tests, desktop reading/Live Preview, full upgrade recovery and cross-platform live CLI acceptance. Windows .cmd CLIs have path/argument restrictions; automated CI is not a real Windows CLI session. English UI and automatic quota switching are not complete features.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [design intent](docs/design-intent.md) and [architecture](docs/architecture.md). Core code is in src, Web in web, the plugin in obsidian/mentor-work-center and the theme in themes/Mentor.

Keep zero runtime dependencies, argv/stdin CLI invocation, revision checks and path protections. Add fictional regression cases and run npm test. Include screenshots for UI changes and describe scope, tests, unverified items and recovery in your PR. Do not merge your own contribution on behalf of the maintainer.

[Redesign prompt](prompts/mentor-obsidian-redesign-prompt.md) · [Workflow prompt](prompts/mentor-obsidian-workflow-optimization-prompt.md) · [Tutorial](docs/tutorials/01-first-task.md) · [MIT license](LICENSE)
