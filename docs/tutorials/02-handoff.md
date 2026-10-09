# Tutorial 2: hand one task across two AIs

Goal: one AI stops, another continues, and you do not re-explain anything.

## 1. Get the brief

With a task open, use **複製接手包** (copy brief) in the "交接中心" page, or fetch it from the API (you need the session cookie, so the UI is easier):

```
GET /api/tasks/<TASK-ID>/brief?for=codex     # or claude, copilot
```

The brief is under 8,000 characters. It contains the boundaries, confirmed decisions, open decisions, agreed numbers, the checklist and the report format. It does **not** contain chat history.

## 2. Give it to the next AI

Paste the brief into the other agent, or assign that provider to a stage in "角色與設定" so Mentor runs it for you with the CLI you are logged in to.

## 3. Take the report back

The AI ends its reply with a report:

```
TASK_ID: TASK-...
BASE_REVISION: 3
STATUS: DONE | BLOCKED | NEEDS_INPUT
ARTIFACT: /absolute/path/to/new-file.md   (omit if there is no new file)
完成事項: ...
證據: ... (file names, page numbers, screenshots, command output)
未完成: ...
下一步: ...
```

Paste it into the workbench. The server checks:

- `BASE_REVISION` matches the current revision, otherwise the report is rejected. Someone changed the task meanwhile.
- `DONE` has evidence ("證據"). "Looks fine" does not count.
- A new `ARTIFACT` rebinds the automatic check to the new file. The old one is kept.

`DONE` moves the task to "waiting for your review". It never completes the task by itself.

## What is not automatic yet

Switching providers when a quota runs out is still a manual step. It is on the [roadmap](../../README.md#roadmap).
