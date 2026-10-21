> **Obsidian 整合開發中：**已加入原生側欄、僅記憶體保存的本機配對、版本綁定的計畫預覽、每輪工作卡、原創淺深色主題與範本。以 `npm run package:obsidian` 產生示範庫；桌面實機與真實 AI 驗收仍待完成。詳見[安裝與限制](docs/obsidian-work-center.md)。

<div align="center">

<img src="web/assets/mentor.svg" width="72" alt="Mentor logo">

# Mentor

**在 Codex、Claude Code 和 Copilot 之間交接工作，不用重講背景。而且讓你真的記住學到的事。**

零依賴的本機工作台。一份任務檔是唯一正本：AI 開工前讀它，做完寫回它，你只負責決策和驗收。

[![CI](https://github.com/dan40912/mentor/actions/workflows/ci.yml/badge.svg)](https://github.com/dan40912/mentor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)
![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

[English](README.md) · 繁體中文

<img src="docs/images/overview.png" alt="Mentor 工作總覽：一件等你決策的事，加上任務看板" width="860">

</div>

> **目前狀態：早期版本（v0.1）。** 任務檔、決策卡、接手包、驗收與 A–F 教練流程已完成並有測試。介面目前只有繁體中文，英文介面在 [Roadmap](#roadmap)。**額度用完自動切換尚未完成**：現在是一鍵交接，不是零操作。

## 為什麼需要它

你同時用好幾個 AI。其中一個做到一半額度用完，你開另一個，花十分鐘重講專案、找最新的檔案、猜哪些事已經決定過。更糟的是：只有你能回答的問題被埋在聊天裡、AI 自己選了預設、結束碼 0 被當成完成。

Mentor 讓你不用再當搬運工。

## 你會得到什麼

| | |
|---|---|
| **一份任務檔** | Markdown 保存目標、邊界、決策、證據與唯一的下一步，Obsidian 可直接讀。任何 AI 都能接手。 |
| **一鍵交接** | `GET /api/tasks/:id/brief?for=codex\|claude` 產生 8,000 字元內的接手包：邊界、已確認決策、待決問題、口徑、回報格式。不需要聊天紀錄。 |
| **人決策，AI 執行** | 決策是獨立的卡片，附建議、每個選項的代價與未知。「先問別人」會一直阻擋，直到記錄最終答案。AI 不能替你選預設。 |
| **證據，不是感覺** | 自動檢查計算成果檔 SHA-256；你自己改檔就是新基準；基於舊版本的回報會被拒絕。`DONE` 只代表「可以驗收」。 |
| **教練，不只是執行器** | A–F 六個階段（任務卡、Grill me、大綱、執行、驗收、修改），每個階段權限不同：只對話、唯讀、只能寫產出資料夾。 |
| **回饋會改變做法** | 確認成果、自動停下、任務完成時，各問你一題 1–5 分加標籤。低分的標籤會變成下個任務開工時 AI 要照做的方向，首頁看得到趨勢。 |
| **學到的會留下來** | 每步 AI 寫日記：詮釋、偏離、取捨。你勾選要保留的，下個任務會帶上，之後用間隔回想問你。 |
| **零依賴** | 純 Node.js 與原生 JavaScript。不用 `npm install`、資料庫或 Obsidian 外掛。 |

## 快速開始

支援 macOS、Linux 與 Windows，需要 Node.js 20 以上（已測 20、22、24）。若要讓 Mentor 呼叫 AI，需要已登入的 CLI（[Codex](https://github.com/openai/codex)、[Claude Code](https://claude.com/claude-code) 或 GitHub Copilot CLI）。沒有 CLI 也能用任務檔與手動交接。

```sh
git clone https://github.com/dan40912/mentor.git
cd mentor
npm run demo      # 在 .demo-home/ 建立虛構資料並啟動
```

開啟 <http://127.0.0.1:4317>。要用自己的資料：

```sh
npm start                              # 資料在 ./vault 與 ./outputs（已加入 .gitignore）
npm start -- --home ~/mentor-data      # 資料放在別處
npm start -- --port 4318               # 連接埠衝突時
npm test
```

`--home` 與 `--port` 在 macOS、Linux、PowerShell、cmd 用法相同，也可以用環境變數 `MENTOR_HOME`、`PORT`。

### Windows 注意事項

- 用 npm 安裝的 CLI（例如 `codex`）在 Windows 是 `.cmd` 捷徑。Mentor 會依 `PATH` 與 `PATHEXT` 找到它，並經由 `cmd.exe` 執行。參數含有 `& | < > ^ % ! "` 時會直接拒絕而不是跳脫，專案與產出路徑請避開這些字元。
- 停止執行時，用 `taskkill` 結束整個程序樹。
- 每次 push 都會在 CI 跑 Windows。尚未在真實 Windows 機器上搭配已登入的 `codex`、`claude`、`copilot` 試過，遇到問題請回報。

## 運作方式

```
任務檔 ──產生──▶ 接手包（≤ 8,000 字元）──貼上或直接執行──▶ Codex / Claude / Copilot
  ▲                                                              │
  └──── 後端核對 revision、證據、新成果檔 hash ◀──── 回報 ───────┘
```

1. **建立任務。** 教練把一句話整理成任務卡，每次最多問三題。
2. **指派。** 每個階段選 AI 與模型。Mentor 用 `argv` 與 `stdin` 呼叫你已登入的 CLI，不經 shell。
3. **決策。** 首頁只推薦你一件事，順序：待決策、未通過的檢查、待驗收、人工檢查、交給 AI。
4. **交接。** 額度用完，或下一步換個模型更適合？換 provider，接手包帶著所有背景。
5. **驗收。** 自動檢查與人工檢查分開。AI 驗過不等於你驗過。
6. **保留。** 勾選值得留下的教訓，它們會影響同專案的下個任務。

任務檔長什麼樣子見 [`examples/sample-task.md`](examples/sample-task.md)，內部設計見 [`docs/architecture.md`](docs/architecture.md)。

## 安全設計

Mentor 在你的機器上執行你信任的 CLI，所以預設很嚴格。

- 只監聽 loopback，檢查 `Host` 與 `Origin`。
- 修改類請求需要同源 cookie、CSRF token 與 `Idempotency-Key`；同一個 key 用在不同操作會被拒絕。
- 任何 CLI 都不使用「略過權限」旗標。每個階段只給最小權限：只對話、唯讀，或只能寫任務的產出資料夾。實際強制力取決於 CLI：Codex 用它的 sandbox；Claude Code 與 Copilot 用工具白名單加工作目錄，Mentor 沒有額外沙箱。
- 預覽與檔案讀取做路徑與 symlink 檢查。
- 服務重啟時，未完成的步驟標為「結果未知」，不會偷偷重跑。

發現漏洞請看 [SECURITY.md](SECURITY.md)。

## Roadmap

**目前可用：** 任務檔正本、決策、證據檢查、接手包、A–F 受控 CLI 流程、看板、學習日記與回想、回收桶、專案說明。

**接下來：**
- [ ] 英文介面（網頁與教練 prompt 的 i18n）
- [ ] provider 回報額度錯誤時自動交接
- [ ] Codex 與 Claude Code session 匯入（目前是手動匯入）
- [ ] Server-sent events 取代重新整理
- [ ] Claude → Codex 完整交接的示範 GIF
- [ ] `npx mentor-ai`

## 文件

- [設計意圖](docs/design-intent.md)
- [架構](docs/architecture.md)
- [教學 1：5 分鐘完成第一個任務](docs/tutorials/01-first-task.md)
- [教學 2：一個任務交給兩個 AI](docs/tutorials/02-handoff.md)
- [教學 3：把錯誤變成規則](docs/tutorials/03-learning.md)
- [AI-DLC 蒸餾筆記](docs/ai-dlc-notes.md)

## 貢獻

歡迎 issue 與 PR，請先看 [CONTRIBUTING.md](CONTRIBUTING.md)。現在最有幫助的貢獻是翻譯介面。

## 授權

[MIT](LICENSE)
