# Tutorial 1: inspect the work loop without an AI login

This walkthrough uses fictional demo data. It lets you inspect a decision, its saved task state and review controls. It does not demonstrate a newly generated AI artifact or prove human usability.

## 1. Start safely

```sh
npm run demo
```

Open the URL printed in the terminal (normally http://127.0.0.1:4317). Each launch resets .demo-home, so never store real work there. If another service uses that port, stop the demo and choose an unused PORT through your shell, or use a separate home with npm start -- --home <directory> --port <port>.

The initial Web page has three primary entries: 現在, 任務 and 成果與知識. Now shows three fictional tasks and recommends the active-user definition decision. No AI login is needed for these sample tasks. Starting a new AI operation still requires a logged-in CLI and can spend quota; demo does not automatically fake those calls.

## 2. Make a sample decision

On Now, choose 決定並繼續. In Q3 營運報告, read the recommendation, rationale, unknown and the cost of each option. Neither option is selected for you.

Choose 30 日活躍 for this fictional exercise, add a note identifying it as a demo decision, then submit 決定並繼續 inside the task dialog. The decision card disappears and Mentor reports that the answer was saved. The next human action changes to an acceptance check. This is a saved choice, not evidence that an AI produced a new report.

## 3. Inspect what was saved

Open .demo-home/vault/TASK-demo-0001.md in an editor or Obsidian. Look for the decided option and your note. Expand 任務資料與儲存位置 in the task dialog to inspect the current revision and location.

Add your own note outside the generated awc:begin / awc:end block, then refresh the task. Do not modify serialized generated state. Human notes outside that block are preserved by task updates; the automatic test suite covers that contract.

## 4. Inspect review without claiming acceptance

The task has separate machine and human checks. 執行檢查 verifies the registered artifact baseline. 通過 or 不通過 records human judgment and evidence; a file hash alone cannot verify whether numbers and sources are correct.

The sample report is a placeholder, so leave substantive checks unverified unless you actually have evidence. Do not claim that this walkthrough validates the report. Open 任務 to find the sample onboarding task; inspect its acceptance conditions and use the same distinction there.

## 5. Continue with a real task

Choose 新任務, state your goal and restrictions, and use an installed, logged-in CLI. Check the AI interpretation, preview the plan, execute, inspect artifacts and accept only what you verified. For the optional native route, follow [Obsidian setup](../obsidian-work-center.md); desktop behavior remains pending acceptance.

[Tutorial 2: handoffs](02-handoff.md) · [Current verification scope](../implementation/mentor-obsidian-status.md)
