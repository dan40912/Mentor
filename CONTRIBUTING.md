# Contributing to Mentor

Thanks for helping. Mentor is small on purpose, so a few ground rules keep it that way.

## Ground rules

- **Zero runtime dependencies.** Use Node built-ins and vanilla JS. If you think a dependency is justified, open an issue first.
- **Never add a "bypass permissions" flag** to any CLI call, and never route CLI calls through a shell. Use `argv` and `stdin`.
- **No real data in tests or examples.** Fixtures must be fictional. Tests use `tests/fixtures/fake-cli.mjs` so they never spend quota.
- **The human decides.** Features that let an AI pick a default for the user, or mark work as accepted, will not be merged.

## Setup

```sh
git clone https://github.com/OWNER/mentor.git
cd mentor
npm test          # Node.js 22+
npm run demo      # fictional data, http://127.0.0.1:4317
```

## Layout

| Path | What |
|---|---|
| `src/` | Server, task store, coach, agents, memory |
| `web/` | Single-page UI (`index.html`, `assets/`) |
| `tests/` | `node:test` suites and fixtures |
| `docs/` | Design notes and tutorials |
| `examples/` | Sample task file |
| `scripts/` | Dev helpers (`demo.mjs`) |

User data lives in `vault/` and `outputs/` (or `$MENTOR_HOME`) and is git-ignored.

## Pull requests

1. Keep a PR to one change. Add or update tests.
2. Run `npm test` before pushing. CI runs Node 22 and 24 on Linux and macOS.
3. Describe what changed and why. Screenshots for UI changes.

## Most wanted

- English UI (i18n for `web/` and the prompts in `src/coach.js`)
- Importers for Codex and Claude Code session logs
- Auto handoff when a provider reports a quota error
