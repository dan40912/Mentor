// 四個入口共用驗證、逐檔狀態及重試；待送附件按任務與入口保留。
const fileSize = n => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} KB` : `${n} bytes`;
function attachmentPicker(host, upload, registerBatch) {
  // 新任務先在 HTML 顯示選擇器，再由共用元件接線。
  // 一眼看得出的夾帶區：明顯的「加入檔案」按鈕＋拖放提示；原生檔案欄位藏起來，由按鈕觸發。
  host.classList?.add('attach');
  const input = host.querySelector?.('input[type="file"]') || document.createElement('input');
  input.type = 'file'; input.accept = '.pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg'; input.multiple = true;
  input.className = 'visually-hidden'; input.tabIndex = -1;
  input.setAttribute('aria-label', '加入附件');
  const hint = document.createElement('div'); hint.className = 'attach-bar';
  const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'btn attach-pick'; pick.textContent = '📎 加入檔案';
  pick.setAttribute('aria-label', '加入檔案：PDF、DOCX、XLSX、CSV、TXT、MD、PNG、JPG，單檔最多 20 MB，每批最多 10 個');
  pick.addEventListener('click', () => input.click());
  const drop = document.createElement('span'); drop.className = 'attach-drop'; drop.textContent = '或把檔案拖到這裡';
  const rule = document.createElement('small'); rule.className = 'attach-rule'; rule.textContent = '選取或拖放 PDF、DOCX、XLSX、CSV、TXT、MD、PNG、JPG；單檔最多 20 MB，每批最多 10 個。';
  hint.append(pick, drop, rule);
  const list = document.createElement('ul'); list.className = 'attach-list'; list.setAttribute('aria-live', 'polite');
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn subtle'; retry.textContent = '重試上傳失敗的檔案'; retry.hidden = true;
  host.append(hint, input, list, retry);
  const entries = [], batches = []; let pending = Promise.resolve(); let locked = false;
  function render() {
    list.replaceChildren(...entries.map(entry => {
      const row = document.createElement('li');
      row.className = entry.id ? 'is-ok' : entry.failed || !entry.valid ? 'is-bad' : 'is-busy';
      row.textContent = `${entry.name}：${entry.status}`;
      if (entry.file?.size !== undefined) { const size = document.createElement('small'); size.textContent = ` · ${fileSize(entry.file.size)}`; row.append(size); }
      // 還沒送出的檔案可以拿掉；送出時只帶清單上留下的檔案。
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'attach-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', `移除 ${entry.name}`); remove.disabled = locked;
      remove.addEventListener('click', () => { const i = entries.indexOf(entry); if (i >= 0) entries.splice(i, 1); entry.valid = false; entry.failed = false; render(); });
      row.append(remove);
      return row;
    }));
    retry.hidden = !entries.some(entry => entry.failed);
  }
  async function process(batch) {
    try {
      if (!batch.id) {
        const registered = await registerBatch(batch.entries.map(entry => entry.name));
        batch.id = registered.id;
        for (const result of registered.results) {
          if (result.reason) { const entry = batch.entries[result.index]; entry.valid = false; entry.failed = false; entry.status = result.reason; }
        }
      }
      for (const [index, entry] of batch.entries.entries()) {
        if (!entry.valid || entry.id) continue;
        entry.failed = false; entry.status = '加入中'; render();
        try { entry.id = (await upload(entry.file, batch.id, index)).attachment.id; entry.status = '上傳成功，送出後保存到任務'; }
        catch (error) { entry.status = `加入失敗：${error.message}`; entry.failed = true; }
        render();
      }
    } catch (error) {
      for (const entry of batch.entries.filter(entry => entry.valid && !entry.id)) { entry.status = `批次登記失敗：${error.message}`; entry.failed = true; }
      render();
    }
  }
  function add(files) {
    if (locked) return pending;
    const batch = { entries: Array.from(files).map((file, index) => {
      const reason = index >= 10 ? '超出每批 10 個限制。' : !file.name || file.name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(file.name) ? '檔名格式不正確。' : !/\.(pdf|docx|xlsx|csv|txt|md|png|jpg)$/i.test(file.name) ? '只支援 PDF、DOCX、XLSX、CSV、TXT、MD、PNG、JPG。' : !Number.isSafeInteger(file.size) || file.size < 0 ? '檔案大小不正確。' : file.size > 20_000_000 ? '單檔不可超過 20,000,000 bytes。' : null;
      const entry = { name: file.name, status: reason || '等待加入', file, valid: !reason };
      entries.push(entry); return entry;
    }) };
    if (!batch.entries.length) return pending;
    batches.push(batch); render();
    pending = pending.then(() => process(batch));
    return pending;
  }
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  host.addEventListener('dragover', event => { event.preventDefault(); host.classList?.add('is-over'); });
  host.addEventListener('dragleave', () => host.classList?.remove('is-over'));
  host.addEventListener('drop', event => { event.preventDefault(); host.classList?.remove('is-over'); add(event.dataTransfer.files); });
  retry.addEventListener('click', () => { if (!locked) pending = pending.then(async () => { for (const batch of batches) if (batch.entries.some(entry => entry.failed)) await process(batch); }); });
  return {
    async ids() { await pending; return entries.filter(item => item.id).map(item => item.id); },
    consume(ids) {
      for (let i = entries.length - 1; i >= 0; i--) if (ids.includes(entries[i].id)) entries.splice(i, 1);
      for (const batch of batches) for (const entry of batch.entries) if (ids.includes(entry.id)) entry.valid = false;
      render();
    },
    lock(value) { locked = value; input.disabled = value; pick.disabled = value; retry.disabled = value; render(); },
    clear() { entries.length = 0; batches.length = 0; input.value = ''; render(); }
  };
}
function attachmentList(task) {
  const box = document.createElement('section'); box.className = 'attach-saved';
  const title = document.createElement('h3'); title.textContent = `附件 · ${task.attachments.length} 個`; box.append(title);
  const list = document.createElement('ul'); list.className = 'attach-list';
  for (const item of task.attachments || []) {
    const row = document.createElement('li'), link = document.createElement('a');
    row.className = item.readError ? 'is-bad' : 'is-ok';
    link.textContent = item.name; link.href = `/api/tasks/${task.id}/attachment?id=${encodeURIComponent(item.id)}`; link.download = item.name;
    const note = item.readError || (item.kind === 'image' ? 'AI 可在執行與驗收時開啟圖片' : 'AI 可讀取內容');
    row.append(link, document.createTextNode(` · ${fileSize(item.size)} · ${note}`)); list.append(row);
  }
  box.append(list);
  return box;
}

const attachmentDrafts = new Map();
function taskAttachmentPicker(taskId, entry) {
  const key = `${taskId}:${entry}`;
  if (!attachmentDrafts.has(key)) {
    const host = document.createElement('section');
    host.dataset.attachmentEntry = entry; host.dataset.task = taskId;
    const picker = attachmentPicker(host,
      async (file, batch, index) => request(`/api/uploads?name=${encodeURIComponent(file.name)}&batch=${encodeURIComponent(batch)}&index=${index}`, await file.arrayBuffer(), {}, true),
      names => request('/api/uploads/batches', { names, taskId, entry }));
    attachmentDrafts.set(key, { host, picker });
  }
  return attachmentDrafts.get(key);
}
const cardDrafts = new Map();
function cardEditor(t) {
  const form = element('form', undefined, 'card-editor');
  const fields = {}, saved = cardDrafts.get(t.id) || { ...t.planning.card, previewUrl: t.preview?.url || '', previewCommand: t.preview?.command || '' };
  for (const [key, label] of [['title','標題'],['goal','目標'],['audience','讀者'],['deliverable','產出'],['success','成功標準（每行一項）'],['constraints','限制（每行一項）'],['unknowns','還不知道（每行一項）'],['previewUrl','預覽網址（localhost 或 127.0.0.1）'],['previewCommand','啟動指令（僅保存文字，供複製）'],['testCommand','測試指令（選填，例如 npm test；不支援 shell 運算）']]) {
    const row = element('label', undefined, 'field'), area = element('textarea');
    area.value = Array.isArray(saved[key]) ? saved[key].join('\n') : saved[key] || '';
    area.maxLength = 6000; area.required = key === 'title' || key === 'goal';
    area.setAttribute('aria-label', label); fields[key] = area;
    area.oninput = () => cardDrafts.set(t.id, values());
    row.append(element('span', label), area); form.append(row);
  }
  function values() { return Object.fromEntries(Object.entries(fields).map(([key, area]) => [key, ['success','constraints','unknowns'].includes(key) ? area.value.split('\n').map(x=>x.trim()).filter(Boolean) : area.value])); }
  const { host, picker } = taskAttachmentPicker(t.id, 'card');
  const save = element('button', '保存任務卡', 'btn primary'); save.type = 'submit'; save.disabled = Boolean(t.planning.running);
  form.append(host, save);
  form.onsubmit = event => { event.preventDefault(); busy(save, async () => {
    picker.lock(true); const card = values(); cardDrafts.set(t.id, card);
    Object.values(fields).forEach(area => area.disabled = true);
    try {
      const attachmentIds = await picker.ids();
      await coachAct(t, 'card', { card, preview: { url: card.previewUrl, command: card.previewCommand }, attachmentIds });
      picker.consume(attachmentIds); cardDrafts.delete(t.id); openTask(t.id);
      tell('任務卡與附件已保存。');
    } finally { picker.lock(false); Object.values(fields).forEach(area => area.disabled = false); }
  })(); };
  return form;
}
