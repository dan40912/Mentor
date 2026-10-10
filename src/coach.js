import { mkdir, realpath, readFile, stat, appendFile, readdir, cp, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { runAgent, extractJson, AgentError } from './agents.js';
import { stages, resolveStage, profileOf, providers, resolveModel } from './models.js';
import { TaskError, sha256, planningStatus, planningAction, ready } from './tasks.js';
import { HEADINGS } from './memory.js';
import { outlineSensors, outputSensors } from './sensors.js';
import { Projects } from './projects.js';
import { killTree } from './platform.js';
import { itemName, itemNames } from './item-names.js';
import { validateFeedback, feedbackBrief } from './feedback.js';

const now = () => new Date().toISOString();
const stageName = id => stages.find(s => s.id === id).name;
// 完全自動時，AI 驗收通過的項目先放行後續；你在最後一次確認全部成果。
const unlockOf = t => t.planning?.autopilot?.full ? ['DONE', 'REVIEWED'] : ['DONE'];
const agentLabel = agent => `${{ codex: 'Codex', claude: 'Claude Code' }[agent.provider] || agent.provider}${agent.modelId ? ` ${agent.modelId}` : ''}${agent.effort ? ` ${agent.effort}` : ''}`;

const VOICE = '用自然的台灣繁體中文。不要客套、不要「不是 X 而是 Y」句型。使用者是台灣的 PM，正在學習怎麼下好 prompt、怎麼 review AI 的成果；你同時是執行者和教練。';

function cardText(card) {
  return [`標題：${card.title}`, `目標：${card.goal}`, `讀者：${card.audience}`, `產出：${card.deliverable}`,
    `成功標準：${(card.success || []).join('；')}`, `限制：${(card.constraints || []).join('；')}`, `未知：${(card.unknowns || []).join('；')}`].join('\n');
}

function transcript(messages) {
  const recentAi = new Set(messages.filter(m => m.role === 'ai').slice(-8));
  // 人的修正不能因為 AI 中間多回了幾次就被截掉；新指令的優先序在共同契約說明。
  return messages.filter(m => m.role === 'user' || recentAi.has(m)).map(m => m.role === 'user' ? `使用者：${m.text}` :
    `AI（${stageName(m.stage)}）：${m.questions?.length ? m.questions.map((q, i) => `${i + 1}. ${q.q}`).join(' ') : m.text}`).join('\n');
}

const DIARY = `另外在 JSON 裡加上 diary：把這一步你自己做的判斷寫下來，供使用者決定要不要變成下次的規則。
四類各 0～3 條，每條一句、寫具體：interpretations（需求模糊時你怎麼解讀）、deviations（你刻意沒照指示做的地方與原因）、tradeoffs（你考慮過的替代方案與取捨理由）、openQuestions（還沒確定、下次要先問的事）。沒有就留空陣列，不要湊數。`;
const diaryShape = '"diary":{"interpretations":[],"deviations":[],"tradeoffs":[],"openQuestions":[]}';

const LEARNING = `每次提問與演進都要能回頭學習。原本的 JSON 再加 learning；執行與修改階段放在最後的 JSON 區塊。
learning 格式：{"change":"這次相對於需求或上一版調整了什麼，第一次就寫這次釐清的事","reason":"依據與取捨","evidence":"實際檔案、位置或這次對話；沒驗證就明寫未驗證","lesson":"一條可重用的判斷原則","nextPrompt":"示範下次可直接用的完整提問","question":"讓使用者先自己回答的一題回想問題"}。
快速流程各欄一句即可；其他流程仍要精簡。沒有新發現就如實寫，別湊數。學習建議不代表已驗收或已成為規則。`;

function context(task) {
  const p = task.planning;
  const folder = task.folderListing ? `\n\n產出資料夾（AI 的工作目錄）：${task.allowedRoots[0]}\n目前檔案：\n${task.folderListing}` : '';
  // 開工前就在資料夾裡的檔案是素材。附上當時的 SHA-256，要證明沒改過素材時自己算一次比對，不用問人。
  const baseline = p.baseline?.length ? `\n開工前已有的素材（建立任務時記錄的 SHA-256，可用 shasum -a 256 比對）：\n${p.baseline.map(b => `- ${b.file}  ${b.sha}`).join('\n')}` : '';
  const profile = profileOf(p.profile);
  const rules = (p.rules?.trim() ? `\n\n團隊與專案規則（開工前已確定，照做；與這次需求衝突時在 deviations 說明）：\n${p.rules.trim()}` : '') + (p.projectBrief ? `\n\n${p.projectBrief}` : '') + (p.feedbackBrief ? `\n\n${p.feedbackBrief}` : '');
  const alignment = `\n\n交辦對齊與減少返工：
- 最初需求：${p.request}
- 先依最新明確指示、目前任務卡與現檔判斷；較早對話供對照，已被取代的數字與指令不可帶回。
- 已回答、已提供路徑或已鎖定的條件不要再問。看到檔名不等於讀過內容：本階段不能讀的資料，交由唯讀階段核對，不要請使用者重講檔案中已有的內容。
- 先列已知、待決定、待核對；一次集中只問會改方向、範圍或事實正確性的缺口。樣式細節可先給建議，不能用建議代替使用者做業務決定。
- 未知事實要保留缺口；數字、單位、期間與資料範圍附來源，跨頁一起檢查。使用者要求只討論時不可寫檔。
- 改局部時保留主張、已確認邊界與未要求修改的內容；完成後分開回報指定改動、取捨、證據與未完成。
${p.projectLocked ? `- 專案已由使用者選定：${task.project}，不可換成另一個專案。` : ''}`;
  return { profile, rules: rules + folder + baseline + alignment, diary: profile.diary ? `\n${DIARY}` : '', diaryField: profile.diary ? `,${diaryShape}` : '' };
}

export const prompts = {
  A: task => {
    const { profile, rules, diary, diaryField } = context(task);
    return `你是 Mentor的「任務制定」角色。${VOICE}
工作流程：${profile.name}（${profile.description}）
使用者剛丟來一個需求，把它整理成任務卡。不要開始做，也不要假設使用者沒說的事；不清楚的放進 unknowns。
project 填這件事所屬的專案或主題名稱（10 字內），看不出來就填「未分類」。
constraints 只寫這件任務本身的限制，不要寫「本階段不讀資料」這類階段規則；產出資料夾的路徑與檔案已經給你，不要再問使用者。
另外寫一段 coaching：指出這個需求原本缺了什麼（例如讀者、要對方做的決定、成功標準），並示範一句更好的寫法，讓使用者下次可以直接這樣下 prompt。${diary}${rules}

使用者需求：
${task.planning.request}

只輸出一個 JSON（放在 \`\`\`json 區塊）：
{"card":{"title":"10 字內","project":"","goal":"","audience":"","deliverable":"","success":[""],"constraints":[""],"unknowns":[""]},"coaching":""${diaryField}}`;
  },

  B: task => {
    const { profile, rules, diary, diaryField } = context(task);
    return `你是 Mentor的「Grill me」角色。${VOICE}
產出資料夾路徑與檔案清單已附在下方，不要再問使用者資料在哪裡。
工作流程：${profile.name}。目標：用反問把任務問清楚，直到可以擬定大綱。一次最多問 ${profile.questions} 題，每題附上「為什麼要問」。優先問會改變方向的事：
讀者是誰、看完要做什麼決定、一句話主張、證據與資料來源、篇幅、哪些地方需要圖片或圖表、時程與限制。${profile.evidence ? '\n這是要上檯面的工作：一定要問到每個關鍵數字的來源與口徑，以及最可能被質疑的地方。' : ''}
挑戰模糊或矛盾的回答；使用者說不知道時，給一個預設值並標成假設，寫進 constraints 或 unknowns。
coaching 要具體：評論使用者剛才的回答哪裡好、哪裡還不夠，並示範一句更好的回答或 prompt。
資訊足以擬定大綱時 ready 設 true，questions 可以為空。${diary}${rules}

目前任務卡：
${cardText(task.planning.card)}

對話紀錄：
${transcript(task.planning.messages)}

只輸出一個 JSON（放在 \`\`\`json 區塊）：
{"questions":[{"q":"","why":""}],"coaching":"","card":{"title":"","goal":"","audience":"","deliverable":"","success":[""],"constraints":[""],"unknowns":[""]},"ready":false,"readyReason":""${diaryField}}`;
  },

  C: (task, feedback) => {
    const { profile, rules, diary, diaryField } = context(task);
    const previous = task.planning.outline;
    return `你是 Mentor的「擬定大綱」角色。${VOICE}
工作流程：${profile.name}（${profile.description}）
依任務卡與 Grill 對話，產出大綱並拆成工作項目。你可以唯讀目前資料夾的檔案，大綱每段的 evidence 要寫出實際依據的檔名與位置。
- storyline：一句話主線。logic：因果鏈，每一步一句，讓第一次聽的人也懂前因後果。
- sections：逐段（簡報就是逐頁），每段寫重點、evidence（依據或資料來源；沒有依據就寫「無依據」，不要編）${profile.evidence ? '、risk（最可能被質疑的地方）' : ''}，以及需要的視覺：type 是 image、chart、diagram、screenshot、none 之一，count 是張數。${profile.id === 'quick' ? '段落精簡，只留必要的。' : ''}
- imageTotal：全部需要的圖片與圖表張數加總。
- workItems：可以交給 AI 或人的工作。owner 是 ai 或 human。AI 項目必須能在一個資料夾內用檔案完成（例如產出 HTML、Markdown、圖表程式）。
  每項寫 2～4 條可檢查的 acceptance，dependsOn 填前置項目 id。acceptance 只寫驗收者能從產出檔案或自己執行指令確認的成果；驗收者看不到執行過程，不要寫「有沒有回報」「是否貼出輸出」這類流程條件。需要人用眼睛確認的事（例如在瀏覽器實際操作）不要寫進 AI 項目的 acceptance。真的需要人提供的素材或判斷，owner 設 human。${profile.skeleton ? `
  第一個 AI 項目必須是「骨架版」：最小但從頭到尾走得通的版本（例如簡報的封面、主張頁、一頁證據），讓使用者先確認方向；其他 AI 項目 dependsOn 它。` : ''}
- coaching：教使用者怎麼 review 這份大綱，列出最該看的 3 件事。${diary}${rules}
${previous && feedback ? `
上一版大綱主線：${previous.storyline}
上一版各段：${(previous.sections || []).map(s => `${s.no}.${s.title}`).join('、')}
使用者對上一版的修改意見（原文，照這個改）：
${feedback}
` : ''}
任務卡：
${cardText(task.planning.card)}

Grill 對話：
${transcript(task.planning.messages)}

只輸出一個 JSON（放在 \`\`\`json 區塊）：
{"outline":{"storyline":"","logic":[""],"sections":[{"no":1,"title":"","point":"","evidence":"",${profile.evidence ? '"risk":"",' : ''}"visual":{"type":"none","count":0,"note":""}}],"imageTotal":0},"workItems":[{"id":"W1","title":"","detail":"","owner":"ai","acceptance":[""],"dependsOn":[]}],"coaching":""${diaryField}}`;
  },

  D: (task, item, done) => {
    const { diary, diaryField, rules } = context(task);
    return `你是 Mentor的「執行」角色。${VOICE}
在目前資料夾內完成下面的工作項目，只做這一項，不要提前做其他工作項目。目前資料夾就是產出資料夾，裡面的檔案就是可用的資料。只能建立或修改目前資料夾內的檔案，不要碰其他位置，不要對外發布。
成果要寫成檔案；只在回覆裡描述、沒有產出檔案，不算完成。
資訊不足時不要猜，回報 NEEDS_INPUT 並寫出缺什麼。${rules}

任務卡：
${cardText(task.planning.card)}

大綱主線：${task.planning.outline.storyline}
邏輯：${task.planning.outline.logic.join(' → ')}
各段：
${task.planning.outline.sections.map(s => `${s.no}. ${s.title}｜${s.point}｜依據：${s.evidence || '無'}｜視覺：${s.visual?.type} ×${s.visual?.count}${s.visual?.note ? `（${s.visual.note}）` : ''}`).join('\n')}
大綱規劃的圖片與圖表共 ${task.planning.outline.imageTotal ?? 0} 張。

已完成的其他項目與檔案：
${done.length ? done.map(d => `- ${d.title}：${(d.outputs || []).map(o => o.file).join('、')}`).join('\n') : '- 無'}

這次的工作項目：${item.title}${item.skeleton ? '（骨架版：先做最小但走得通的版本，讓使用者確認方向）' : ''}
說明：${item.detail}
驗收條件：
${item.acceptance.map(a => `- ${a}`).join('\n')}
${item.fixes?.length ? `\n上一輪驗收或使用者要求修正（原文）：\n${item.fixes.map(f => `- ${f}`).join('\n')}\n` : ''}
完成後，回覆最後一段必須是：
STATUS: DONE | BLOCKED | NEEDS_INPUT
FILES: 相對路徑, 相對路徑
證據：逐條對應驗收條件，寫出檔名與位置
未完成：${diary ? `\n${diary}\n最後附上一個 \`\`\`json 區塊：{${diaryField.slice(1)}}` : ''}`;
  },

  E: (task, item, { copy = false } = {}) => {
    const { diary, diaryField, rules } = context(task);
    return `你是 Mentor的「驗收」角色。${VOICE}
${copy ? '你在成果的暫存副本裡工作：可以執行建置、測試等會產生檔案的指令來驗證，副本的改動不會保留。不要修改成果來讓它通過，你的工作只是判定。' : '唯讀檢查目前資料夾內的成果，不要修改檔案。'}逐條核對驗收條件。只採信你實際讀到的內容或自己執行指令的結果，執行者的自述不算證據。
看不到或無法判斷的條件標 NOT_RUN，不要猜 PASS。
只核對這一項列出的驗收條件。任務卡的其他成功標準由其他工作項目負責，不要因此判 FAIL，fixes 也不要要求做其他項目的事。${item.skeleton ? '\n這一項是骨架版：只確認最小版本走得通，內容不完整是預期的。' : ''}
另外寫 coaching：教使用者自己 review 時最該看的 3 件事，以及怎麼看（例如打開哪個檔、看哪一段）。${diary}${rules}

任務卡：
${cardText(task.planning.card)}

工作項目：${item.title}
說明：${item.detail}
檔案：${(item.outputs || []).map(o => o.file).join('、') || '（執行者沒有列出檔案，請自行查看資料夾）'}
自動檢查（確定性感測器，供參考）：
${(item.sensors || []).map(s => `- ${s.result}｜${s.name}：${s.detail}`).join('\n') || '- 無'}
驗收條件：
${item.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n')}
${item.log?.length ? `\n執行者最後一次回報（自述，不算證據，只用來知道去哪裡找）：\n${item.log.at(-1).text.slice(-1500)}\n` : ''}
${item.instructions?.length ? `\n使用者補充指示（原文，請逐條核對；指示不代替成果證據）：\n${item.instructions.map(x => `- ${x.text}`).join('\n')}` : ''}

只輸出一個 JSON（放在 \`\`\`json 區塊）：
{"results":[{"criterion":"","result":"PASS","evidence":""}],"verdict":"PASS","fixes":[""],"coaching":""${diaryField}}`;
  }
};

// 升級前建立的任務從現在開始收回饋，之前完成的項目不補問。
const startFeedback = p => { if (!Array.isArray(p.feedback)) Object.assign(p, { feedback: [], feedbackSince: now() }); };

export function parseExecution(text) {
  const status = text.match(/^STATUS:\s*(DONE|BLOCKED|NEEDS_INPUT)\s*$/m)?.[1];
  // 模型常把檔名包成 `a.html` 或 [a.html](/abs/a.html:12)；取出真正的路徑，去掉行號。
  const files = (text.match(/^FILES:\s*(.*)$/m)?.[1] || '').split(/[,，、]/)
    .map(f => f.trim().replace(/^\[[^\]]*\]\(([^)]+)\)$/, '$1').replace(/^[`'"]+|[`'"]+$/g, '').replace(/:\d+(?::\d+)?$/, '').trim())
    .filter(f => f && f !== '無');
  // 「未完成」那一段就是停下的原因，直接給人看，不用打開紀錄。
  const after = text.match(/^未完成：([\s\S]*)$/m)?.[1] || '';
  const missing = after.split('```')[0].trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return { status: status || 'NEEDS_INPUT', files, parsed: Boolean(status), missing: /^(無|none)?$/i.test(missing) ? '' : missing.slice(0, 300) };
}

export class Coach {
  constructor(store, settings, root, memory) {
    Object.assign(this, { store, settings, root, memory, children: new Map(), drivers: new Set(), overrides: new Map(), cancelled: new Set(), pending: new Map(), retries: new Map() });
  }

  // 只增不改的事件紀錄。人的回覆逐字保存。
  async audit(id, type, data = {}) {
    if (!/^TASK-[a-zA-Z0-9-]+$/.test(id)) return;
    const dir = path.join(this.store.dir, 'events');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ at: now(), type, ...data })}\n`);
  }

  async events(id) {
    if (!/^TASK-[a-zA-Z0-9-]+$/.test(id)) throw new TaskError(404, 'TASK_NOT_FOUND', '找不到任務。');
    try {
      return (await readFile(path.join(this.store.dir, 'events', `${id}.jsonl`), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  // AI 每一步的日記變成學習候選，原文保留，等你在閘門勾選。
  addDiary(t, stageId, diary, agent) {
    if (!profileOf(t.planning.profile).diary || !diary || typeof diary !== 'object') return;
    t.planning.diary ||= [];
    for (const heading of ['interpretations', 'deviations', 'tradeoffs', 'openQuestions']) {
      for (const text of (Array.isArray(diary[heading]) ? diary[heading] : []).slice(0, 3)) {
        if (typeof text === 'string' && text.trim()) t.planning.diary.push({ id: randomUUID().slice(0, 8), stage: stageId, heading, text: text.trim().slice(0, 500), agent, status: 'candidate', at: now() });
      }
    }
  }

  async keepLearnings(id, revision, key, { keep = [], add, scope = 'project' }) {
    if (!Array.isArray(keep)) throw new TaskError(400, 'KEEP_INVALID', '保留清單格式不正確。');
    const written = [];
    const result = await this.store.mutate(id, revision, key, async t => {
      const p = t.planning;
      if (!p) throw new TaskError(400, 'NOT_PLANNING', '這個任務沒有學習日記。');
      const candidates = (p.diary || []).filter(d => d.status === 'candidate');
      for (const entry of candidates) entry.status = keep.includes(entry.id) ? 'kept' : 'dismissed';
      if (add?.text?.trim()) {
        if (!HEADINGS[add.heading] && add.heading !== 'openQuestions') throw new TaskError(400, 'HEADING_INVALID', '請選擇詮釋、偏離、取捨或未決問題。');
        const entry = { id: randomUUID().slice(0, 8), stage: 'human', heading: add.heading, text: add.text.trim().slice(0, 500), agent: '你', status: 'kept', at: now() };
        (p.diary ||= []).push(entry);
        candidates.push(entry);
      }
      for (const entry of candidates.filter(e => e.status === 'kept')) {
        // 未決問題是待研究事項，不升級成規則。
        if (entry.heading === 'openQuestions') continue;
        const target = scope === 'team' ? 'team' : 'project';
        const res = await this.memory.append(target, t.project, HEADINGS[entry.heading], entry.text, `${t.id} · ${entry.stage === 'human' ? '你補充' : stageName(entry.stage)} · ${now().slice(0, 10)}`);
        entry.savedTo = target;
        if (res.added) written.push({ ...entry, scope: target });
      }
      return { status: planningStatus(t) };
    }, 'learn', { keep, add, scope });
    await this.audit(id, 'LEARNING_KEPT', { kept: keep, added: add?.text || '', scope, written: written.map(w => w.text) });
    return { ...result, written };
  }

  async reflect(id, revision, key, { turnId, answer }) {
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 2000) throw new TaskError(400, 'ANSWER_REQUIRED', '請先寫下回想，最多 2000 字。');
    const result = await this.store.mutate(id, revision, key, t => {
      const turn = t.planning?.learningTurns?.find(entry => entry.id === turnId);
      if (!turn?.learning?.question) throw new TaskError(404, 'TURN_NOT_FOUND', '找不到這次的回想問題。');
      turn.reflection = { answer: answer.trim(), at: now() };
      return { status: planningStatus(t) };
    }, 'reflect', { turnId, answer });
    await this.audit(id, 'TURN_REFLECTION', { turnId, answer: answer.trim() });
    return result;
  }

  // 服務重啟時，上次沒跑完的步驟結果未知：清掉 running，留下紀錄，不假裝成功或自動重跑。
  async recover() {
    for (const listed of await this.store.list()) {
      if (!listed.planning?.running) continue;
      const running = listed.planning.running;
      await this.store.mutate(listed.id, listed.revision, null, t => {
        t.planning.running = null;
        if (t.planning.autopilot) { t.planning.autopilot = null; }
        // 停止請求送出後服務就重啟：無法確認 CLI 是否結束，仍記為已停止，讓你核對後接續。
        if (running.stopping) t.planning.stopped = { stage: running.stage, itemId: running.workItemId || null, agent: running.agent, turnId: running.turnId, phase: t.planning.phase, startedAt: running.startedAt, at: now(), changed: [], afterRestart: true };
        const turn = t.planning.learningTurns?.find(entry => entry.id === running.turnId);
        if (turn) Object.assign(turn, { status: 'unknown', completedAt: now(), error: '服務重啟，結果未知。' });
        t.planning.messages.push({ id: randomUUID(), role: 'system', stage: running.stage, text: `服務重啟時，${stageName(running.stage)}（${running.agent}）沒有完成，結果未知。請檢查產出資料夾後重新執行。`, at: now() });
        return { status: planningStatus(t) };
      });
    }
  }

  // 停止這次執行：先標「正在停止」，等 CLI 的 close 事件確認結束才標「已停止」。
  // 5 秒沒結束改送 SIGKILL；15 秒仍無法確認就標「尚未確認停止」，期間不放行新執行與移除。
  async stop(id, { graceMs = 5000, confirmMs = 15000 } = {}) {
    const task = await this.latest(id);
    if (!task.planning?.running) throw new TaskError(409, 'NOTHING_RUNNING', '目前沒有正在執行的 AI。');
    if (this.cancelled.has(id)) return { stopping: true, task: (await this.store.get(id)).task };
    this.cancelled.add(id);
    const requestedAt = now();
    const result = await this.store.mutate(id, 'latest', null, t => {
      if (t.planning.running) t.planning.running.stopping = { requestedAt, unconfirmed: false };
      return { status: planningStatus(t) };
    });
    await this.audit(id, 'STOP_REQUESTED', { stage: task.planning.running.stage, turnId: task.planning.running.turnId });
    const child = this.children.get(id);
    killTree(child, 'SIGTERM');
    const kill = setTimeout(() => killTree(this.children.get(id), 'SIGKILL'), graceMs);
    const flag = setTimeout(async () => {
      if (!this.pending.has(id)) return;
      await this.store.mutate(id, 'latest', null, t => {
        if (t.planning.running?.stopping) t.planning.running.stopping.unconfirmed = true;
        return { status: planningStatus(t) };
      }).catch(() => {});
      await this.audit(id, 'STOP_UNCONFIRMED', {});
    }, confirmMs);
    kill.unref?.(); flag.unref?.();
    this.pending.get(id)?.finally(() => { clearTimeout(kill); clearTimeout(flag); });
    return { stopping: true, task: result.task };
  }

  cancel(id) { return this.stop(id); }

  // ── 一路做到完：你按一次就是授權整條鏈。只有需要你的地方才停下來，並寫清楚為什麼 ──
  static AUTO_MAX_FIX = 2;

  // 下一步該做什麼，或該停在哪裡等人。回傳 { run } 或 { stop: { kind, label, ... } }。
  nextStep(t, ap) {
    const p = t.planning;
    if (p.phase === 'done') return { finish: true };
    if (p.phase === 'grill') {
      const turn = p.learningTurns?.at(-1);
      if (!p.card.title || (turn?.stage === 'A' && turn.status === 'failed')) return { run: () => this.formulate(t.id) };
      if (p.readyForOutline) return { run: () => this.draftOutline(t.id) };
      const last = p.messages.filter(m => m.role !== 'system').at(-1);
      if (last?.role === 'ai' && last.stage === 'B' && last.questions?.length) return { stop: { kind: 'answer', label: `回答 AI 的 ${last.questions.length} 個問題` } };
      return { run: () => this.grill(t.id) };
    }
    if (p.phase === 'outline') return ap.full ? { run: () => this.approveOutlineAuto(t.id) } : { stop: { kind: 'approve', label: '看 AI 的計畫，沒問題就核准' } };
    const items = p.workItems || [];
    const aiItems = items.filter(i => i.owner === 'ai');
    const fixed = ap.fixRounds || {};
    const failing = aiItems.find(i => i.status === 'REVIEW_FAIL');
    if (failing && (fixed[failing.id] || 0) < Coach.AUTO_MAX_FIX) return { run: () => this.fix(t.id, failing.id), fixItem: failing.id };
    const reviewable = aiItems.find(i => i.status === 'AWAITING_REVIEW');
    if (reviewable) return { run: () => this.review(t.id, reviewable.id) };
    const todo = aiItems.find(i => i.status === 'TODO' && ready(items, i, unlockOf(t)));
    if (todo) return { run: () => this.execute(t.id, todo.id) };
    // AI 能做的都做完了，剩下的要人處理
    if (failing) return { stop: { kind: 'fix-limit', label: `${itemName(failing.id)}「${failing.title}」自動修了 ${Coach.AUTO_MAX_FIX} 輪仍沒通過，請看驗收意見後決定`, itemId: failing.id } };
    const blocked = aiItems.find(i => i.status === 'BLOCKED');
    if (blocked) {
      const b = blocked.blocked || {};
      const why = b.kind === 'tool' ? '做不下去' : '需要你補資訊';
      return { stop: { kind: 'needs-info', blocked: b.kind || 'info', label: `${itemName(blocked.id)}「${blocked.title}」${why}${b.reason ? `：${b.reason}` : ''}${b.count > 1 ? `（同一原因第 ${b.count} 次）` : ''}`, itemId: blocked.id } };
    }
    const reviewed = aiItems.filter(i => i.status === 'REVIEWED');
    if (reviewed.length) return { stop: { kind: 'confirm', label: `確認 ${reviewed.length} 項 AI 驗收通過的成果（${itemNames(reviewed.map(i => i.id))}）` } };
    const human = items.find(i => i.owner === 'human' && i.status === 'TODO' && ready(items, i));
    if (human) return { stop: { kind: 'human', label: `輪到你：${human.title}`, itemId: human.id } };
    return { stop: { kind: 'wait', label: '等前置項目完成' } };
  }

  approveOutlineAuto(id) {
    // 完全自動：大綱視為通過。仍寫入稽核事件，標明是自動通過。
    return this.latest(id).then(t => this.store.mutate(id, t.revision, null, x => {
      if (x.planning.phase !== 'outline') throw new TaskError(409, 'WRONG_PHASE', '目前沒有待確認的計畫。');
      x.planning.phase = 'execute';
      x.next = '依工作項目順序執行；每項完成後讓 AI 檢查，再由你確認。';
      return { status: planningStatus(x) };
    }, 'approve-auto', {})).then(async r => { await this.audit(id, 'GATE_AUTO_APPROVED', { stage: 'C', note: '完全自動模式，計畫自動通過' }); return { done: Promise.resolve(r), task: r.task }; });
  }

  async setAutopilot(id, revision, key, { full = false, on = true, provider = null } = {}) {
    const result = await this.store.mutate(id, revision, key, t => {
      if (!t.planning) throw new TaskError(400, 'NOT_PLANNING', '這個任務不是教練流程。');
      if (t.trashed) throw new TaskError(409, 'TASK_TRASHED', '任務在回收桶，請先還原。');
      if (!on) { t.planning.autopilot = null; return { status: planningStatus(t) }; }
      if (t.planning.running?.stopping) throw new TaskError(409, 'AGENT_STOPPING', '正在停止，等停止完成再開始。');
      t.planning.autopilot = { full: Boolean(full), startedAt: now(), fixRounds: {}, waitingFor: null, go: true };
      return { status: planningStatus(t) };
    }, 'autopilot', { full, on, provider });
    await this.audit(id, on ? 'AUTOPILOT_ON' : 'AUTOPILOT_OFF', { full: Boolean(full), provider: provider || undefined });
    if (on) { if (provider) this.overrides.set(id, provider); this.drive(id); }
    return result;
  }

  resumeAuto(id) {
    this.latest(id).then(t => { if (t.planning?.autopilot && !t.planning.stopped) this.drive(id); }).catch(() => {});
  }

  async park(id, waitingFor) {
    await this.store.mutate(id, 'latest', null, t => {
      if (!t.planning.autopilot) return { status: planningStatus(t) };
      startFeedback(t.planning);
      t.planning.autopilot.waitingFor = { ...waitingFor, at: now() };
      return { status: planningStatus(t) };
    });
    await this.audit(id, 'AUTOPILOT_PARKED', waitingFor);
  }

  async endAuto(id, note) {
    await this.store.mutate(id, 'latest', null, t => {
      if (!t.planning.autopilot) return { status: planningStatus(t) };
      t.planning.autopilot = null;
      if (note) t.planning.messages.push({ id: randomUUID(), role: 'system', stage: 'C', text: note, at: now() });
      return { status: planningStatus(t) };
    });
    await this.audit(id, 'AUTOPILOT_ENDED', { note });
  }

  // 背景驅動：一次只會有一個。每一步都重新讀任務檔判斷，所以人隨時插手也不會衝突。
  async drive(id) {
    if (this.drivers.has(id)) return;
    this.drivers.add(id);
    try {
      for (let guard = 0; guard < 120; guard++) {
        await this.pending.get(id)?.catch(() => {});
        let t = await this.latest(id);
        const ap = t.planning?.autopilot;
        if (!ap || t.trashed) return;
        if (t.planning.stopped || t.planning.running?.stopping) { await this.endAuto(id, '你停止了這次執行，自動模式已關閉。要繼續請再按「交給 AI 一路做到完」。'); return; }
        if (t.planning.running) { await new Promise(r => setTimeout(r, 200)); continue; }
        // 上一步剛失敗而且不是你按了「繼續」：停下來說明，不自動重試
        const lastTurn = t.planning.learningTurns?.at(-1);
        if (guard === 0 && !ap.go && lastTurn?.status === 'failed') { await this.park(id, { kind: 'error', code: lastTurn.errorCode || 'FAILED', label: lastTurn.error || 'AI 沒有完成這一步。', stage: lastTurn.stage }); return; }
        const step = this.nextStep(t, ap);
        if (step.finish) { await this.endAuto(id, ''); return; }
        if (step.stop) { await this.park(id, step.stop); return; }
        if (ap.waitingFor) await this.store.mutate(id, 'latest', null, x => { if (x.planning.autopilot) x.planning.autopilot.waitingFor = null; return { status: planningStatus(x) }; });
        if (step.fixItem) await this.store.mutate(id, 'latest', null, x => { const a = x.planning.autopilot; if (a) a.fixRounds = { ...(a.fixRounds || {}), [step.fixItem]: (a.fixRounds?.[step.fixItem] || 0) + 1 }; return { status: planningStatus(x) }; });
        let started;
        try { started = await step.run(); }
        catch (error) {
          if (error.code === 'AGENT_BUSY') { await new Promise(r => setTimeout(r, 200)); continue; }
          await this.park(id, { kind: 'error', code: error.code || 'FAILED', label: error.message, stage: null }); return;
        } finally { this.overrides.delete(id); }
        const result = await started.done;
        if (result?.stopped) { await this.endAuto(id, '你停止了這次執行，自動模式已關閉。要繼續請再按「交給 AI 一路做到完」。'); return; }
        if (result?.error) { const stage = (await this.latest(id)).planning.learningTurns?.at(-1)?.stage || null; await this.park(id, { kind: 'error', code: result.error.code, label: result.error.message, stage }); return; }
      }
      await this.park(id, { kind: 'error', code: 'AUTOPILOT_LIMIT', label: '自動步數超過上限，已停下避免無限執行。', stage: null });
    } catch (error) {
      console.error(error);
      await this.park(id, { kind: 'error', code: 'AUTOPILOT_FAILED', label: error.message, stage: null }).catch(() => {});
    } finally { this.drivers.delete(id); }
  }

  // 一次確認所有 AI 驗收通過的項目。仍是你按下的確認，不是系統代按。
  confirmAll(id, revision, key) {
    return this.store.mutate(id, revision, key, t => {
      const items = (t.planning?.workItems || []).filter(i => i.owner === 'ai' && i.status === 'REVIEWED');
      if (!items.length) throw new TaskError(409, 'NOTHING_TO_CONFIRM', '目前沒有等你確認的成果。');
      startFeedback(t.planning);
      for (const item of items) Object.assign(item, { status: 'DONE', humanNote: '', doneAt: now() });
      if (t.planning.workItems.every(i => i.status === 'DONE')) { t.planning.phase = 'done'; t.current.summary = `全部 ${t.planning.workItems.length} 個工作項目已由你確認。`; }
      return { status: planningStatus(t) };
    }, 'confirm-all', {}).then(async r => { await this.audit(id, 'ITEMS_CONFIRMED', { items: r.task.planning.workItems.filter(i => i.doneAt && Date.now() - Date.parse(i.doneAt) < 5000).map(i => i.id) }); return r; });
  }

  // 中斷期間有變動的檔案：可能只寫了一半，接續前要核對，不算完成。
  async changedSince(dir, since, depth = 2, prefix = '') {
    const found = [];
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
    for (const e of entries.filter(e => !e.name.startsWith('.'))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) found.push(...await this.changedSince(full, since, depth - 1, `${prefix}${e.name}/`));
      else if (e.isFile()) { try { if ((await stat(full)).mtimeMs >= Date.parse(since) - 1000) found.push(`${prefix}${e.name}`); } catch {} }
    }
    return found.slice(0, 30);
  }

  async listing(dir) {
    try {
      const names = (await readdir(dir)).filter(n => !n.startsWith('.')).slice(0, 40);
      const rows = await Promise.all(names.map(async n => { const s = await stat(path.join(dir, n)); return `- ${n}${s.isDirectory() ? '/' : `（${Math.round(s.size / 1024)} KB）`}`; }));
      return rows.join('\n') || '- （空資料夾）';
    } catch { return '- （無法讀取）'; }
  }

  // override：只換這一次的 AI，不改角色設定。沿用設定裡該 AI 已選的模型，沒有就用 CLI 預設。
  // 任務自己的 AI 優先，沒設定才用全域角色設定。F 沿用 D 時也沿用任務對 D 的設定。
  agentFor(stageId, override = null, task = null) {
    const own = task?.planning?.agents || {};
    const sameAsD = stageId === 'F' && !own.F && (this.settings().stages?.F?.provider ?? 'same-as-D') === 'same-as-D';
    let agent = own[stageId] || (sameAsD && own.D) || resolveStage(this.settings(), stageId);
    if (override && override !== agent.provider) {
      if (!['codex', 'claude', 'copilot'].includes(override)) throw new TaskError(400, 'PROVIDER_INVALID', '只能改用 Codex、Claude Code 或 GitHub Copilot。');
      const used = Object.values(this.settings().stages || {}).find(v => v?.provider === override);
      agent = used ? { provider: override, modelId: used.modelId, effort: used.effort } : { provider: override, modelId: null, effort: null };
    }
    const mode = stages.find(s => s.id === stageId).mode;
    const allowed = { codex: ['chat', 'read', 'write'], claude: ['chat', 'read', 'write'], copilot: ['chat', 'read', 'write'] }[agent.provider] || [];
    if (!allowed.includes(mode)) throw new TaskError(400, 'AGENT_NOT_RUNNABLE', `${stageName(stageId)}指派的 AI 不能做這一步（需要${{ chat: '只對話', read: '唯讀資料夾', write: '寫產出資料夾' }[mode]}），請在設定改選 Codex 或 Claude Code。`);
    return agent;
  }

  async latest(id) {
    return (await this.store.get(id)).task;
  }

  // AI 在背景執行：先標記 running 並立即回應，跑完再用最新 revision 寫回結果。
  async withAgent(id, stageId, mode, cwd, buildPrompt, apply, metadata = {}) {
    let task = await this.latest(id);
    const agent = this.agentFor(stageId, metadata.provider || this.overrides.get(id), task);
    task.folderListing = await this.listing(task.allowedRoots[0]);
    if (task.planning.running || this.pending.has(id)) throw new TaskError(409, 'AGENT_BUSY', 'AI 還在進行中，等它完成再操作。');
    if (task.trashed) throw new TaskError(409, 'TASK_TRASHED', '任務在回收桶，請先還原。');
    const stopped = task.planning.stopped;
    const resuming = stopped && stopped.stage === stageId && (stopped.itemId || null) === (metadata.workItemId || null);
    const resumeNote = resuming ? `\n\n【接續說明】上一次「${stageName(stageId)}」在執行中被使用者停止，沒有完成。${stopped.changed?.length ? `中斷期間有變動的檔案：${stopped.changed.join('、')}。這些檔案可能只寫了一半，不能直接當成完成。` : ''}請先核對產出資料夾現有檔案與任務卡最新版本，沿用已確認的成果，再把這一步做完。` : '';
    const instructionNote = metadata.instruction ? `\n\n【使用者最新補充指示（優先於先前內容，原文）】\n${metadata.instruction}` : '';
    const prompt = `${buildPrompt(task)}${resumeNote}${instructionNote}\n\n${LEARNING}`;
    const lastReply = task.planning.messages.filter(m => m.role === 'user' && m.stage === stageId).at(-1);
    const item = metadata.workItemId && task.planning.workItems.find(w => w.id === metadata.workItemId);
    const userInput = metadata.userInput ?? lastReply?.text ?? (item ? `${stageName(stageId)}：${item.title}${stageId === 'F' ? `\n修正意見：${(item.fixes || []).join('\n')}` : ''}` : `${stageName(stageId)}：依目前任務卡接續`);
    const inputKind = metadata.inputKind || (lastReply ? 'user' : stageId === 'B' ? 'automatic' : 'action');
    const turnId = randomUUID();
    const started = await this.store.mutate(id, task.revision, null, t => {
      const startedAt = now();
      (t.planning.learningTurns ||= []).push({ id: turnId, stage: stageId, provider: agent.provider, modelId: agent.modelId, effort: agent.effort, agent: agentLabel(agent), startedAt, status: 'running', prompt, userInput, inputKind, workItemId: metadata.workItemId || null, beforeRevision: task.revision });
      t.planning.running = { stage: stageId, provider: agent.provider, modelId: agent.modelId, effort: agent.effort, agent: agentLabel(agent), startedAt, turnId, workItemId: metadata.workItemId || null, mode };
      t.planning.stopped = null;
      return { status: 'RUNNING' };
    });
    await this.audit(id, 'STAGE_STARTED', { stage: stageId, agent: agentLabel(agent), turnId, prompt });
    const done = (async () => {
     try {
      let result, failure;
      try {
        result = await runAgent({ ...agent, mode, cwd, prompt, onSpawn: child => { this.children.set(id, child); if (this.cancelled.has(id)) child.kill('SIGTERM'); } });
      } catch (error) {
        failure = this.cancelled.has(id) ? new AgentError('AGENT_CANCELLED', '你已停止這次執行。') : error;
      } finally {
        this.children.delete(id);
        this.cancelled.delete(id);
      }
      task = await this.latest(id);
      if (failure) await this.audit(id, failure.code === 'AGENT_CANCELLED' ? 'STAGE_STOPPED' : 'STAGE_FAILED', { stage: stageId, agent: agentLabel(agent), code: failure.code, message: failure.message });
      const changed = failure?.code === 'AGENT_CANCELLED' && mode === 'write' ? await this.changedSince(cwd, task.planning.running?.startedAt || now()) : [];
      return this.store.mutate(id, 'latest', null, async t => {
        const running = t.planning.running;
        t.planning.running = null;
        const turn = t.planning.learningTurns.find(entry => entry.id === turnId);
        turn.completedAt = now();
        if (failure?.code === 'AGENT_CANCELLED') {
          // 已確認 CLI 結束：中斷步驟沒有完成，保留對話與檔案，等使用者決定接續。
          Object.assign(turn, { status: 'stopped', error: failure.message, errorCode: 'AGENT_CANCELLED', changed });
          t.planning.stopped = { stage: stageId, itemId: metadata.workItemId || null, agent: agentLabel(agent), turnId, phase: t.planning.phase, startedAt: running?.startedAt || null, at: now(), changed, replan: stageId === 'C' && t.planning.phase === 'execute' };
          t.planning.messages.push({ id: randomUUID(), role: 'system', stage: stageId, text: `你停止了${stageName(stageId)}${metadata.workItemId ? ` ${metadata.workItemId}` : ''}（${agentLabel(agent)}），已確認 CLI 結束。這一步沒有完成${changed.length ? `；產出資料夾有 ${changed.length} 個檔案在這段期間變動，可能只寫了一半，接續時會先核對` : ''}。`, at: now() });
          if (t.planning.autopilot) { t.planning.autopilot = null; t.planning.messages.push({ id: randomUUID(), role: 'system', stage: stageId, text: '你停止了這次執行，自動模式已關閉。要繼續請再按「交給 AI 一路做到完」。', at: now() }); }
          return { status: planningStatus(t), extra: { stopped: true, error: { code: 'AGENT_CANCELLED', message: failure.message } } };
        }
        if (failure) {
          Object.assign(turn, { status: 'failed', error: failure.message, errorCode: failure.code || 'AGENT_FAILED' });
          if (failure.code === 'AGENT_FILTERED') turn.response = failure.detail;
          t.planning.messages.push({ id: randomUUID(), role: 'system', stage: stageId, text: `${stageName(stageId)}沒有完成（${agentLabel(agent)}）：${failure.message}${failure.detail ? `\n${failure.detail.slice(-400)}` : ''}`, at: now() });
          return { status: planningStatus(t), extra: { error: { code: failure.code || 'AGENT_FAILED', message: failure.message } } };
        }
        turn.response = result.text;
        // 回覆解析失敗也留住當次 prompt，且不讓任務永遠卡在 running。
        const draft = structuredClone(t);
        try { await apply(draft, result.text, agentLabel(agent)); }
        catch (error) {
          await this.audit(id, 'STAGE_FAILED', { stage: stageId, agent: agentLabel(agent), code: 'RESPONSE_INVALID', message: error.message });
          Object.assign(turn, { status: 'failed', error: error.message, errorCode: 'RESPONSE_INVALID' });
          t.planning.messages.push({ id: randomUUID(), role: 'system', stage: stageId, text: `回覆無法使用：${error.message}。當次 prompt 與回覆已保留，可檢查後重試。`, at: now() });
          return { status: planningStatus(t), extra: { error: { code: 'RESPONSE_INVALID', message: error.message } } };
        }
        const completed = draft.planning.learningTurns.find(entry => entry.id === turnId);
        completed.status = 'completed';
        completed.afterRevision = t.revision + 1;
        completed.outputs = metadata.workItemId ? draft.planning.workItems.find(w => w.id === metadata.workItemId)?.outputs || [] : [];
        const learning = extractJson(result.text)?.learning;
        completed.learning = Object.fromEntries(['change', 'reason', 'evidence', 'lesson', 'nextPrompt', 'question'].map(key => [key, typeof learning?.[key] === 'string' ? learning[key].trim().slice(0, 2000) : '']));
        completed.learningStatus = Object.values(completed.learning).every(Boolean) ? 'suggested' : 'pending';
        if (completed.learning.lesson && !(draft.planning.diary || []).some(d => d.stage === stageId && d.text === completed.learning.lesson)) {
          this.addDiary(draft, stageId, { interpretations: [completed.learning.lesson] }, agentLabel(agent));
        }
        Object.assign(t, draft);
        await this.audit(id, 'STAGE_COMPLETED', { stage: stageId, agent: agentLabel(agent) });
        return { status: planningStatus(t) };
      });
     } finally {
      // 在 done 解決之前就移除，接續的下一個階段才不會被誤判為忙碌。
      this.pending.delete(id);
     }
    })();
    this.pending.set(id, done);
    done.catch(error => console.error(error));
    return { ...started, done };
  }

  // 「provider|modelKey」轉成任務的 AI 設定；inherit 表示沿用角色設定。
  static parseAgents(input) {
    if (input == null || input === 'inherit') return null;
    const [provider, key = 'default'] = String(input).split('|');
    if (!providers.some(p => p.id === provider && p.runnable)) throw new TaskError(400, 'PROVIDER_INVALID', '找不到這個 AI。');
    try { return resolveModel(provider, key); } catch { throw new TaskError(400, 'MODEL_INVALID', '這個 AI 沒有這個模型。'); }
  }

  // 整個任務改用同一個 AI 與模型；只影響之後的執行。
  async setAgents(id, revision, key, { all }) {
    const agent = Coach.parseAgents(all);
    return this.store.mutate(id, revision, key, t => {
      if (!t.planning) throw new TaskError(400, 'NOT_PLANNING', '這個任務不是教練流程。');
      t.planning.agents = agent ? Object.fromEntries(stages.map(s => [s.id, agent])) : null;
      return { status: planningStatus(t) };
    }, 'agents', { all }).then(async r => { await this.audit(id, 'AGENTS_SET', { all: all || 'inherit' }); return r; });
  }

  async create({ request, outputDir, profile = 'standard', project = '', autopilot = false, full = false, agent = null }) {
    const chosen = Coach.parseAgents(agent);
    if (!['quick', 'standard', 'thorough'].includes(profile)) throw new TaskError(400, 'PROFILE_INVALID', '工作流程只能是快速、標準或完整。');
    if (typeof request !== 'string' || request.trim().length < 4 || request.length > 6000) throw new TaskError(400, 'REQUEST_INVALID', '請用一兩句話描述想完成的事。');
    if (typeof project !== 'string' || project.length > 40) throw new TaskError(400, 'PROJECT_INVALID', '專案名稱最多 40 字。');
    project = project.trim();
    const id = `TASK-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
    const out = outputDir?.trim() ? path.resolve(outputDir.trim()) : path.join(this.root, 'outputs', id);
    if (!path.isAbsolute(out)) throw new TaskError(400, 'OUTPUT_INVALID', '產出資料夾需要是絕對路徑。');
    await mkdir(out, { recursive: true });
    const real = await realpath(out);
    const baseline = [];
    for (const name of (await readdir(real)).filter(n => !n.startsWith('.')).slice(0, 40)) {
      const full = path.join(real, name);
      const info = await stat(full);
      if (info.isFile() && info.size <= 50 * 1024 * 1024) baseline.push({ file: name, sha: sha256(await readFile(full)) });
    }
    const task = {
      id, revision: 1, status: 'BLOCKED', updatedAt: now(), prelude: `\n# ${request.trim().slice(0, 40)}\n\n> Mentor建立的任務。人工筆記寫在最下方。\n\n`, notes: '\n\n## 人工筆記\n',
      title: request.trim().slice(0, 30), project: project || '未分類', goal: request.trim(),
      workspace: { label: path.basename(real), root: real }, allowedRoots: [real],
      scope: { allowed: ['只在產出資料夾內建立或修改檔案'], locked: [], forbidden: ['對外發布、上傳或寄送', '修改產出資料夾以外的檔案'] },
      current: { summary: '剛建立，正在整理任務卡。', artifact: null, sources: [] },
      decisions: [], checks: [], facts: [], learnings: [], parked: [], reports: [],
      next: '先完成需求釐清，再讓 AI 擬計畫。',
      planning: { phase: 'grill', profile, projectLocked: Boolean(project), projectBrief: await new Projects(path.join(this.root,'vault','projects')).context(project || '未分類'), rules: await this.memory.rules(project || '未分類'), diary: [], request: request.trim(), card: { title: '', project: project || '未分類', goal: request.trim(), audience: '', deliverable: '', success: [], constraints: [], unknowns: [] }, messages: [{ id: randomUUID(), role: 'user', stage: 'A', text: request.trim(), at: now() }], outline: null, workItems: [], running: null, readyForOutline: false, baseline, agents: chosen ? Object.fromEntries(stages.map(s => [s.id, chosen])) : null, feedback: [], feedbackSince: now(), feedbackBrief: feedbackBrief(await this.store.list(), project || '未分類') }
    };
    await this.store.create(task);
    await this.audit(id, 'TASK_CREATED', { request: request.trim(), profile, outputDir: real });
    const started = await this.formulate(id);
    if (autopilot) {
      await this.store.mutate(id, 'latest', null, t => { t.planning.autopilot = { full: Boolean(full), startedAt: now(), fixRounds: {}, waitingFor: null }; return { status: 'RUNNING' }; });
      await this.audit(id, 'AUTOPILOT_ON', { full: Boolean(full) });
      this.drive(id);
      return { ...started, done: started.done };
    }
    // A 完成且沒有錯誤，就接著讓 B 開始問。
    const chained = started.done.then(result => result.error ? result : this.grill(id).then(next => next.done));
    return { ...started, done: chained };
  }

  formulate(id, instruction = '', provider = null) {
    return this.withAgent(id, 'A', 'chat', null, t => prompts.A(t), async (t, text, agent) => {
      const json = extractJson(text);
      if (!json?.card || typeof json.card.title !== 'string' || !json.card.title.trim() || typeof json.card.goal !== 'string' || !json.card.goal.trim()) throw new AgentError('RESPONSE_INVALID', '任務制定沒有回傳可用的任務卡，請重試。');
      if (json?.card) {
        t.planning.card = { ...t.planning.card, ...json.card };
        t.title = json.card.title || t.title;
        t.goal = json.card.goal || t.goal;
        t.current.summary = `任務卡已建立。讀者：${json.card.audience || '未定'}；產出：${json.card.deliverable || '未定'}。`;
        // 知道專案後，補上專案規則。規則在任務開始時定案，之後不再變動。
        if (!t.planning.projectLocked && json.card.project && json.card.project !== '未分類') {
          t.project = String(json.card.project).slice(0, 40);
          t.planning.rules = await this.memory.rules(t.project);
          t.planning.projectBrief = await new Projects(path.join(this.root,'vault','projects')).context(t.project);
          t.planning.feedbackBrief = feedbackBrief(await this.store.list(), t.project);
        }
        if (t.planning.projectLocked) t.planning.card.project = t.project;
      }
      this.addDiary(t, 'A', json?.diary, agent);
      t.planning.messages.push({ id: randomUUID(), role: 'ai', stage: 'A', agent, text: json ? '我先把你的需求整理成任務卡，缺的部分放在「未知」。' : text, coaching: json?.coaching || '', card: json?.card || null, parseError: !json, at: now() });
    }, { provider, ...(instruction ? { instruction, userInput: instruction, inputKind: 'user' } : {}) });
  }

  retry(id, revision, key, provider = null) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(key)) throw new TaskError(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key。');
    const previous = this.retries.get(key);
    if (previous) {
      if (previous.id !== id || previous.revision !== revision || previous.provider !== provider) throw new TaskError(409, 'IDEMPOTENCY_KEY_REUSED', '同一個 Idempotency-Key 用在不同操作。');
      return previous.run;
    }
    const run = this.retryGrill(id, revision, key, provider);
    if (this.retries.size >= 500) this.retries.delete(this.retries.keys().next().value);
    this.retries.set(key, { id, revision, provider, run });
    run.catch(() => this.retries.delete(key));
    return run;
  }

  async retryGrill(id, revision, key, provider = null) {
    const result = await this.store.mutate(id, revision, key, t => {
      if (t.planning?.phase !== 'grill' || t.planning.running) throw new TaskError(409, 'NOT_GRILLING', '只能重試尚未完成且沒有執行中的需求釐清。');
      return {};
    }, 'retry');
    const t = result.task;
    const failed = t.planning.learningTurns?.at(-1);
    if (!t.planning.card.title || failed?.stage === 'A' && failed.status === 'failed') {
      const started = await this.formulate(id, '', provider);
      return { ...started, done: started.done.then(r => r.error ? r : this.grill(id, provider).then(next => next.done)) };
    }
    return this.grill(id, provider);
  }

  async answer(id, revision, key, { message }) {
    if (typeof message !== 'string' || !message.trim()) throw new TaskError(400, 'MESSAGE_REQUIRED', '請先寫下回答。');
    await this.store.mutate(id, revision, key, t => {
      if (t.planning?.phase !== 'grill') throw new TaskError(409, 'NOT_GRILLING', '這個任務已經過了 Grill 階段。');
      t.planning.messages.push({ id: randomUUID(), role: 'user', stage: 'B', text: message.trim().slice(0, 6000), at: now() });
      t.planning.readyForOutline = false;
      return { status: 'RUNNING' };
    }, 'answer', { message });
    await this.audit(id, 'HUMAN_REPLY', { stage: 'B', text: message.trim() });
    return this.grill(id);
  }

  grill(id, provider = null) {
    return this.withAgent(id, 'B', 'chat', null, t => prompts.B(t), (t, text, agent) => {
      const json = extractJson(text);
      if (!json || typeof json.ready !== 'boolean' || !Array.isArray(json.questions) || json.questions.some(q => typeof q?.q !== 'string' || !q.q.trim()) || !json.ready && !json.questions.length) throw new AgentError('RESPONSE_INVALID', '需求釐清沒有回傳可回答的問題或完成判斷，請重試。');
      if (json?.card) {
        t.planning.card = { ...t.planning.card, ...json.card };
        if (t.planning.projectLocked) t.planning.card.project = t.project;
        t.title = json.card.title || t.title;
        t.goal = json.card.goal || t.goal;
      }
      t.planning.readyForOutline = Boolean(json?.ready);
      this.addDiary(t, 'B', json?.diary, agent);
      t.planning.messages.push({ id: randomUUID(), role: 'ai', stage: 'B', agent, text: json ? (json.ready ? `資訊夠了，可以讓 AI 擬計畫。${json.readyReason || ''}` : '') : text, questions: json?.questions || [], coaching: json?.coaching || '', parseError: !json, at: now() });
    }, { provider });
  }

  async draftOutline(id, feedback = '', { replan = false, instruction = '' } = {}) {
    feedback = String(feedback || '').trim().slice(0, 4000);
    const current = await this.latest(id);
    // 接續被停止的擬大綱，或已確認大綱要改：這兩種允許在其他階段重新擬定。
    replan ||= Boolean(current.planning?.stopped?.stage === 'C' && current.planning.stopped.replan);
    if (feedback && current.planning?.phase !== 'outline' && !replan && current.planning?.stopped?.stage !== 'C') throw new TaskError(409, 'WRONG_PHASE', '目前沒有可以修改的計畫。');
    const started = await this.withAgent(id, 'C', 'read', current.allowedRoots[0], t => {
      if (t.planning.phase !== 'grill' && t.planning.phase !== 'outline' && !(replan && t.planning.phase === 'execute')) throw new TaskError(409, 'WRONG_PHASE', '計畫已確認，不能重新擬定。');
      const keep = replan ? `\n\n【已確認大綱的修改】這份大綱已經確認、正在執行。沿用既有工作項目的 id；沒有要改的項目保持標題與驗收標準原樣，已完成的成果會保留。目前狀態：${t.planning.workItems.map(w => `${w.id}「${w.title}」${w.status}`).join('、')}` : '';
      return prompts.C(t, feedback || (replan ? '依使用者補充指示修改已確認的大綱' : '')) + keep;
    }, (t, text, agent) => {
      const json = extractJson(text);
      if (!json?.outline || !Array.isArray(json.workItems)) {
        throw new AgentError('RESPONSE_INVALID', '擬計畫的回覆缺少可解析的 outline 或 workItems。');
      }
      t.planning.outline = { ...json.outline, coaching: json.coaching || '', agent, at: now(), version: (t.planning.outline?.version || 0) + 1, feedback: feedback || null };
      t.planning.outline.sensors = outlineSensors(t.planning.outline);
      const items = json.workItems.slice(0, 20).map((w, i) => ({
        id: /^[A-Za-z0-9-]{1,12}$/.test(w.id) ? w.id : `W${i + 1}`, title: String(w.title || `工作 ${i + 1}`), detail: String(w.detail || ''),
        owner: w.owner === 'human' ? 'human' : 'ai', acceptance: (w.acceptance || []).map(String).slice(0, 6), dependsOn: (w.dependsOn || []).map(String), status: 'TODO', attempts: 0, outputs: [], review: null, fixes: []
      }));
      // 先做骨架由程式保證：沒有骨架項目就補一個，其他 AI 項目都等骨架完成。
      if (profileOf(t.planning.profile).skeleton && items.some(i => i.owner === 'ai')) {
        let skeleton = items.find(i => i.owner === 'ai' && /骨架/.test(i.title));
        if (!skeleton) {
          skeleton = { id: 'W0', title: '骨架版', detail: '最小但從頭到尾走得通的版本，讓你先確認方向與結構。', owner: 'ai', acceptance: ['可以從頭到尾打開瀏覽', '段落順序與計畫主線一致'], dependsOn: [], status: 'TODO', attempts: 0, outputs: [], review: null, fixes: [] };
          items.unshift(skeleton);
        }
        skeleton.skeleton = true;
        skeleton.dependsOn = [];
        for (const other of items) if (other !== skeleton && other.owner === 'ai' && !other.dependsOn.includes(skeleton.id)) other.dependsOn.push(skeleton.id);
      }
      if (replan) {
        // 已確認的項目：標題與驗收標準沒變就保留狀態與成果；有變就改回待執行，舊成果留在 previousOutputs 供核對。
        const before = new Map((t.planning.workItems || []).map(w => [w.id, w]));
        for (const [index, next] of items.entries()) {
          const old = before.get(next.id);
          if (!old) { next.added = true; continue; }
          const same = old.title === next.title && JSON.stringify(old.acceptance) === JSON.stringify(next.acceptance) && old.owner === next.owner;
          items[index] = same ? { ...old, dependsOn: next.dependsOn, detail: next.detail || old.detail } : { ...next, previousOutputs: old.outputs?.length ? old.outputs : old.previousOutputs, recheck: old.status === 'DONE' || old.status === 'REVIEWED' ? '計畫修改後內容改變，需重新執行與驗收' : null };
        }
        t.planning.removedItems = [...(t.planning.removedItems || []), ...[...before.values()].filter(w => !items.some(i => i.id === w.id)).map(w => ({ ...w, removedAt: now() }))];
      }
      t.planning.workItems = items;
      this.addDiary(t, 'C', json.diary, agent);
      t.planning.phase = 'outline';
      t.current.summary = `計畫已擬定：${json.outline.sections?.length || 0} 段、${json.outline.imageTotal ?? 0} 張圖，拆成 ${t.planning.workItems.length} 個工作項目。`;
    }, { userInput: instruction || feedback || '依目前任務卡與素材擬計畫', inputKind: instruction || feedback ? 'user' : 'action', instruction: '' });
    if (feedback) await this.audit(id, 'CHANGES_REQUESTED', { stage: 'C', text: feedback });
    return started;
  }

  approveOutline(id, revision, key) {
    return this.store.mutate(id, revision, key, t => {
      if (t.planning?.phase !== 'outline') throw new TaskError(409, 'WRONG_PHASE', '目前沒有待確認的計畫。');
      t.planning.phase = 'execute';
      t.next = '依工作項目順序執行；每項完成後讓 AI 檢查，再由你確認。';
      return { status: planningStatus(t) };
    }, 'approve', {}).then(async result => { await this.audit(id, 'GATE_APPROVED', { stage: 'C', outlineVersion: result.task.planning.outline.version }); return result; });
  }

  item(t, itemId) {
    const item = t.planning?.workItems.find(i => i.id === itemId);
    if (!item) throw new TaskError(404, 'ITEM_NOT_FOUND', '找不到這個工作項目。');
    return item;
  }

  async execute(id, itemId, stageId = 'D') {
    const outDir = (await this.latest(id)).allowedRoots[0];
    return this.withAgent(id, stageId, 'write', outDir, t => {
      const item = this.item(t, itemId);
      if (t.planning.phase !== 'execute') throw new TaskError(409, 'WRONG_PHASE', '請先核准計畫。');
      if (item.owner !== 'ai') throw new TaskError(400, 'HUMAN_ITEM', '這一項由你完成。');
      if (stageId === 'D' && item.status !== 'TODO') throw new TaskError(409, 'ITEM_STARTED', '這一項已經執行過；驗收沒過請用「讓 AI 照意見改」。');
      if (stageId === 'F' && item.status !== 'REVIEW_FAIL') throw new TaskError(409, 'NOTHING_TO_FIX', '這一項目前沒有待修正的驗收意見。');
      if (!ready(t.planning.workItems, item, unlockOf(t))) throw new TaskError(409, 'DEPENDENCY_PENDING', '前置項目還沒完成。');
      return prompts.D(t, item, t.planning.workItems.filter(i => unlockOf(t).includes(i.status))) + (item.instructions?.length ? `\n\n這一項的使用者補充指示（原文）：\n${item.instructions.map(x => `- ${x.text}`).join('\n')}` : '');
    }, async (t, text, agent) => {
      const item = this.item(t, itemId);
      const parsed = parseExecution(text);
      const outputs = [];
      for (const file of parsed.files.slice(0, 30)) {
        const full = path.resolve(outDir, file);
        try {
          const real = await realpath(full);
          if (!real.startsWith(`${outDir}${path.sep}`) || !(await stat(real)).isFile()) continue;
          outputs.push({ file: path.relative(outDir, real).split(path.sep).join('/'), sha: sha256(await readFile(real)) });
        } catch {}
      }
      item.attempts += 1;
      item.outputs = [...new Map([...(item.outputs || []), ...outputs].map(output => [output.file, output])).values()];
      item.log = [...(item.log || []), { stage: stageId, agent, status: parsed.status, text: text.slice(-4000), at: now() }].slice(-6);
      // AI 說完成卻沒有任何產出檔案，視為假完成，不送驗收
      const noFiles = parsed.status === 'DONE' && !item.outputs.length;
      item.status = parsed.status === 'DONE' && !noFiles ? 'AWAITING_REVIEW' : 'BLOCKED';
      if (noFiles) item.fixes = [...(item.fixes || []), 'AI 回報完成，但產出資料夾沒有新的檔案。請把成果寫成檔案並在 FILES 列出。'];
      if (item.status === 'BLOCKED') {
        const reason = noFiles ? '回報完成但沒有產出檔案' : parsed.missing || (parsed.parsed ? '' : '回覆沒有 STATUS 行');
        // 同一原因連續停下要讓人看得出來，免得一直補同一句話。
        item.blocked = { kind: parsed.status === 'NEEDS_INPUT' ? 'info' : 'tool', reason, count: item.blocked?.reason === reason ? item.blocked.count + 1 : 1, at: now() };
      } else item.blocked = null;
      item.executor = agent;
      item.review = null;
      item.sensors = await outputSensors(outDir, item, t.planning.outline);
      this.addDiary(t, stageId, extractJson(text)?.diary, agent);
    }, { workItemId: itemId });
  }

  // 驗收在成果的暫存副本裡跑：可以執行會寫檔的建置與測試，成果本身不會被改到。
  // 資料夾太大或複製失敗時，退回唯讀檢查原資料夾。
  async reviewCopy(outDir) {
    try {
      let size = 0;
      const walk = async dir => { for (const e of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, e.name); if (e.isDirectory()) await walk(full); else if (e.isFile()) size += (await stat(full)).size; if (size > 200 * 1024 * 1024) throw new Error('TOO_BIG'); } };
      await walk(outDir);
      const copy = path.join(await mkdtemp(path.join(tmpdir(), 'awc-review-')), path.basename(outDir));
      await cp(outDir, copy, { recursive: true, verbatimSymlinks: true });
      return copy;
    } catch { return null; }
  }

  async review(id, itemId, instruction = '') {
    const task = await this.latest(id);
    const copy = await this.reviewCopy(task.allowedRoots[0]);
    const cleanup = () => copy && rm(path.dirname(copy), { recursive: true, force: true }).catch(() => {});
    let started;
    try {
      started = await this.withAgent(id, 'E', copy ? 'write' : 'read', copy || task.allowedRoots[0], t => {
      const item = this.item(t, itemId);
      if (item.status !== 'AWAITING_REVIEW') throw new TaskError(409, 'NOT_READY_FOR_REVIEW', '這一項還沒有可驗收的成果。');
      return prompts.E(t, item, { copy: Boolean(copy) });
    }, (t, text, agent) => {
      const item = this.item(t, itemId);
      const json = extractJson(text);
      const results = (json?.results || []).map(r => ({ criterion: String(r.criterion), result: ['PASS', 'FAIL', 'NOT_RUN'].includes(r.result) ? r.result : 'NOT_RUN', evidence: String(r.evidence || '') }));
      const pass = json && json.verdict === 'PASS' && results.length && results.every(r => r.result === 'PASS');
      item.review = { agent, results, coaching: json?.coaching || '', raw: json ? '' : text.slice(0, 3000), at: now() };
      item.fixes = pass ? [] : (json?.fixes || []).map(String).filter(Boolean);
      // AI 驗收通過只是輔助證據，最後由人確認。
      item.status = pass ? 'REVIEWED' : 'REVIEW_FAIL';
      this.addDiary(t, 'E', json?.diary, agent);
    }, { workItemId: itemId, ...(instruction ? { instruction, userInput: instruction, inputKind: 'user' } : {}) });
    } catch (error) { cleanup(); throw error; }
    started.done.finally(cleanup);
    return started;
  }

  fix(id, itemId) {
    return this.execute(id, itemId, 'F');
  }

  // 依停止時的步驟重做；A 中斷要重新制定任務卡，再接 B。
  run(id, stage, itemId, extra = {}) {
    if (stage === 'A') return this.formulate(id, extra.instruction || '').then(started => ({ ...started, done: started.done.then(r => r.error ? r : this.grill(id).then(next => next.done)) }));
    if (stage === 'B') return this.grill(id);
    if (stage === 'C') return this.draftOutline(id, extra.feedback || '', extra);
    if (stage === 'D') return this.execute(id, itemId, 'D');
    if (stage === 'E') return this.review(id, itemId, extra.instruction || '');
    if (stage === 'F') return this.fix(id, itemId);
    throw new TaskError(400, 'STAGE_INVALID', '未知的階段。');
  }

  // 補充指示的去向與影響。只有接續、修改已確認大綱、已確認項目或新一輪才需要影響摘要。
  plan(t, { text = '', scope = 'current' } = {}) {
    const p = t.planning;
    if (!p) throw new TaskError(400, 'NOT_PLANNING', '這個任務不是教練流程。');
    if (t.trashed) throw new TaskError(409, 'TASK_TRASHED', '任務在回收桶，請先還原。');
    if (p.running?.stopping) throw new TaskError(409, 'AGENT_STOPPING', p.running.stopping.unconfirmed ? '尚未確認停止，暫時不能送出。' : '正在停止，等停止完成再送出。');
    if (p.running) throw new TaskError(409, 'AGENT_BUSY', 'AI 還在執行。可以先寫，停止這次執行後才能送出。');
    const items = p.workItems || [];
    const doneIds = items.filter(i => i.status === 'DONE').map(i => i.id);
    const keepText = ids => ids.length ? `${itemNames(ids)} 保持原樣。` : '';
    if (p.stopped) {
      const s = p.stopped;
      const redo = s.stage === 'A' ? '會重新制定任務卡，完成後接著需求釐清' : `會重做${stageName(s.stage)}${s.itemId ? ` ${itemName(s.itemId)}` : ''}`;
      const files = s.changed?.length ? `中斷期間變動的 ${s.changed.length} 個檔案會先核對，不算完成。` : '';
      return { route: 'resume', label: text ? '送出並繼續' : '繼續任務', impact: `${redo}；${keepText(doneIds.filter(x => x !== s.itemId)) || '已確認的成果保持原樣。'}${files}${s.afterRestart ? '服務曾重啟，無法確認上次的 CLI 是否已結束，請先確認沒有殘留程序。' : ''}` };
    }
    if (!text.trim()) throw new TaskError(400, 'TEXT_REQUIRED', '請先寫下補充指示。');
    if (p.phase === 'grill') return { route: 'answer', label: '送出回答', impact: null };
    if (p.phase === 'outline') return { route: 'outline', label: '請 AI 改計畫', impact: null };
    if (p.phase === 'done') {
      const n = items.filter(i => /^R\d+$/.test(i.id)).length + 1;
      return { route: 'round', itemId: `R${n}`, label: '建立新一輪', impact: `任務會從已完成改回進行中，新增${itemName(`R${n}`)}工作項目交給${stageName('D')}；${keepText(doneIds) || '先前的完成紀錄保留。'}` };
    }
    if (scope === 'outline') {
      return { route: 'replan', label: '請 AI 重排計畫', impact: `已確認的計畫會重新擬定，需要你再確認一次。內容沒變的項目保留狀態；被修改的已完成項目會改回待執行並重新驗收，舊成果保留。${doneIds.length ? `目前已完成：${itemNames(doneIds)}。` : ''}` };
    }
    const next = items.find(i => i.id === planningAction(t)?.id);
    // 「目前步驟」指向由你完成的項目時，改套用第一個還沒完成的 AI 項目。
    const target = scope && scope !== 'current' ? items.find(i => i.id === scope) : next?.owner === 'ai' ? next : items.find(i => i.owner === 'ai' && i.status !== 'DONE');
    if (!target) throw new TaskError(400, 'SCOPE_REQUIRED', '請選擇要套用的工作項目，或選「重排整個計畫（排好後你要再核准一次）」。');
    if (target.owner !== 'ai') throw new TaskError(400, 'HUMAN_ITEM', '這一項由你完成，不交給 AI。');
    if (target.status === 'TODO') {
      if (!ready(items, target)) throw new TaskError(409, 'DEPENDENCY_PENDING', `${itemName(target.id)} 的前置項目還沒完成。`);
      return { route: 'execute', itemId: target.id, label: '交給 AI 開始做', impact: null };
    }
    const dependents = items.filter(i => i.id !== target.id && i.dependsOn?.includes(target.id) && i.status !== 'TODO').map(i => i.id);
    if (target.status === 'DONE') {
      return { route: 'fix', itemId: target.id, label: '請 AI 照這樣改', impact: `${itemName(target.id)} 已確認，會改回待修改並重新驗收${dependents.length ? `；依賴它的 ${itemNames(dependents)} 標為待核對` : ''}。${keepText(doneIds.filter(x => x !== target.id))}` };
    }
    return { route: 'fix', itemId: target.id, label: '請 AI 照這樣改', impact: dependents.length ? `會修改 ${itemName(target.id)} 並重新驗收；依賴它的 ${itemNames(dependents)} 標為待核對。` : null };
  }

  async instruct(id, revision, key, { text = '', scope = 'current', reason = '', confirmImpact = false, dryRun = false } = {}) {
    if (typeof text !== 'string' || text.length > 6000) throw new TaskError(400, 'TEXT_TOO_LONG', '補充指示最多 6,000 字。');
    if (typeof reason !== 'string' || reason.length > 500) throw new TaskError(400, 'REASON_TOO_LONG', '修改原因最多 500 字。');
    text = text.trim(); reason = reason.trim();
    const task = await this.latest(id);
    if (this.pending.has(id)) throw new TaskError(409, 'AGENT_BUSY', 'AI 還在執行。可以先寫，停止這次執行後才能送出。');
    const plan = this.plan(task, { text, scope });
    if (dryRun) return { plan };
    if (plan.impact && !confirmImpact) throw new TaskError(409, 'CONFIRM_IMPACT', plan.impact, { plan });
    if (plan.route === 'answer') {
      const result = await this.answer(id, revision, key, { message: reason ? `${text}\n（修改原因：${reason}）` : text });
      await this.audit(id, 'INSTRUCTION', { route: plan.route, scope, text, reason, impact: null });
      return result;
    }
    const stopped = task.planning.stopped;
    await this.store.mutate(id, revision, key, t => {
      // 再檢查一次，避免兩個請求之間狀態已變。
      const again = this.plan(t, { text, scope });
      if (again.route !== plan.route) throw new TaskError(409, 'STATE_CHANGED', '任務狀態已改變，請重新整理後再送出。');
      (t.planning.instructions ||= []).push({ id: randomUUID().slice(0, 8), at: now(), route: plan.route, scope, itemId: plan.itemId || stopped?.itemId || null, text, reason, impact: plan.impact });
      if (text && plan.route !== 'outline' && plan.route !== 'replan') t.planning.messages.push({ id: randomUUID(), role: 'user', stage: plan.route === 'resume' ? stopped.stage : plan.route === 'execute' || plan.route === 'round' ? 'D' : 'F', text, reason: reason || undefined, at: now() });
      if (plan.route === 'resume' && text && stopped.itemId) {
        const item = this.item(t, stopped.itemId);
        (item.instructions ||= []).push({ text, at: now() });
      }
      if (plan.route === 'execute') (this.item(t, plan.itemId).instructions ||= []).push({ text, at: now() });
      if (plan.route === 'fix') {
        const item = this.item(t, plan.itemId);
        (item.instructions ||= []).push({ text, at: now() });
        const dependents = t.planning.workItems.filter(i => i.dependsOn?.includes(item.id) && i.status !== 'TODO');
        for (const d of dependents) d.recheck = `前置項目 ${itemName(item.id)} 已修改，請重新核對`;
        Object.assign(item, { status: 'REVIEW_FAIL', fixes: [...(item.fixes || []), text], review: item.review ? { ...item.review, superseded: true } : null, doneAt: undefined });
      }
      if (plan.route === 'round') {
        t.planning.phase = 'execute';
        t.planning.workItems.push({ id: plan.itemId, title: `${itemName(plan.itemId)}：${text.replace(/\s+/g, ' ').slice(0, 28)}`, detail: text, owner: 'ai', acceptance: ['依這一輪補充指示完成，且不破壞先前已確認的成果'], dependsOn: [], status: 'TODO', attempts: 0, outputs: [], review: null, fixes: [], instructions: [{ text, at: now() }], round: true });
        t.current.summary = `已完成的任務開始${itemName(plan.itemId)}補充。`;
      }
      return { status: planningStatus(t) };
    }, 'instruct', { text, scope, reason, route: plan.route });
    await this.audit(id, 'INSTRUCTION', { route: plan.route, scope, text, reason, impact: plan.impact });
    if (plan.route === 'resume') {
      const extra = stopped.stage === 'C' ? { feedback: text, replan: stopped.replan, instruction: text } : { instruction: text };
      return this.run(id, stopped.stage, stopped.itemId, extra);
    }
    if (plan.route === 'outline') return this.draftOutline(id, text);
    if (plan.route === 'replan') return this.draftOutline(id, text, { replan: true, instruction: text });
    if (plan.route === 'execute' || plan.route === 'round') return this.execute(id, plan.itemId, 'D');
    if (plan.route === 'fix') return this.fix(id, plan.itemId);
    throw new TaskError(400, 'ROUTE_INVALID', '無法判斷補充指示要交給哪一步。');
  }

  // 你的評分與標籤。只收目前該問的那一題，送出後下一個任務會帶上彙整出的方向。
  async feedback(id, revision, key, input = {}) {
    let saved;
    const result = await this.store.mutate(id, revision, key, t => {
      if (!t.planning) throw new TaskError(400, 'NOT_PLANNING', '這個任務不是教練流程。');
      const { entry, error } = validateFeedback(t, input);
      if (error) throw new TaskError(409, 'FEEDBACK_INVALID', error);
      t.planning.feedback.push(entry);
      saved = entry;
      return { status: planningStatus(t) };
    }, 'feedback', input);
    await this.audit(id, 'FEEDBACK', saved || {});
    return result;
  }

  resume(id, revision, key, { text = '', reason = '' } = {}) {
    return this.instruct(id, revision, key, { text, reason, scope: 'current', confirmImpact: true });
  }

  confirm(id, revision, key, { itemId, accept, note = '' }) {
    return this.store.mutate(id, revision, key, t => {
      const item = this.item(t, itemId);
      startFeedback(t.planning);
      if (item.owner === 'human') {
        if (item.status !== 'TODO') throw new TaskError(409, 'ITEM_CLOSED', '這一項已完成。');
        Object.assign(item, { status: 'DONE', humanNote: String(note).slice(0, 2000), doneAt: now() });
      } else {
        if (item.status !== 'REVIEWED' && item.status !== 'REVIEW_FAIL' && item.status !== 'BLOCKED') throw new TaskError(409, 'NOT_REVIEWED', '先讓 AI 檢查，再由你確認。');
        if (accept && item.status !== 'REVIEWED') throw new TaskError(409, 'NOT_REVIEWED', '這一項還沒通過驗收；可以退回並寫下要補的資訊。');
        if (accept) Object.assign(item, { status: 'DONE', humanNote: String(note).slice(0, 2000), doneAt: now() });
        else {
          if (!String(note).trim()) throw new TaskError(400, 'NOTE_REQUIRED', '退回時寫下要修什麼，修改的 AI 會照這段做。');
          Object.assign(item, { status: 'REVIEW_FAIL', fixes: [...(item.fixes || []), String(note).trim()] });
          // 完全自動時後續項目可能已經用它做下去了，標成待核對。
          for (const d of t.planning.workItems.filter(i => i.dependsOn?.includes(item.id) && i.status !== 'TODO')) d.recheck = `前置項目 ${itemName(item.id)} 被退回，請重新核對`;
        }
      }
      if (t.planning.workItems.every(i => i.status === 'DONE')) {
        t.planning.phase = 'done';
        t.current.summary = `全部 ${t.planning.workItems.length} 個工作項目已由你確認。`;
      }
      return { status: planningStatus(t) };
    }, 'confirm', { itemId, accept, note }).then(async result => {
      const done = result.task.planning.workItems.find(i => i.id === itemId)?.status === 'DONE';
      await this.audit(id, done ? 'ITEM_CONFIRMED' : 'ITEM_RETURNED', { itemId, text: String(note || '') });
      return result;
    });
  }
}

export { AgentError };
