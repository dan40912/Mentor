# 階段 6 驗證紀錄

- Node 22 完整測試：377 通過、0 失敗。
- HTML 簡報只在存在 `section.slide` 區塊時進入逐頁預覽；保留一般 HTML 預覽流程。
- 簡報頁面以 iframe 顯示，sandbox 僅允許同源以讀取使用者反白文字，不允許腳本；CSP 設為 `default-src 'none'`、`script-src 'none'`、`connect-src 'none'`、`form-action 'none'`、`frame-src 'none'`、`object-src 'none'`。資料先通過既有登記路徑、symlink、大小與類型檢查。
- 頁碼、選取文字與修改意見先送既有 `instruct` dry-run；另按確認才交辦。
- 每頁數字標出素材找不到的項目「無來源」。這是自動提醒，不代表人工驗收。
- 決策卡解析 `mentor-decision` JSON 區塊；AI 建議單獨標示，只有使用者按「我選這個」才寫入任務決策。
- Markdown 可下載；HTML 簡報提供可列印 HTML 下載。`.pptx` 與 `.docx` 尚未支援，請先輸出 HTML 或 Markdown。
- 320／390／1360 px 實際瀏覽器檢查與截圖未完成：本輪 Computer Use 因無法判定 Windows 瀏覽器網址而停止，工具要求停止 UI 操作。沒有用假截圖代替。
