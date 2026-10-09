# Architecture

Plain Node.js (ES modules) and a single-page vanilla JS front end. No build step.

```
src/
  server.js         HTTP server, routing, session cookie, CSRF, Host/Origin checks
  tasks.js          Task store: parse/serialize Markdown, revisions, decisions,
                    checks, handoff brief, report parsing
  coach.js          The A–F flow: prompts, runs, diary, learning, recovery on restart
  agents.js         Spawns Codex / Claude Code / Copilot CLIs via argv + stdin
  models.js         Providers, models, reasoning effort, stage defaults, profiles
  memory.js         Team and project rules, recall cards
  sensors.js        Deterministic checks run after an AI writes output
  conversations.js  Parse and display conversation history
  projects.js       Editable project briefs
  trash.js          Soft delete with restore
web/                index.html + assets (no framework)
tests/              node:test suites; fixtures/fake-cli.mjs stands in for the CLIs
scripts/demo.mjs    Seeds fictional data and starts the server
```

## Data layout

All user data lives under `$MENTOR_HOME` (default: the repo root) and is git-ignored.

```
vault/
  TASK-<id>.md          Task source of truth (Markdown + a JSON state block)
  events/<id>.jsonl     Append-only audit log of your answers and feedback
  memory/               team.md and projects/<name>.md rules
  conversations/        Imported or recorded history
  projects/<name>/      Project briefs
  trash/                Soft-deleted records
outputs/<task-id>/      The only folder a task's AI may write to
.settings.json          Stage → provider/model assignment
.diagnosis.json         Last "is this CLI usable" result
```

A task file has a human-readable part plus a generated block between `awc:begin` and `awc:end`. The server only rewrites the generated block. Anything you write outside it is preserved. If you edit the state directly, the server treats it as a new revision and rejects stale clicks with `409`.

## The A–F flow

| Stage | Name | AI access |
|---|---|---|
| A | Task card | chat only |
| B | Grill me | chat only |
| C | Outline | read-only |
| D | Execute | write in the output folder |
| E | Review | read-only |
| F | Revise | write in the output folder (defaults to D's provider) |

Each stage is assigned a provider and model in "Roles and settings". Changing the assignment affects the next run, never one in flight.

## Request safety

- Listens on `127.0.0.1` only. `Host` and `Origin` must match.
- Mutations need the session cookie, a CSRF token and an `Idempotency-Key`. A key reused for a different operation is rejected.
- Previews are registered per task, path-checked and symlink-checked, with a size and type allow-list.

## Testing

`npm test` runs everything with the built-in test runner. `tests/fixtures/fake-cli.mjs` simulates the CLIs (including login and quota failures), so tests never spend quota or need a login.
