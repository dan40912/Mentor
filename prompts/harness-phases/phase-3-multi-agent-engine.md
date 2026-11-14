# 階段 3：後端多代理並行執行

## 共同規則（每階段相同）

- Repo：[dan40912/Mentor](https://github.com/dan40912/Mentor)。先 `git fetch origin`，以 `main` 為基底；若前一階段 PR 尚未合併，改以前一階段分支為基底，並在 PR 說明註明。
- 完整產品規格：`prompts/mentor-chat-harness-prompt.md`。若 `main` 沒有這個檔案，執行 `git fetch origin claude/zen-feynman-l7nkx5 && git show origin/claude/zen-feynman-l7nkx5:prompts/mentor-chat-harness-prompt.md` 取得。先讀完再動工。
- 限制：零 runtime 依賴、Node 20+、原生 JS、無 build 步驟；測試用 `node:test` 與 `tests/fixtures/fake-cli.mjs`，不得呼叫真實 AI；保留 127.0.0.1、Host／Origin、session、CSRF、Idempotency-Key 與預覽路徑檢查；不得提交 `vault/`、`outputs/`、設定或真實執行紀錄。
- **只做本階段範圍。** 發現範圍外的問題，寫進回報的「建議後續」，不要順手改。
- 不得以跳過、刪除、放寬斷言或改測試期望來讓測試通過，除非能證明原測試期望本身錯誤，並在回報中逐條說明。
- 完成後：推送分支，向 `main` 開 **Draft PR**，不要 merge。最後輸出下方「交付回報」，使用者會把它交給驗收者（Claude）檢查。驗收者會自己抓分支、跑測試、讀 diff，回報內容必須與實際一致。

## 背景

目前每個任務同時只能有一個執行中的代理：`src/coach.js` 用單一的 `planning.running` 物件記錄，工作項目（`planning.workItems`，含 `dependsOn`）逐一執行。停止時寫入 `planning.stopped`；重啟後未完成的執行標示為「未知」，不自動重跑。

本階段把執行引擎改為**一個任務可以有多個代理依相依關係並行**。只做後端與 API，介面在階段 4。

## 任務

### 1. 資料模型

- 新增 `planning.runs[]`，每筆至少包含：`id`、`workItemId`、`role`（白話角色，例如「資料整理」）、`purpose`（一句話用途）、`provider`、`modelId`、`effort`、`status`（`queued`／`running`／`waiting_human`／`done`／`failed`／`stopped`／`unknown`）、`startedAt`、`endedAt`、`step`（代理回報或依階段推得的白話目前動作，不得編造進度百分比）、`outputDir`、`turnId`、`error`（白話與原始資訊分開）。
- 舊任務檔（只有 `planning.running`）必須可讀、可繼續執行；寫入時可遷移為新格式，但遷移需有測試且不得遺失資料。
- 既有讀取 `planning.running` 的地方（首頁「現在」、看板、工作卡、交接摘要、停止 API）改為讀 `runs[]` 或提供相容的推導值，行為不退步。

### 2. 排程與並行

- 依 `dependsOn` 決定可執行的工作項目；沒有相依或相依已完成的項目可同時啟動。
- 並行上限可設定（存在 `.settings.json`，預設 2），超出者 `queued`。
- 每個工作項目寫入獨立子資料夾 `outputs/<task-id>/<workItemId>/`，代理的寫入範圍限制在該子資料夾（沿用各 provider 既有的 cwd／sandbox／allowlist 機制）。需要整合多個項目的工作項目只能讀取其相依項目的資料夾，並在 prompt 中明列來源。
- revision 與 409 機制在並行下仍正確：多個代理完成時的寫回需序列化，不得互相覆蓋任務檔；以測試證明。
- 已核准計畫與「人工驗收」規則不變：代理完成只會到「完成待你看」，不會自動變為已確認。

### 3. 停止、失敗與復原

- 可以停止單一 run；停止或失敗不影響其他 run，但相依於它的項目保持 `queued` 並標示等待原因。
- 一個 run 因額度、登入或逾時失敗時，記錄白話原因，並提供 API：以指定的其他 AI 重新執行該工作項目（使用既有 `compact-handoff.js` 產生接手內容，不重講全部背景）。
- 重啟後所有 `running` 改為 `unknown`，不自動重跑；需使用者確認後才可重新執行。
- 修改已完成項目時沿用 `src/work-item-impact.js` 的下游失效邏輯。

### 4. API

- 查詢任務所有 runs 的唯讀 API（供階段 4 輪詢，回應要小、可頻繁呼叫）。
- 停止單一 run、以其他 AI 重跑單一工作項目的 API，套用 session、CSRF、Idempotency-Key。

## 驗收清單（驗收者會逐條檢查）

- [ ] `npm test` 全部通過，測試數不少於基線。
- [ ] fake CLI 測試：兩個無相依項目同時執行（以時間重疊或 spawn 紀錄證明），第三個相依項目等前兩者完成才開始。
- [ ] 並行上限生效；超出者為 `queued`。
- [ ] 兩個代理寫入不同子資料夾，互不覆蓋；任務檔在並行寫回下不遺失任何一方的結果。
- [ ] 停止一個 run 不影響另一個；失敗的 run 可用另一個 AI 重跑，且接手 prompt 來自交接摘要。
- [ ] 重啟後 `running` → `unknown`，不自動重跑。
- [ ] 舊格式任務檔（只有 `planning.running`）讀取、繼續、遷移的測試。
- [ ] 既有功能不退步：首頁、看板、工作卡、交接摘要、停止、409 相關測試全部通過。
- [ ] 沒有放寬任何 provider 的寫入權限；回報中說明每個 provider 如何被限制在子資料夾。

## 交付回報（完成後原樣輸出並填寫）

```text
【Mentor 階段 3 交付回報】
分支：
base commit：
head commit：
Draft PR 連結：
npm test（Node 版本 / pass / fail）：
CI 狀態：
runs[] 欄位定義：
舊格式相容與遷移方式：
並行寫回如何序列化：
各 provider 寫入範圍限制方式：
新增 API（路徑 / 方法 / 用途）：
驗收清單逐條自評（完成 / 未完成 + 原因）：
已知限制：
建議後續（範圍外發現）：
```
