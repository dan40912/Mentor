# Mentor × Obsidian 需求驗收盤點

歷史盤點基準：8e9f0f49e2c485fba21d047a12184753daedc2b6；2026-10-22。最新交付快照以 mentor-obsidian-status.md 的 2026-10-27 區塊為準，以下保留歷史證據。這是未完成項目的盤點，不是整體完成宣告。兩份 Prompt 互補，以下對照工作閉環版的 17 章及改版版的最低驗收條件；詳細子需求仍以原 Prompt 為準，不能用章節有實作就宣稱全部符合。

## 工作閉環版

| 章節 | 現況證據 | 驗收結論與缺口 |
| --- | --- | --- |
| 1 痛點 | native-reading-review.md、Web 操作證據 | 有具體問題與修正；真人理解未測 |
| 2 現況盤點 | mentor-obsidian-status.md、Git branch 與 PR | 已有持續盤點；公開 main 不等於功能分支 |
| 3 產品分工 | src/tasks.js、obsidian/mentor-work-center/main.js、README | 共用任務正本有實作；跨端完整桌面流程未驗收 |
| 4 每輪工作卡 | src/work-cards.js、artifact-history.js、相關 API/UI 測試 | 歷史理解、實際輸出、hash、副本與檢查分離；真人可讀性未測 |
| 5 問句與對齊 | task-discussion.js、instruction-preview.js、task-discussion.test.js | 問答不寫成果、不構成取消／執行授權；真實品質證據有限 |
| 6 預寫／預覽／一鍵套用 | content-drafts.js、organization.js、relocation.js | 草稿、來源 hash、精確方案、冪等、部分失敗與復原有測試；原生完整操作未測 |
| 7 整理閉環 | reference-coverage.js、relocation-operations.test.js | 支援語法內搬移與參照修正可復原；不支援語法與大 Vault 會阻擋，尚非所有資料的通用整理 |
| 8 多 AI 交接 | compact-handoff.js、handoffs.js、真實驗證 JSON | 循序交接、來源／版本索引存在；真實跨平台／provider 組合與正式成果全流程未驗收 |
| 9 三種閱讀方式 | 共用 work-cards 投影、Markdown 與接手摘要 | 有同源投影及按需索引；停止服務後外部 AI 必須取得實際檔案，API 不是公開連結 |
| 10 Mentor UI | Web 與原生側欄、UI 邏輯測試、Web 截圖 | 首頁與工作回合已調整；全鍵盤、所有寬度及真人新手測試不足 |
| 11 Theme／範本 | themes/Mentor、8 個 templates、工作首頁 example | 原創淺／深色與閱讀樣式有原始碼；Obsidian 閱讀／Live Preview、停用及移除的實機證據缺失 |
| 12 Token 效率 | benchmarks/handoff-2026-10-22、prompt-context-deduplication | 確定減少重複文字；真實 Token 趨勢相反，未證明可重複節省，不承諾比例 |
| 13 可信數據 | cli-usage.js、work-cards.js、用量測試 | 未知非零、估算有標記；非完整商業績效儀表板，未製造假數據 |
| 14 README | README.md、README.zh-TW.md、tutorials | 已改寫；最新套裝建置與 10 runtime 檔案比對通過，完整新手實機照做仍待驗收 |
| 15 分階段端到端 | status、verification、benchmark、示範實機步驟 | 各段有局部真實證據；指定表格任務的 Obsidian → AI → 另一 AI → 人驗收整條鏈未完成 |
| 16 真正完成標準 | 實機測試筆記的六個理解問題 | 沒有不熟專案使用者的實際回答，不能宣稱達標 |
| 17 交付 | PR #5/#6/#7/#8、原始碼、文件與截圖 | 已送審部分範圍；不自行 merge，整體仍未完成 |

## 改版版十個最低門檻

| 門檻 | 判定 |
| --- | --- |
| 新手不讀架構即可開始 | 缺真人證據 |
| 首頁指出人該做的下一步 | 有程式與虛構畫面；完整情境／真人未驗收 |
| Obsidian 完成核心流程 | 有插件與隔離測試；桌面端到端缺證據 |
| 新 AI 保留決策與來源 | 有索引、回歸及有限真實交接；尚非所有 provider／平台 |
| DONE 不自動人工驗收 | 狀態與測試支持；已補接受版本 hash 綁定（見本文續作）；D/F 外部編輯保護仍不足 |
| 額度／登入／中斷／未知非完成 | 分類與測試支持；不能推論所有 CLI 版本 |
| 同時編輯／舊回報／重啟不覆蓋或重複 | 精確方案、任務 revision、整理與重試有保護；D/F 直接寫成果仍有並發外部編輯風險，未完全達標 |
| 停用／移除保留筆記 | 實際檔案系統與打包測試支持；桌面實機缺證據 |
| Token 比較可重現且不漏資訊 | 有可重現文字／事實測試；尚未證明穩定模型 Token 改善 |
| README 符合交付版本 | 本機分支有核對；公開 main／未合併 PR 狀態不能混稱 |

## 本輪實際檢查

- 8e9f0f4 最新 CI 39741069136 已完成 success，九組平台／Node 測試通過。
- npm run package:obsidian 成功；npm run verify:obsidian -- --vault dist/mentor-obsidian 實際列出 9 matched 並印出 PASS runtime files match this checkout。這僅證明套裝 runtime 相符，不讀筆記或 data.json，不證明原生 UI 已驗收。
- src/coach.js 的 confirm／confirmAll 僅核對任務 revision 與 REVIEWED 狀態，沒有重新核對審閱過的磁碟成果 hash。reviewCopy 也沒有將人工接受綁定至副本內容。此為下一個必要修正，歷史保存不構成此修正的替代。

## 後續順序

1. 將 AI 審閱與單項／批次人工接受綁定到明確成果版本，修改或缺檔時要求重新審閱，舊資料缺版本不能當成證明。
2. 處理 D/F 與外部編輯並發時的內容保護；歷史副本僅提供追查，不可宣稱解決覆寫。
3. 完成指定表格任務的原生桌面與跨 AI／真人驗收，補全鍵盤、淺深色、閱讀／Live Preview 及升級移除證據。
4. 用可比較的模型環境量測品質與 Token；保留不利結果。若只能證明文字去重，就維持該範圍的結論。

沒有環境或真人回答的項目保持未驗證；本盤點不縮減原 Prompt，也不以更多測試數量替代缺失的證據。

## 2026-10-27 續作：審閱後成果版本

已補上 E 開始前／回覆時與單項／批次接受前的成果 hash 核對；舊審閱缺版本需重新檢查。新增五項隔離真實檔案測試：修改後拒絕單項及批次接受、重新審閱才可接受、舊紀錄／缺檔拒絕、審閱期間外部修改、審閱者修改副本不取得 PASS，以及批次全有或全無。這補足本盤點的接受版本缺口；外部程序仍可在核對後變更檔案，D/F 並發覆寫及未登記相依仍未解決。實機與真人項目沒有因此變成通過。


## 2026-10-27 並發覆寫重現

`node scripts/diagnose-output-concurrency.mjs` 以隔離虛構任務及模擬 runner 驗證，不呼叫模型。結果保存於 `docs/verification/output-concurrency-probe-2026-10-27.json`：執行器 cwd 為正式成果目錄，先寫入的「concurrent human edit」被後寫的「simulated agent output」覆蓋。任務最後 BLOCKED 並未復原人工內容。這是已重現的未修缺陷，不是通過防覆寫測試；腳本成功退出僅表示診斷跑完。

下一個必要修正是讓 D/F 在隔離副本產生成果，發布前核對完整來源基線並保留衝突，不允許執行器直接修改原成果。不得只加完成後 hash 檢查便宣稱防覆寫；那時人工資料可能已經遺失。修正需涵蓋新增／修改／刪除、部分發布與中斷，不能用此診斷取代修正。
