---
type: task
schema_version: 1
task_id: "TASK-demo-0001"
revision: 1
status: "BLOCKED"
updated_at: "2026-10-09T07:45:41.879Z"
state_sha: "e8271428b8a91c429a42aa669af2370ed8a4d3ecfed3bd3e11f9862c7ac89031"
---

<!-- awc:begin 以下由 Mentor產生。要改內容請在工作台操作；人工筆記寫在 awc:end 之後 -->
## 給人看
**目標**：讓主管 5 分鐘內看懂 Q3 重點
**目前成果**：Claude 做到 v2，第 4 頁的指標口徑有兩種寫法，需要你選。
**卡點**：「活躍使用者」要用 7 日還是 30 日口徑？
**你現在要做的一件事**：決定：「活躍使用者」要用 7 日還是 30 日口徑？

## 驗收清單
- NOT_RUN｜最新成果檔
- NOT_RUN｜數字與來源一致

## 決策紀錄
- 待決定｜「活躍使用者」要用 7 日還是 30 日口徑？

## 事實與口徑
- 資料期間：2026-07-01 ~ 2026-09-30（已核對；來源 dashboard）

```json awc-state
{
  "workspace": {
    "label": "demo",
    "root": "/path/to/mentor-home/outputs/TASK-demo-0001"
  },
  "allowedRoots": [
    "/path/to/mentor-home/outputs/TASK-demo-0001"
  ],
  "scope": {
    "allowed": [
      "另存 v3"
    ],
    "locked": [
      {
        "text": "第 1 頁結論不改",
        "source": "主管意見"
      }
    ],
    "forbidden": [
      "對外發布"
    ]
  },
  "decisions": [
    {
      "id": "D1",
      "status": "OPEN",
      "question": "「活躍使用者」要用 7 日還是 30 日口徑？",
      "recommendation": "a",
      "basis": "主管上次簡報用 30 日",
      "options": [
        {
          "id": "a",
          "label": "30 日活躍",
          "cost": "與上季可比，但看不到近期波動"
        },
        {
          "id": "b",
          "label": "7 日活躍",
          "cost": "更敏感，需要重做第 4、6 頁"
        }
      ],
      "unknown": "主管是否要和競品比較"
    }
  ],
  "checks": [
    {
      "id": "C1",
      "kind": "artifact",
      "label": "最新成果檔",
      "path": "/path/to/mentor-home/outputs/TASK-demo-0001/q3-report-v2.md",
      "baselineSha": "533dad3c412c05af13aa68f0f26528508e75cddba7b7942559824969529a77b8",
      "result": "NOT_RUN",
      "note": ""
    },
    {
      "id": "C2",
      "kind": "human",
      "label": "數字與來源一致",
      "result": "NOT_RUN",
      "note": ""
    }
  ],
  "facts": [
    {
      "label": "資料期間",
      "value": "2026-07-01 ~ 2026-09-30",
      "source": "dashboard",
      "verified": true
    }
  ],
  "learnings": [],
  "parked": [],
  "reports": [],
  "title": "Q3 營運報告",
  "project": "Demo 專案",
  "goal": "讓主管 5 分鐘內看懂 Q3 重點",
  "current": {
    "summary": "Claude 做到 v2，第 4 頁的指標口徑有兩種寫法，需要你選。",
    "artifact": "/path/to/mentor-home/outputs/TASK-demo-0001/q3-report-v2.md",
    "sources": [
      {
        "provider": "Claude",
        "sessionId": "demo-session",
        "locator": "L120"
      }
    ]
  },
  "next": "你選定口徑後，把接手包交給 Codex 做 v3"
}
```
<!-- awc:end -->

## 人工筆記
這一段是你自己的筆記，Mentor 不會覆寫。
