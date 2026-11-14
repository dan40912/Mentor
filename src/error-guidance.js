const HELP = {
  AGENT_QUOTA: ['這個 AI 的額度暫時不夠。', '已完成的成果與任務紀錄會保留；未完成的部分不算完成。', '到「角色與設定」把下一步交給另一個 AI，或稍後重試。', 'settings', '更換負責的 AI'],
  AGENT_MODEL_CAPACITY: ['這個 AI 目前太忙。', '已完成的成果與任務紀錄會保留。', '稍後重試，或把下一步交給另一個 AI。', 'settings', '更換負責的 AI'],
  AGENT_MODEL_UNSUPPORTED: ['這個 AI 帳號目前不能使用所選模型。', '任務與已有成果會保留。', '到「角色與設定」換一個可用模型，或改派給另一個 AI。', 'settings', '更換 AI 或模型'],
  AGENT_NOT_LOGGED_IN: ['這個 AI 尚未登入或登入已過期。', '目前成果與任務紀錄會保留。', '查看官方登入說明，在終端機完成登入後重新檢查。', 'onboarding', '查看登入說明'],
  AGENT_NOT_INSTALLED: ['這台電腦找不到這個 AI 工具。', '你的任務與素材不會被刪除。', '查看官方安裝說明，或改派給已可用的 AI。', 'onboarding', '查看安裝說明'],
  AGENT_TIMEOUT: ['這次工作花太久，已停止等待。', '已寫入的成果仍保留，但可能只完成一部分，尚未驗收。', '先查看目前成果，再重新指派或重試。', 'settings', '重新指派工作'],
  AGENT_RESPONSE_INVALID: ['AI 回覆格式不完整，Mentor 無法安全接續。', '原始回覆與先前成果會保留。', '查看詳細紀錄後重試，或改用另一個 AI。', 'settings', '選擇另一個 AI'],
  BODY_TOO_LARGE: ['這次送出的內容太大，尚未保存。', '原任務與素材保持不變。', '拆成較小的段落後再送出。', 'dismiss', '關閉'],
  ARTIFACT_TOO_LARGE: ['成果檔太大，無法在這裡預覽。', '原始檔案不會被修改。', '在電腦上開啟檔案，或另存較小版本。', 'dismiss', '關閉'],
  PREVIEW_TOO_LARGE: ['成果檔太大，無法在這裡預覽。', '原始檔案不會被修改。', '在電腦上開啟檔案，或另存較小版本。', 'dismiss', '關閉'],
  REVISION_CONFLICT: ['任務剛被更新，這次操作沒有套用。', '你輸入的內容仍留在目前欄位。', '重新整理並核對最新版本，再預覽一次。', 'reload', '重新整理'],
  SESSION_REQUIRED: ['本機連線需要更新。', '未送出的輸入仍留在目前欄位。', '重新整理頁面後再試。', 'reload', '重新整理'],
  CSRF_FAILED: ['連線驗證已更新，這次操作尚未送出。', '成果與輸入會保留。', '重新整理頁面後再試。', 'reload', '重新整理'],
  FORBIDDEN_ORIGIN: ['目前使用的網址不正確。', '任務與成果不受影響。', '請用畫面顯示的 127.0.0.1 網址開啟 Mentor。', 'reload', '重新整理'],
  NETWORK_ERROR: ['目前無法連到本機 Mentor 服務。', '未送出的輸入仍留在頁面。', '確認服務仍在執行，再重新載入。', 'reload', '重新載入']
};

export function errorGuidance(code) {
  const values = HELP[code];
  return values ? { summary: values[0], preserved: values[1], nextStep: values[2], action: values[3], actionLabel: values[4] } : null;
}

export const GUIDANCE_CODES = Object.keys(HELP);
