(() => {
  const terms = Object.freeze({
    'A 任務卡': '了解需求', 'B 追問': '確認細節', 'C 計畫': '擬計畫',
    'D 執行': '製作', 'E 審閱': '檢查', 'F 修改': '修改',
    revision: '第 N 版', workItem: '工作項目', sensor: '自動檢查',
    PASS: '通過', FAIL: '未通過', NOT_RUN: '尚未檢查',
    provider: 'AI 助手', model: '模型', effort: '思考深度', token: '用量', CLI: 'AI 助手程式',
    'exit code': '詳細紀錄', stdout: '詳細紀錄', stderr: '詳細紀錄'
  });
  const status = task => {
    if (task?.error) return '需要檢查任務資料';
    const holder = task?.nextAction?.label;
    if (holder) return holder;
    const state = task?.status;
    return ({RUNNING:'工作進行中', BLOCKED:'需要你處理', AWAITING_ACCEPTANCE:'等你確認', COMPLETED:'已完成', PAUSED:'已暫停', INTERRUPTED:'執行中斷'})[state] || '查看目前進度';
  };
  window.plainWords = Object.freeze({terms, status});
})();
