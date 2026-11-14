# 階段 0：恢復測試基線

## 共同規則（每階段相同）

- Repo：[dan40912/Mentor](https://github.com/dan40912/Mentor)。先 `git fetch origin`，以 `main` 為基底；若前一階段 PR 尚未合併，改以前一階段分支為基底，並在 PR 說明註明。
- 完整產品規格：`prompts/mentor-chat-harness-prompt.md`。若 `main` 沒有這個檔案，執行 `git fetch origin claude/zen-feynman-l7nkx5 && git show origin/claude/zen-feynman-l7nkx5:prompts/mentor-chat-harness-prompt.md` 取得。先讀完再動工。
- 限制：零 runtime 依賴、Node 20+、原生 JS、無 build 步驟；測試用 `node:test` 與 `tests/fixtures/fake-cli.mjs`，不得呼叫真實 AI；保留 127.0.0.1、Host／Origin、session、CSRF、Idempotency-Key 與預覽路徑檢查；不得提交 `vault/`、`outputs/`、設定或真實執行紀錄。
- **只做本階段範圍。** 發現範圍外的問題，寫進回報的「建議後續」，不要順手改。
- 不得以跳過、刪除、放寬斷言或改測試期望來讓測試通過，除非能證明原測試期望本身錯誤，並在回報中逐條說明。
- 完成後：推送分支，向 `main` 開 **Draft PR**，不要 merge。最後輸出下方「交付回報」，使用者會把它交給驗收者（Claude）檢查。驗收者會自己抓分支、跑測試、讀 diff，回報內容必須與實際一致。

## 背景

commit `1dbb0d1`（Add Mentor workspace chat and improve workbench UX）大幅修改 `web/index.html`，在 Node 22 上 `npm test` 為 340 pass／11 fail；前一個 commit 為 350 pass／0 fail。失敗集中在 UI 測試使用的假 DOM 或 UI 程式碼抽取方式沒有跟上：

| 失敗訊息 | 測試數 | 相關測試（以 `npm test` 輸出為準） |
| --- | --- | --- |
| `busy is not defined` | 6 | 展開／收合同步、openTask／openPreview 沿用展開、localStorage 失敗仍可操作 ×3、非法儲存值與尺寸規格（多半在 `tests/ui-fullscreen-*.test.js`） |
| `Cannot set properties of undefined (setting 'onchange')` | 2 | 403 → session 刷新保留成果與 Git 改動清單、背景刷新期間延遲的成果仍完成載入 |
| `Cannot destructure property 'autopilot' of 'draftForm.elements'` | 3 | 新任務送出失敗與上傳重試、new task change／drop 真實 UI 送出 |

`busy()` 定義於 `web/index.html`（約第 942 行），新程式碼在被測試抽取的片段中使用了它，但測試只載入部分函式。

## 任務

1. 找出每個失敗的根本原因：是 UI 程式碼的回歸錯誤（真實使用者也會遇到），還是測試夾具沒有跟上合理的 UI 改動。
2. 屬於 UI 回歸就修 UI；屬於夾具過時就更新夾具（例如補上 `busy`、補上新表單欄位、補上新增的 DOM 元素），但不得降低測試想驗證的行為。
3. 確認 `1dbb0d1` 新增的功能（工作區聊天、Git 改動清單等）沒有因修正而失效。

## 驗收清單（驗收者會逐條檢查）

- [ ] 在 Node 22 乾淨 checkout 上 `npm test` 全部通過，總數不少於 350。
- [ ] 11 個原失敗測試的斷言沒有被刪除或放寬；若改了任何斷言，回報逐條說明理由。
- [ ] 每個失敗都在回報中分類為「UI 回歸」或「夾具過時」，並說明修法。
- [ ] 沒有改動與這 11 個失敗無關的產品行為。
- [ ] GitHub Actions 的 CI（三個 OS × Node 20／22／24）在 PR 最新 head 上結果已列在回報；若尚未跑完，標明「待確認」。

## 交付回報（完成後原樣輸出並填寫）

```text
【Mentor 階段 0 交付回報】
分支：
base commit：
head commit：
Draft PR 連結：
npm test（Node 版本 / pass / fail）：
CI 狀態：
失敗原因分類與修法：
  1.
  2.
  ...
修改過的測試斷言（無則寫「無」）：
驗收清單逐條自評（完成 / 未完成 + 原因）：
已知限制：
建議後續（範圍外發現）：
```
