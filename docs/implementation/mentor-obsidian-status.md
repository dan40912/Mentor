# Mentor × Obsidian 改版追蹤

規格：`prompts/mentor-obsidian-redesign-prompt.md` 與 `prompts/mentor-obsidian-workflow-optimization-prompt.md`。完整目標不因第一批實作而縮小。本文件為開發狀態，不是驗收通過宣告。

## 工作基準

- Repo：dan40912/Mentor；基於既有 lab-zero-touch 的 commit `5b8c7e89eadf6e1a833651a695037b184109864b`。
- 分支：codex/mentor-obsidian-workflow。
- 獨立 worktree；原始 checkout 的 agents／coach／handoffs／server／web 修改，以及 Body-release、POC 與其他未追蹤檔均未覆蓋或帶入。
- 基線：npm test，276 pass／0 fail。

## 盤點結論

既有任務正本、revision、CLI 執行、教練階段、核准計畫、成果檢查與交接機制可以保留。缺口是：本輪狀態分散、完整交接混入過多歷史、原生 Obsidian 入口缺失、預覽沒有獨立內容識別、Theme／範本尚未形成正式套裝。

原始 Web 工作台仍有多入口與大量細節。本批先提供可核對資料與原生入口，不宣稱已解決全部複雜度。

## 需求／證據追蹤

| 需求 | 狀態 | 目前證據／下一步 |
| --- | --- | --- |
| 現況盤點與保護既有修改 | 已完成本批 | 獨立 worktree、基線測試 |
| 本輪工作卡、當時理解、結果與證據分層 | 已實作／自動測試 | work-cards.js、workflow-readability.test.js；已瀏覽器檢查 |
| 計畫預覽、內容與版本綁定 | 已實作／自動測試 | plan-preview.js、Coach.approveOutline；錯誤識別、過期與重複點擊測試 |
| 不靠完整聊天的接手摘要 | 已實作／自動測試 | compact-handoff.js；保留完整人的修正與邊界，歷史按需讀取 |
| 原生 Obsidian 側欄與命令 | 已實作，待實機 | main.js；關鍵行為隔離測試不代替 Obsidian 桌面驗收 |
| 本機配對、撤銷、有限權限 | 已實作／HTTP 測試 | obsidian-bridge.test.js；不放寬網站同源 |
| 從筆記預覽建立任務 | 已實作／隔離測試 | 來源變動拒絕、長文不截斷、重試建立冪等 |
| Theme、首頁與八個內容範本 | 已產生，待實機 | themes/Mentor、obsidian/templates；閱讀／Live Preview 待驗證 |
| 由一份狀態提供人／AI／稽核閱讀層 | 部分完成 | 工作卡與接手摘要已共用狀態；仍須進一步降低主畫面閱讀負擔 |
| 通用整理方案與批次預覽／復原 | 索引已實作／隔離測試；分類搬移待做 | organization.js；可編輯預覽、來源與目標版本、批次排除、部分重試、復原及中斷核對 |
| Mentor 資訊架構與 UI 簡化 | 已實作第一版／待完整操作驗收 | 現在／任務／成果與知識三入口，其餘工具展開；首頁近期工作與實際成果索引 |
| 自然語言修正與方向漂移處理 | 部分完成 | Web／原生修正預覽、版本內容綁定、相依成果重新驗收；追問／取消等意圖辨識尚未完成 |
| Token 效率與上下文去重 | 部分完成／穩定節省未證明 | 新增相同虛構任務的真實 CLI 成對基準與品質門檻；兩組趨勢相反，CLI 背景上下文仍待控制，不能宣稱省 Token |
| 數據呈現可信度 | 部分完成 | 字元／bytes／時間為本機量測，Token 為成功 CLI 回報；Claude 費用僅 CLI 估算，無跨版本節省承諾 |
| README 與完整教學 | 中英文重寫完成／真人與實機待驗 | 三入口、兩種模式、資料與限制、復原、量測、實際新截圖；入門教學校正為可驗證示範 |
| 真實多 AI 與停止／復原／驗收 | Codex D → Claude E 已實測；其餘待驗 | live-cross-ai.mjs，結構檢查通過、來源完整；真人與 Obsidian 視覺仍未驗收 |
| 真人閱讀與接手測試 | 未驗證 | 需真人；不得由 AI 自評替代 |
| GitHub PR、最新 head CI | 待完成後提交 | 不以本機綠燈代替遠端 CI 或維護者驗收 |

## 第一批驗證紀錄

- npm test：284 pass／0 fail；新增最後的成功標準保留檢查後，workflow-readability 的 3 項也再次通過。
- 插件隔離測試：不把憑證存入 data.json、不連遠端主機、預覽不執行、來源變動拒絕、重試保持建立識別、過長原文不截斷。
- 瀏覽器測試：正式 Web 的工作卡與計畫預覽可讀；fake CLI 故意回傳與原始 Obsidian 要求不相符的簡報，預覽能對照偏差，退回修改而沒有批准錯誤方向。這不是原生 Theme 或真實 AI 品質測試。
- 同一份虛構任務 revision 7：完整交接 7,494 字元／9,824 bytes，摘要 1,701 字元／2,883 bytes。只是格式大小比較，Token 與費用皆未量測，品質需另驗。
- 輸出套裝：npm run package:obsidian；不啟用插件、不修改正式 Vault。

## 下一批順序

1. 完成插件 HTTP/UI 整合測試與 Theme 實機驗收條件，修正發現的缺口。
2. 將「現在／任務／成果與知識」落實為更少決策負擔的 UI，詳細歷史與設定按需展開。
3. 實作可預覽的一般整理方案，先做索引／知識整理，再評估搬移；加入過期、部分成功與復原測試。
4. 真實 CLI 與跨 AI 接力、Prompt 去重與可重現使用量基準。
5. 更新 README、教學、截圖、相容性矩陣，跑完整檢查後提交 PR；缺少實機或真人證據時保持 Draft 並明示。

## 第二批驗證紀錄

- Web 已改為三個主要入口，保留更多工具；首頁顯示近期工作，成果入口使用實際登記成果。計畫下一步直接開啟預覽；收起任務後只將鍵盤焦點交給可見控制項。
- 原生插件新增索引草稿、修改後重新預覽、選項排除、套用、歷史與復原。來源不搬移；僅寫入 Mentor 整理。未知執行或未知復原必須先確認停止並核對，不盲目重跑。檔名中的 #／? 會正確編碼。
- 自動測試：完整回歸 290 pass／0 fail；瀏覽器另發現自動流程的次要入口需共用預覽，修正後再次回歸。
- 真實 CLI：2026-10-21，Codex 執行 D、Claude Code 審閱 E，虛構表格 CSS 任務達 REVIEWED，來源 fixtures 未變更。機器執行 node verify.cjs 通過；審閱者無 shell，讀檔及引用機器紀錄，不能稱第二次獨立執行。原始證據留在被 gitignore 的 .lab-home/live-cross-ai-0c87cf5d/evidence.json，不提交真實模型原始紀錄。
- 真實回合輸入分別 3,340／4,152 字元，輸出 1,232／2,760 字元；Token 與費用未取得。這不是改版前後效率比較。
- 重現命令：node scripts/live-cross-ai.mjs --run。會呼叫已登入的真實 CLI 並使用帳號額度；一般 npm test 不會呼叫。人仍須進行成果驗收與 Obsidian 視覺測試。
- 套裝重新產生成功，包含獨立 organization.js；升級需一併替換它。

- 瀏覽器確認：三入口首頁、計畫下一步開啟原始要求／AI 理解／版本綁定預覽；自動流程也先開預覽而非直接核准。測試明確確認按入口後後端仍停在 outline，待預覽確認才接續執行。

## 第三批：文件與可重現入門

- 重寫中英文 README，移除固定 8,000 字元、沒有插件與舊首頁等不符新版的聲明；分開示範、真實 CLI、桌面與真人驗收。
- 在隔離副本執行 npm run demo（Node v26.7.0），確認 HTTP 200、三份虛構任務與新版導覽；npm run package:obsidian 重新建置成功。兩份 README 本機連結與 fenced code 檢查通過。
- 瀏覽器走過示範決策：開啟 Q3 卡片、選 30 日口徑、加入示範註記並送出；畫面證實保存且下一步改為人工驗收，未宣稱新成果或核准 placeholder 報告。新版截圖 docs/images/workflow-home.jpg 僅含虛構資料。
- 入門教學改寫為範圍明確的示範，停止把檔案 hash 或示範畫面當成果品質證明。完整真人與 Obsidian 教學仍待驗。
- GitHub 預設分支確認為 main；main 已透過 c976169 合併原工作基準，當前功能分支只多兩筆功能 commit，尚無對應 PR。

## 第四批：Draft PR 與跨平台回歸修復

- Draft PR：https://github.com/dan40912/Mentor/pull/2，目標 main；保留完整未完成需求，不宣稱已驗收。
- 首次 CI 顯示 Windows 測試使用 POSIX 專用檔名與 URL.pathname、固定 /etc/hosts，以及 SIGTERM 繼承 pipe 假設。改用平台有效的 fixture、fileURLToPath、明確建立的外部檔，並以可控制 runner 驗證「停止結果未確認」契約。真實停止流程的其他測試保留。
- 發現實際安全缺口：Windows 沒有 O_NOFOLLOW，附件 symlink 原本可能被讀取。新增跨平台 lstat 拒絕及開檔前後檔案 identity 核對，保留既有路徑保護與錯誤。
- 修正後 macOS／Node v26.7.0 全部 290 pass／0 fail；遠端新 head 仍須跨平台確認。首次 Linux／macOS Node 22 的取消來自同一個不確定停止 fixture，不能當成功。

- 第二輪 CI：Linux／macOS 的 Node 20／22／24 共六組成功；Windows 三組剩同一 shutdown 分類問題。taskkill 僅提供 exit code 時，現在由平台模組的 WeakSet 保留停止請求，runAgent 優先判定中斷，不把舊登入輸出當新錯誤。新增停止請求識別測試；本機完整 291 pass／0 fail。最終跨平台矩陣仍待最新 commit 驗證。

## 第五批：CLI 用量實測

- Codex 改用 --json，同時維持 -o 保存原始回覆；只讀 turn.completed 的白名單計數。Claude 改用 --output-format json，抽出 result、is_error、usage 與費用估算，錯誤 envelope 不可被當成功。
- 用量保存於同一 learningTurn，工作卡與普通 Markdown 顯示同一來源；Web 完整卡片、原生側欄的收合用量區可閱讀。不因缺欄位補零，不把快取或帳單估算混為實測成本。
- 虛構短句、真實 CLI smoke：兩個 provider 皆精確回覆 MENTOR_USAGE_OK。Codex：輸入 24,122、其中快取 13,056、輸出 8、9,246 ms，費用未知。Claude：input 2、cache read 649、cache creation 3,689、output 15、5,876 ms，CLI 估算 USD 0.0299498。這些是 CLI 實際上下文計數，遠大於使用者短句，反映工具自己的背景；不代表純 Prompt 大小或效率改善。
- 原始數值證據留於被忽略的 .lab-home/usage-smoke-evidence.json。成功回合的新格式已實測；舊回合／失敗回合仍可能沒有用量。完整 before/after Token 與品質基準未完成。
- 自動測試：295 pass／0 fail（新增純解析、未知欄位、錯誤 envelope、subprocess 整合、持久化與驗證過的 HTTP 工作卡用量測試）。原生外觀仍待實機。

## 第六批：修正影響預覽與驗收失效

- 發現並修正：直接相依標記未能撤銷多層後續工作的完成狀態；重排計畫只比較標題／驗收，遺漏 detail 與 dependsOn。現在會追蹤完整相依圖，保留產出並撤銷過期確認；獨立項目保留狀態。
- 影響摘要列出所有受影響項目，不再把它們同時描述成保持原樣。重新驗收 Prompt 包含原因與相依成果索引；舊 PASS 不作本次結論。前置未重新確認，不能先通過後續驗收。
- 原生側欄新增「補充或修正這個任務」→ 預覽原文／路由／影響 → 版本與 digest 綁定確認，保留原始要求與原因。Web 既有影響確認也攜帶方案識別；舊 API 呼叫保留相容行為。
- 修正 preview-only 副作用：instruct dryRun 在 resumeAuto 之前回應，不啟動 AI、不增加任務 revision。過期版本或改過文字不能套用已看過的方案。
- 自動測試涵蓋：多層／菱形／循環相依、工作細節與依賴變更、保留舊成果、HTTP dryRun 無執行、內容與版本過期拒絕、原生預覽再確認，以及 Web 附件／範圍／方案識別保留。完整測試結果記錄於本次提交與遠端 CI。
- 尚未完成自動辨識追問／取消／修正，亦未完成原生實機與真人理解驗收。此批不得作完整自然語言理解能力的宣告。

- 本批完整回歸：303 pass／0 fail；包含重排 detail-only 變更後重新驗收，以及手動／自動流程先處理前置工作的排程測試。npm run package:obsidian 重新建置成功。

- 交接 follow-up：精簡與完整接手包都列出重新核對原因、失效審閱與目前狀態；精簡包保留先前成果索引。歷史中的舊人工確認明示目前尚未重新確認，避免被新 AI 誤認為最新接受。修正紀錄保存 proposalId 與 baseRevision。新增接手包回歸後本機完整 304 pass／0 fail。

## 第七批：交接 Token 成對基準

- 新增 benchmark:handoff，預設只預覽；明確 --run 才使用真實 CLI，僅讀固定虛構 fixture，兩組順序交替以揭露次序差異。品質門檻檢查十項目標／邊界／修正／事實／未知／驗收欄位，不以低 Token 自動當成功。
- Claude 用量增加白名單模型名稱，核對實際模型一致；缺模型、缺用量或品質失敗不計比例。Codex 尚無可核對 effective model，因此仍只提供計數而不聲稱可比較比例。
- 真實 Claude Code 2.1.300、requested sonnet／low、reported claude-sonnet-5-5，共四次。全部資訊找回通過，但 full／compact logical input：第一組 18,973／9,033；第二組 22,508／44,273。背景上下文與快取未控制，兩組方向相反，未證明可重複的總 Token 節省。
- 原始虛構樣本及 SHA-256、判定、限制已保存至 docs/benchmarks/handoff-2026-10-22.*，不只選有利的一組。此基準不驗證成品品質、真實帳單、Obsidian 畫面或真人理解。
- 腳本初版 schema 1 的實測原始資料保持不變；schema 2 額外自動彙整結論並記錄 Node／平台，彙整器以原報告 SHA-256 另存結果，不回填新樣本。

- 本批完整自動測試：308 pass／0 fail；文件本機連結、四個樣本與彙整 SHA-256 驗證通過。一般測試不呼叫模型。
