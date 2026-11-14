import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSlides, checkNumberSources, parseDecisionCard } from '../src/output-preview.js';

test('extracts individual slide sections in order, including nested sections', () => {
  const slides = extractSlides('<main><section class="slide"><h1>封面</h1><section>內文</section></section><section class="other">略</section><section class="slide"><h2>結論</h2></section></main>');
  assert.equal(slides.length, 2);
  assert.equal(slides[0].title, '封面');
  assert.match(slides[0].html, /內文/);
  assert.equal(slides[1].title, '結論');
});

test('numeric source check reports unsupported numbers explicitly', () => {
  assert.deepEqual(checkNumberSources('<p>轉換率 42%，新增 17 位</p>', ['素材記載轉換率42%']), [
    { number: '42%', result: '有來源' }, { number: '17 位', result: '無來源' }
  ]);
  assert.deepEqual(checkNumberSources('42%', ['42%']), [{ number: '42%', result: '有來源' }]);
});

test('decision card keeps recommendation distinct from user choice and rejects malformed data', () => {
  const card = parseDecisionCard('```mentor-decision\n{"question":"延長試行嗎？","options":[{"label":"延長","benefits":["多收資料"],"costs":["多花時間"],"evidence":["素材 A"]}],"unknowns":["成本尚未核對"],"recommendation":"延長","recommendationReason":"資料仍不足"}\n```');
  assert.equal(card.options[0].label, '延長');
  assert.equal(card.recommendation, '延長');
  assert.equal(Object.hasOwn(card, 'choice'), false);
  assert.match(parseDecisionCard('```decision\n{}\n```').error, /缺少/);
});
