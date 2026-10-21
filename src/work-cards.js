// These projections use persisted state, never another AI call to invent a summary.
export function measureText(text = '') {
  return { characters: [...text].length, utf8Bytes: Buffer.byteLength(text), tokens: null, tokenSource: 'unavailable' };
}

export function turnContext(task) {
  return structuredClone({
    request: task.planning?.request || task.goal,
    interpretation: task.planning?.card?.goal || task.goal,
    scope: task.scope,
    constraints: task.planning?.card?.constraints || [],
    unknowns: task.planning?.card?.unknowns || [],
    outputRoot: task.allowedRoots?.[0] || null,
    taskSource: `vault/${task.id}.md`,
  });
}

const states = { running: '執行中', completed: '已回覆，仍需核對', failed: '未完成', unknown: '結果未知', stopped: '已停止，未完成' };
export function workCards(task) {
  return (task.planning?.learningTurns || []).map(turn => ({
    id: turn.id, stage: turn.stage, status: turn.status, label: states[turn.status] || '未知狀態',
    provider: turn.provider || null, model: turn.modelId || null, agent: turn.agent || '未記錄',
    startedAt: turn.startedAt, completedAt: turn.completedAt || null,
    baseRevision: turn.beforeRevision, resultRevision: turn.afterRevision || null,
    userInput: turn.userInput || '',
    // Historical turns without a snapshot must not be rewritten using today's goal.
    context: turn.context || null,
    outcome: turn.error || (turn.status === 'completed' ? '本輪 AI 回覆已保存；成果與驗收請分別核對。' : states[turn.status] || '尚無可核對結果'),
    aiClaims: turn.status === 'completed' ? { change: turn.learning?.change || '', evidence: turn.learning?.evidence || '' } : null,
    outputs: turn.outputs || [],
    checks: turn.checks || [],
    next: turn.nextAction || null,
    contextMetrics: { input: measureText(turn.prompt), output: measureText(turn.response), usage: turn.usage || null },
    simulated: Boolean(turn.simulated),
    source: `vault/${task.id}.md#planning.learningTurns[id=${turn.id}]`,
  }));
}

export function workCardsMarkdown(task) {
  const cards = workCards(task);
  if (!cards.length) return '';
  return ['## 每輪工作紀錄', '> AI 自述、已登記成果與機器檢查分開呈現；已回覆不代表人工驗收通過。',
    ...cards.map(card => [
      `### ${card.stage} · ${card.label} · ${card.agent}`,
      `- 開始版本：${card.baseRevision ?? '未記錄'}；結果版本：${card.resultRevision ?? '未記錄'}`,
      `- 本輪要求：${card.userInput || '未記錄'}`,
      `- 當時理解：${card.context?.interpretation || '舊紀錄未保存，不以目前目標回填'}`,
      `- 結果：${card.outcome}`,
      ...(card.aiClaims?.change ? [`- AI 自述改動：${card.aiClaims.change}`] : []),
      ...card.outputs.map(output => `- 已登記成果：${typeof output === 'string' ? output : output.file || output.path}`),
      ...card.checks.map(check => `- 機器檢查：${check.result}｜${check.label || check.id}｜${check.detail || check.note || '未附說明'}`),
      ...(!card.checks.length ? ['- 機器檢查：未記錄，不視為通過'] : []),
      `- 當輪結束時的下一步：${card.next?.label || '未記錄，請查看目前任務狀態'}`,
      `- 來源：${card.source}`,
    ].join('\n')),
  ].join('\n\n');
}
