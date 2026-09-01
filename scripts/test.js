'use strict';

/** 핵심 로직 단위 테스트: node scripts/test.js */

const assert = require('assert');
const { formatMan, parseItem, tradeKey, announceKey } = require('./lib');

// 1) 가격 포맷
assert.strictEqual(formatMan(150000), '15억');
assert.strictEqual(formatMan(103000), '10억3천');
assert.strictEqual(formatMan(100000), '10억');
assert.strictEqual(formatMan(87500), '8억7천500');
assert.strictEqual(formatMan(40900), '4억900');
assert.strictEqual(formatMan(9500), '9천500');
assert.strictEqual(formatMan(500), '500');
assert.strictEqual(formatMan(10000), '1억');

// 2) API 응답 파싱
const itemXml = `
<item>
  <aptNm>광교호반베르디움</aptNm>
  <buildYear>2018</buildYear>
  <cdealType> </cdealType>
  <dealAmount>150,000</dealAmount>
  <dealDay>21</dealDay>
  <dealMonth>8</dealMonth>
  <dealYear>2026</dealYear>
  <excluUseAr>84.94</excluUseAr>
  <floor>16</floor>
  <jibun>573</jibun>
  <umdNm>원천동</umdNm>
</item>`;
const t = parseItem(itemXml, '41117');
assert.strictEqual(t.apt, '광교호반베르디움');
assert.strictEqual(t.amountMan, 150000);
assert.strictEqual(t.area, 84.94);
assert.strictEqual(t.areaType, 84);
assert.strictEqual(t.floor, 16);
assert.strictEqual(t.date, '2026-08-21');
assert.strictEqual(t.canceled, false);
assert.strictEqual(tradeKey(t), '41117|광교호반베르디움|84');
assert.strictEqual(announceKey(t), '41117|광교호반베르디움|84|2026-08-21|150000|16');

// 3) 해제 거래 인식
const canceledXml = itemXml.replace('<cdealType> </cdealType>', '<cdealType>O</cdealType>');
assert.strictEqual(parseItem(canceledXml, '41117').canceled, true);

// 4) 신고가 판정 시뮬레이션 (update.js 핵심 로직과 동일 규칙)
const maxDb = { '41117|광교호반베르디움|84': { max: 140000 } };
const prev = maxDb[tradeKey(t)];
assert.ok(t.amountMan > prev.max, '신고가로 판정되어야 함');
assert.strictEqual(t.amountMan - prev.max, 10000); // ▲1억

const first = parseItem(itemXml.replace('광교호반베르디움', '신규단지'), '41117');
assert.strictEqual(maxDb[tradeKey(first)], undefined, '첫 거래는 DB에 없어야 함');

console.log('모든 테스트 통과 ✓');
