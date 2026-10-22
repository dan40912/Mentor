# Tutorial 2: continue a task with another AI

The goal is to preserve the current objective, decisions, evidence and next action. A handoff is not proof that the work passed review, and it must not resume a second writer while the first writer's state is unknown.

## Prepare the current version

In the Web task, use **準備精簡接手包**. In the native Obsidian task, use **準備接手包**, review it and save a versioned copy. These views use the same task state. The authenticated Web API is:

```text
GET /api/tasks/<TASK-ID>/handoff-summary
```

The summary preserves boundaries, human corrections, confirmed decisions, registered artifacts, checks and next action. Full prompts and responses remain available on demand. Recent discussion is marked as unapproved: a question or suggestion does not grant permission to change or cancel work.

8,000 characters is a recommendation, not a reason to cut necessary constraints. Character counts are not measured model tokens or cost. The benchmark currently has mixed results; repeatable token savings have not been demonstrated.

The older **交接中心** brief is a separate entry:

```text
GET /api/tasks/<TASK-ID>/brief?for=codex
```

That entry rejects required content above its 8,000-character limit and can omit optional lessons/source locators with an explicit notice. Provide the task file when more detail is needed. Do not confuse it with the non-truncating summary.

## Give the next AI what it can actually read

Check TASK_ID and BASE_REVISION first. Confirm the earlier execution has stopped; unknown results require reconciliation, not an assumed failure and duplicate run.

Provide the summary and necessary files to the other AI, or select a provider for a supported stage through Mentor. Local paths and authenticated API URLs do not become accessible merely because the other AI received their names. If it lacks access, provide the relevant source/version explicitly rather than assuming it read the whole Vault. Real CLI execution requires an installed, logged-in client and can spend quota.

## Read the result and verify it

The legacy report format is:

```text
TASK_ID: TASK-...
BASE_REVISION: 3
STATUS: DONE | BLOCKED | NEEDS_INPUT
ARTIFACT: /absolute/path/to/new-file.md
完成事項: ...
證據: ...
未完成: ...
下一步: ...
```

Omit ARTIFACT when there is no new file. Mentor rejects stale revisions and checks registered artifact versions; DONE still requires evidence and human review. For coached tasks, the same distinction applies to per-item AI review and explicit human acceptance.

A failed or superseded review is not a current PASS. Read the latest task state and the reason for rechecking rather than treating an older successful round as acceptance.

## Record whether the handoff helped

Let another AI continue one small task using the handoff instead of the whole chat. Record the files, version and remaining task it received, what it actually changed, checks performed, and anything you had to explain again. A self-reported DONE or small summary size is not an onboarding or quality result.

Automatic quota switching is not a completed feature; see [current limits](../../README.md#troubleshooting-and-current-limits). For the native table-reading and human-comprehension exercise, open **實機測試：表格與工作回合** in the generated demonstration Vault. Native desktop and human acceptance remain pending.
