# 一次做完全部階段（無人值守版）

你是外部貢獻者，負責實作 [dan40912/Mentor](https://github.com/dan40912/Mentor) 的「對話主介面與多代理工作台」改版。維護者會離開一段時間，**中途不會回覆任何問題**。請依序完成階段 0 到 7，全部做完後只輸出一次「總交付回報」，維護者會把它交給驗收者（Claude）逐階段核對。

## 取得規格

```sh
git clone https://github.com/dan40912/Mentor.git
cd Mentor
git fetch origin
```

規格在 `prompts/mentor-chat-harness-prompt.md` 與 `prompts/harness-phases/phase-0-baseline.md` ～ `phase-7-onboarding.md`。若 `main` 尚無這些檔案（PR 未合併），改從分支取得：

```sh
git fetch origin claude/zen-feynman-l7nkx5
git checkout origin/claude/zen-feynman-l7nkx5 -- prompts/
git restore --staged prompts/
```

（取得後不要把 `prompts/` 的變動提交進你的分支。）

開始前完整讀過總規格與八份階段 Prompt。每個階段 Prompt 裡的「共同規則」「任務」「驗收清單」全部適用；本文件只補充無人值守時的做法，衝突時以本文件的流程規則為準。

## 分支與 PR：堆疊式

維護者不在，不會有人合併 PR，所以每個階段接在前一階段上：

| 階段 | 分支 | 基底 | Draft PR 目標 |
| --- | --- | --- | --- |
| 0 | `codex/harness-phase-0` | `main` | `main` |
| 1 | `codex/harness-phase-1` | `codex/harness-phase-0` | `codex/harness-phase-0` |
| 2 | `codex/harness-phase-2` | `codex/harness-phase-1` | `codex/harness-phase-1` |
| 3～7 | 依此類推 | 前一階段分支 | 前一階段分支 |

- 每個階段都要推送分支並開 Draft PR，PR 說明使用該階段的「交付回報」內容。**不要 merge 任何 PR**。
- 已推送的階段之後若需修正，在該階段分支上加新 commit 並將後續分支 rebase 或 merge 上去；不要 force-push 改寫已推送的歷史，除非是 rebase 堆疊所必需，且在回報中說明。
- 如果無法開 PR（權限或工具限制），仍推送分支，並在回報中寫明「未開 PR」與原因。

## 每個階段的流程

1. 讀該階段 Prompt，從前一階段分支切出新分支。
2. 實作。只做本階段範圍；範圍外的發現記到「建議後續」。
3. 自我驗收：
   - `npm test` 必須全部通過，測試總數不少於前一階段。
   - 逐條核對驗收清單，每條標示「完成／未完成 + 原因」。
   - 有 UI 變更時，用 Playwright 開 `npm run demo` 檢查 320／390／1360 px，截圖存到 `docs/verification/harness-phase-N/`（只能用虛構資料）。
4. 推送、開 Draft PR，記下該階段的交付回報內容。
5. 進入下一階段。

## 何時停下來

以下情況**停止在目前階段，不要繼續做下一階段**，直接輸出總交付回報，並說明卡在哪裡：

- `npm test` 無法全部通過，且嘗試修正後仍失敗。
- 要完成本階段必須違反共同規則（新增 runtime 依賴、放寬或刪除測試、弱化安全檢查、放寬 AI 寫入範圍）。
- 規格有實質衝突或不明確，任何一種選擇都可能讓後續階段大量重做。

以下情況**不需要停**，記錄後繼續：

- 單一驗收條目做不到，但不影響後續階段（標示未完成與原因）。
- 需要真人或真實環境才能驗證的項目，例如階段 7 的真實 AI 冒煙測試或 Obsidian 桌面實機。標示「未執行」與原因，**不得用 fake CLI 結果代替，也不得寫成已驗證**。
- 小的設計判斷：選一個最保守、最符合規格原則的做法，並在回報中列出你的決定與理由。

## 誠實要求

- 回報內容必須與實際的分支、commit、測試輸出一致；驗收者會自己抓分支重跑。
- 沒有做、沒有測、沒有通過的事，就寫沒有。不要用「應該可以」「理論上」代替測試結果。

## 總交付回報（全部結束或停下時，原樣輸出並填寫）

```text
【Mentor 對話工作台 總交付回報】
完成到第幾階段：
是否中途停止（是 / 否）；若是，停在哪一階段、原因：
最終 head 分支與 commit：

=== 階段 0 ===
分支 / base / head commit：
Draft PR 連結（或「未開 PR」+ 原因）：
npm test（Node 版本 / pass / fail）：
CI 狀態：
主要變更：
驗收清單逐條自評：
修改過的測試斷言（無則寫「無」）：
截圖路徑（有 UI 變更時）：
已知限制：

=== 階段 1 ===
（同上欄位，並加上該階段 Prompt「交付回報」中的專屬欄位）

...（每個已完成或嘗試過的階段都要有一段）

=== 跨階段 ===
自行做的設計判斷與理由：
需要真人或實機驗證、尚未執行的項目：
建議後續（範圍外發現）：
```
