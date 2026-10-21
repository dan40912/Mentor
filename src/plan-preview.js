import { createHash } from 'node:crypto';

// A preview binds the exact task revision and complete proposed work, not just a button label.
export function planPreview(task) {
  const p = task.planning;
  if (!p || p.phase !== 'outline' || !p.outline) return null;
  const plan = {
    taskId: task.id, revision: task.revision,
    request: p.request, interpretation: p.card?.goal || task.goal,
    scope: task.scope, constraints: p.card?.constraints || [], unknowns: p.card?.unknowns || [],
    outputRoot: task.allowedRoots?.[0] || null,
    outline: p.outline,
    items: (p.workItems || []).map(({ id, title, detail, owner, acceptance, dependsOn }) => ({ id, title, detail, owner, acceptance, dependsOn })),
    effect: '只核准這份計畫；不會因這個按鍵直接執行 CLI。自動模式另依已開啟的設定接續。',
    recovery: '核准後可要求重新擬計畫；既有成果需重新核對。此處未修改來源或成果檔。',
  };
  return { ...plan, id: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}
