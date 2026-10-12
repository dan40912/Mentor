export const reviewTask = () => ({
  id: 'TASK-review',
  planning: { workItems: [
    { id: 'W1', title: '搜尋骨架', outputs: [{ file: 'NEEDS_INPUT.md' }, { file: 'result.html' }],
      changes: [{ where: '搜尋頁', what: '加入搜尋欄位', howToCheck: '輸入 Mentor，確認結果出現。' }] },
    { id: 'W2', title: '尚未產出', outputs: [], changes: [] }
  ] }
});
export const reviewHtml = '<!doctype html><html lang="zh-Hant"><body><label>搜尋<input></label></body></html>';
