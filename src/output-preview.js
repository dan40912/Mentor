const textOnly = html => String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();

export function extractSlides(html) {
  const tags = /<\/?section\b[^>]*>/gi, slides = [];
  let depth = 0, start = -1, opening = '', match;
  while ((match = tags.exec(String(html)))) {
    const closing = /^<\//.test(match[0]);
    if (!closing) {
      if (depth === 0 && /\bclass\s*=\s*(["'])[^"']*\bslide\b[^"']*\1/i.test(match[0])) { start = match.index; opening = match[0]; }
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        const end = tags.lastIndex, fragment = String(html).slice(start, end);
        const plain = textOnly(fragment);
        slides.push({ page: slides.length + 1, title: textOnly(fragment.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || fragment).slice(0, 120) || `第 ${slides.length + 1} 頁`, preview: plain.slice(0, 90), html: fragment });
        start = -1; opening = '';
      }
    }
  }
  return slides;
}

const numberTokens = text => [...new Set((String(text).match(/(?<![\p{L}\p{N}])[-+]?\d[\d,]*(?:\.\d+)?\s?(?:%|％|萬|億|元|美元|人|次|天|月|年|倍|位)?/gu) || []).map(value => value.trim()))];

export function checkNumberSources(output, materials = []) {
  const source = materials.map(item => typeof item === 'string' ? item : item.text || item.content || '').join('\n');
  return numberTokens(textOnly(String(output).replace(/<[^>]+>/g, ' '))).map(number => ({ number, result: source.includes(number) ? '有來源' : '無來源' }));
}

export function parseDecisionCard(content) {
  const source = String(content);
  const match = source.match(/```(?:json\s+)?(?:mentor-decision|decision)\s*\n([\s\S]*?)\n```/i) || source.match(/<script\b(?=[^>]*\bid=["']mentor-decision["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i) || source.match(/<!--\s*mentor-decision\s*\n([\s\S]*?)\n\s*-->/i);
  if (!match) return null;
  let data;
  try { data = JSON.parse(match[1]); } catch { return { error: '決策資料格式無法讀取。' }; }
  if (!Array.isArray(data.options) || !data.options.length || data.options.some(o => !o || typeof o.label !== 'string' || !Array.isArray(o.benefits) || !Array.isArray(o.costs))) return { error: '決策資料缺少選項、好處或代價。' };
  return { question: String(data.question || ''), options: data.options.map(o => ({ label: o.label, benefits: o.benefits.map(String), costs: o.costs.map(String), evidence: Array.isArray(o.evidence) ? o.evidence.map(String) : [] })), unknowns: Array.isArray(data.unknowns) ? data.unknowns.map(String) : [], recommendation: typeof data.recommendation === 'string' ? data.recommendation : '', recommendationReason: typeof data.recommendationReason === 'string' ? data.recommendationReason : '' };
}
