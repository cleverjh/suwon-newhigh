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

// 5) 면적 표시 포맷 (소수점 2자리, 불필요한 0 제거)
const fmtArea = (a) => {
  const s = Number(a).toFixed(2);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};
assert.strictEqual(fmtArea(104.9868), '104.99');
assert.strictEqual(fmtArea(84.8641), '84.86');
assert.strictEqual(fmtArea(84.9), '84.9');
assert.strictEqual(fmtArea(100), '100'); // 정수 면적이 "1"로 잘리지 않아야 함
assert.strictEqual(fmtArea(84), '84');

// 6) 인근 단지 면적형 우선순위 (우리 아파트 주력 평형에 가까운 순)
const compareTypes = [59, 84];
const typeDistance = (at) => Math.min(...compareTypes.map((t) => Math.abs(at - t)));
const picked = [
  { areaType: 157, max: 99100 }, { areaType: 128, max: 95000 },
  { areaType: 84, max: 70000 }, { areaType: 59, max: 50000 },
]
  .sort((a, b) => typeDistance(a.areaType) - typeDistance(b.areaType) || b.max - a.max)
  .slice(0, 3)
  .map((r) => r.areaType);
assert.deepStrictEqual(picked, [84, 59, 128], '주력 평형(84/59)이 대형보다 먼저 뽑혀야 함');

// 7) fetch 재시도: 일시적 실패 후 성공하면 결과를 돌려준다
const { fetchWithRetry } = require('./lib');
(async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('fetch failed');      // 연결 실패
    if (calls === 2) return { ok: false, status: 503 };     // 서버 일시 오류
    return { ok: true, status: 200 };
  };
  const res = await fetchWithRetry('https://example.test', { retries: 3, baseDelayMs: 1 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls, 3, '두 번 실패 후 세 번째에 성공해야 함');

  // 4xx는 재시도하지 않고 그대로 반환 (키 오류 등은 재시도해도 소용없음)
  calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: false, status: 401 }; };
  const bad = await fetchWithRetry('https://example.test', { retries: 3, baseDelayMs: 1 });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(calls, 1, '4xx는 재시도하지 않아야 함');

  // 계속 실패하면 마지막 오류를 던진다
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  await assert.rejects(
    fetchWithRetry('https://example.test', { retries: 2, baseDelayMs: 1 }),
    /fetch failed/
  );

  globalThis.fetch = realFetch;
  console.log('모든 테스트 통과 ✓');
})();
