# Changelog

## 0.1.0 (unreleased)

First public version.

- Task file as source of truth, with revisions, decisions, evidence checks and a handoff brief
- A–F coached flow through Codex, Claude Code and Copilot CLIs
- Kanban home page that ranks one action for the human
- Learning diary, kept rules and spaced recall
- Trash with restore, project briefs
- `npm run demo` with fictional data
- Feedback forms: 1–5 ratings and tags when you confirm a result, when autopilot stops, and when a task is done; the summary becomes directions in the next task's prompts
- `scripts/lab.mjs` and `examples/lab/`: run example tasks end to end with the real CLIs and count every human touch point
- Review sees the executor's report (marked as a claim, not evidence) and only judges its own item; outlines no longer turn process steps into acceptance criteria
- Autopilot stops show the executor's own reason, separate "missing information" from "the tool can't do this", and count repeated stops
- Stopping the server also stops the CLIs it started
- Review runs in a disposable copy of the outputs, so it can run build and test commands without touching the real files
- Full autopilot lets AI-reviewed items unlock the next ones; you confirm everything once at the end
