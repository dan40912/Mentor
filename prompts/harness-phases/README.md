# Mentor 對話工作台：分階段實作 Prompt

完整規格：[`../mentor-chat-harness-prompt.md`](../mentor-chat-harness-prompt.md)。這個資料夾把規格切成八個可以各自交付、各自驗收的階段。

## 怎麼使用

1. 依序把一份階段 Prompt 整份貼給實作的 AI（例如 GPT／Codex）。
2. 實作 AI 完成後，會推送分支、開 Draft PR，並輸出一段「交付回報」。
3. 把那段交付回報貼給驗收的 AI（Claude）。Claude 會抓分支、跑測試、讀 diff，對照該階段的驗收清單，回覆「通過」或「退回 + 具體修改清單」。
4. 退回時，把修改清單貼回給實作 AI，在同一分支修正，重複第 3 步。
5. 通過並由你合併 PR 後，再開始下一階段。

## 階段

| 階段 | 檔案 | 內容 | 依賴 |
| --- | --- | --- | --- |
| 0 | [phase-0-baseline.md](phase-0-baseline.md) | 修好 11 個失敗測試，CI 回到綠燈 | 無 |
| 1 | [phase-1-chat-layout.md](phase-1-chat-layout.md) | 對話成為主畫面、介面白話化 | 0 |
| 2 | [phase-2-intent-proposal.md](phase-2-intent-proposal.md) | 意圖判斷與工作提案卡 | 1 |
| 3 | [phase-3-multi-agent-engine.md](phase-3-multi-agent-engine.md) | 後端多代理並行執行 | 0（可與 1、2 並行開發） |
| 4 | [phase-4-agent-panel.md](phase-4-agent-panel.md) | 「工作中」面板與換 AI 接手 | 2、3 |
| 5 | [phase-5-learning-note.md](phase-5-learning-note.md) | 專案學習筆記 MD | 3 |
| 6 | [phase-6-output-preview.md](phase-6-output-preview.md) | 簡報逐頁預覽、出處、判斷決策卡、下載 | 4 |
| 7 | [phase-7-onboarding.md](phase-7-onboarding.md) | 首次上手引導、白話錯誤、真實冒煙測試 | 6 |

## 給驗收者（Claude）的流程

收到交付回報後：

1. `git fetch origin <分支>`，確認 head commit 與回報一致。
2. 在乾淨的 worktree 跑 `npm test`，記錄 pass／fail。
3. 讀 `git diff <base>...<head>`，逐條核對該階段 Prompt 的「驗收清單」。
4. 檢查是否違反共同限制：新增依賴、放寬或刪除測試、弱化安全檢查、提交使用者資料。
5. 需要時用 Playwright 開啟 `npm run demo` 檢查 320／390／1360 px。
6. 回覆：通過，或退回並附「可直接貼給實作 AI 的修改清單」。
