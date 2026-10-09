// 合成任務，給需要完整任務檔的測試使用。內容是虛構的。
export const demoTask = (id = 'TASK-demo-0001', dir = '/tmp') => ({
  id, revision: 1, status: 'BLOCKED', updatedAt: '2026-01-01T00:00:00.000Z', prelude: '\n# 示範任務\n\n', notes: '\n',
  title: '示範任務', project: 'demo', goal: '示範目標', workspace: { label: 'w', root: dir }, allowedRoots: [dir],
  scope: { allowed: [], locked: [], forbidden: [] }, current: { summary: '摘要', sources: [] },
  decisions: [], checks: [], facts: [], learnings: [], parked: [], reports: [], next: '下一步',
  planning: {
    phase: 'execute', profile: 'quick', request: '示範', rules: '', diary: [], messages: [], outline: null,
    card: { title: '示範任務', project: 'demo', goal: '示範目標', audience: '主管', deliverable: 'HTML 簡報', success: [], constraints: [], unknowns: [] },
    workItems: [{ id: 'W1', outputs: [] }, { id: 'W2', outputs: [] }], running: null, readyForOutline: false,
  },
});
