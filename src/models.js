import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const efforts = ['low', 'medium', 'high'];
const effortName = { low: 'Low', medium: 'Med', high: 'High' };

// Codex 模型清單取自 CLI 自己的快取（帳號可見的模型），不是猜的；
// 清單出現不代表此帳號能用，例如 gpt-6.1-sol 在 ChatGPT 帳號會被拒絕。以「檢查可用性」為準。
function codexModels() {
  try {
    const cache = JSON.parse(readFileSync(path.join(homedir(), '.codex', 'models_cache.json'), 'utf8'));
    return cache.models
      .filter(model => model.visibility === 'list')
      .flatMap(model => efforts
        .filter(effort => !(model.slug === 'gpt-6-astra' && effort === 'high') && model.supported_reasoning_levels?.some(level => level.effort === effort))
        .map(effort => ({ key: `${model.slug}-${effort}`, name: `${model.display_name} ${effortName[effort]}`, modelId: model.slug, effort })));
  } catch {
    return [];
  }
}

// Claude Code CLI 文件列出的別名；effort 對應 --effort。
// 指定版本的模型放最前面；別名會跟著 CLI 指向最新版。需要 CLI 2.1.280 以上才支援 Opus 5.5。
const claudePinned = [['claude-opus-5-5', 'Opus 5.5']].flatMap(([id, name]) => efforts.map(effort => ({
  key: `${id}-${effort}`, name: `${name} ${effortName[effort]}`, modelId: id, effort
})));
const claudeAliases = ['opus', 'sonnet', 'fable', 'haiku'].flatMap(alias => efforts.map(effort => ({
  key: `${alias}-${effort}`, name: `${alias[0].toUpperCase()}${alias.slice(1)} ${effortName[effort]}`, modelId: alias, effort
})));

export const providers = [
  { id: 'codex', name: 'Codex', runnable: true, modes: ['chat', 'read', 'write'], models: codexModels() },
  { id: 'claude', name: 'Claude Code', runnable: true, modes: ['chat', 'read', 'write'], models: [...claudePinned, ...claudeAliases] },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    // 實測（2026-10-09，CLI 1.0.93）：內建讀寫工具無法限制在產出資料夾，--sandbox 也只管 shell。
    // 使用者決定仍開放 A–F；read／write 只給檔案工具（不含 shell），風險由使用者承擔。
    runnable: true,
    modes: ['chat', 'read', 'write'],
    defaultModel: 'opus55-high',
    models: [
      { key: 'opus55-low', name: 'Claude Opus 5.5 Low', modelId: 'claude-opus-5.5', effort: 'low' },
      { key: 'opus55-med', name: 'Claude Opus 5.5 Med', modelId: 'claude-opus-5.5', effort: 'medium' },
      { key: 'opus55-high', name: 'Claude Opus 5.5 High', modelId: 'claude-opus-5.5', effort: 'high' },
      { key: 'sol-low', name: 'GPT-6.1 Sol Low', modelId: 'gpt-6.1-sol', effort: 'low' },
      { key: 'sol-med', name: 'GPT-6.1 Sol Med', modelId: 'gpt-6.1-sol', effort: 'medium' },
      { key: 'sol-high', name: 'GPT-6.1 Sol High', modelId: 'gpt-6.1-sol', effort: 'high' },
      { key: 'luna-high', name: 'GPT-6 Luna High', modelId: 'gpt-6-luna', effort: 'high' }
    ]
  }
];

export function resolveModel(providerId, key = 'default') {
  const provider = providers.find(item => item.id === providerId);
  if (!provider) throw new Error('UNKNOWN_PROVIDER');
  if (key === 'default') return { provider: providerId, modelId: null, effort: null };
  const model = provider.models.find(item => item.key === key);
  if (!model) throw new Error('UNKNOWN_MODEL');
  return { provider: providerId, modelId: model.modelId, effort: model.effort };
}

export function modelKey(saved) {
  return providers.find(p => p.id === saved.provider)?.models.find(m => m.modelId === saved.modelId && m.effort === saved.effort)?.key || 'default';
}

// 六個階段。F（修改）可以沿用 D 的執行者。
export const stages = [
  { id: 'A', name: '任務制定', mode: 'chat', description: '把你的一句話整理成任務卡，指出需求缺了什麼。' },
  { id: 'B', name: 'Grill me', mode: 'chat', description: '反問你，直到目標、讀者、邏輯與素材講清楚。' },
  { id: 'C', name: '擬計畫', mode: 'read', description: '產出計畫、邏輯鏈、需要幾張圖，並拆成工作項目。' },
  { id: 'D', name: '執行（寫程式）', mode: 'write', description: '在產出資料夾內完成工作項目，附證據回報。' },
  { id: 'E', name: '驗收', mode: 'read', description: '逐條核對驗收條件，告訴你自己 review 要看哪裡。' },
  { id: 'F', name: '修改', mode: 'write', description: '依驗收意見修正；可沿用 D 的執行者。' }
];

export function defaultStageSettings() {
  const codex = model => ({ provider: 'codex', ...resolveModel('codex', providers[0].models.some(m => m.key === model) ? model : 'default') });
  return {
    A: codex('gpt-6-sol-medium'),
    B: codex('gpt-6-sol-medium'),
    C: codex('gpt-6-sol-medium'),
    D: codex('gpt-6-sol-medium'),
    E: codex('gpt-6-sol-medium'),
    F: { provider: 'same-as-D', modelId: null, effort: null }
  };
}

export function resolveStage(settings, stageId) {
  const saved = settings.stages?.[stageId] || defaultStageSettings()[stageId];
  if (stageId === 'F' && saved.provider === 'same-as-D') return resolveStage(settings, 'D');
  return saved;
}

// 每個流程都留學習紀錄；快速流程只縮短釐清與大綱。
export const profiles = [
  { id: 'quick', name: '快速', questions: 2, diary: true, skeleton: false, description: '小事。最多問 2 題，計畫精簡，不先做骨架，每步留一個學習重點。' },
  { id: 'standard', name: '標準', questions: 3, diary: true, skeleton: true, description: '多數工作。每次問 3 題，先做骨架給你看，記學習日記。' },
  { id: 'thorough', name: '完整', questions: 3, diary: true, skeleton: true, evidence: true, description: '要上檯面的事。每段都要有依據與風險，先做骨架，記學習日記。' }
];
export const profileOf = id => profiles.find(p => p.id === id) || profiles[1];

// 依這台電腦可用的模型與工具權限推薦；沒有跨模型基準測試，並非能力排名。
export const recommendationPlans = [
  { id: 'available', name: '目前推薦 · Claude 額度不足時', description: 'Opus 釐清需求、GPT‑6 Sol medium 完成規劃、程式與驗收。依你的訂閱與模型偏好分工。',
    choices: {
      A: ['copilot', 'opus55-med', '整理目標與讀者，無工具的 medium 已足夠。'],
      B: ['copilot', 'opus55-med', '挑戰模糊需求；重要決策可自行升 high。'],
      C: ['codex', 'gpt-6-sol-medium', '用你指定的 Sol medium 唯讀核對素材，拆解工作與依賴。'],
      D: ['codex', 'gpt-6-sol-medium', '用 Sol medium 按核准範圍寫程式與除錯。'],
      E: ['codex', 'gpt-6-sol-medium', '另開執行檢查逐條驗收；與 D 同提供者，交叉驗證仍有限。'],
      F: ['same-as-D', 'default', '沿用實作者，保留修改脈絡；反覆退回時再調整強度。']
    } },
  { id: 'cross-review', name: '交叉驗收 · Claude 額度恢復後', description: 'Codex 負責程式，Claude Opus 規劃與驗收。先檢查 Claude 可用性，再保存指派。',
    choices: {
      A: ['copilot', 'opus55-med', '整理需求。'], B: ['copilot', 'opus55-med', '釐清讀者、成功條件與證據。'],
      C: ['claude', 'claude-opus-5-5-high', '規劃、敘事與拆解，使用 high 核對資料。'],
      D: ['codex', 'gpt-6-sol-medium', '用你指定的 Sol medium 實作與除錯。'],
      E: ['claude', 'claude-opus-5-5-high', '與 D 不同提供者逐條核對；仍需你確認成果。'],
      F: ['same-as-D', 'default', '沿用 D 修正。']
    } }
];
