'use strict';

/**
 * 과거 실거래 전체를 훑어 단지·전용면적형별 역대 최고가 DB를 구축하는 스크립트.
 * 최초 1회(또는 DB 재구축 시)만 실행하면 된다.
 *
 * - 기간: 2006-01 ~ 현재 (아파트 실거래 신고제 시행 이후 전체)
 * - 중간에 끊겨도 data/backfill-state.json 에 진행 상황을 저장해 이어서 실행 가능
 * - 호출량: 약 250개월 × 4개 구 ≒ 1,000회 (공공데이터포털 일일 트래픽 한도 내에서 실행)
 *
 * 필요 환경변수: MOLIT_API_KEY
 * 선택 환경변수: BACKFILL_START(기본 200601), BACKFILL_DELAY_MS(기본 250)
 */

const {
  DISTRICTS,
  PATHS,
  nowKST,
  fetchMonth,
  tradeKey,
  loadJson,
  saveJson,
  sleep,
} = require('./lib');

async function main() {
  const serviceKey = process.env.MOLIT_API_KEY;
  if (!serviceKey) {
    console.error('MOLIT_API_KEY 환경변수가 없습니다.');
    process.exit(1);
  }

  const start = process.env.BACKFILL_START || '200601';
  const delayMs = parseInt(process.env.BACKFILL_DELAY_MS || '250', 10);
  const { year, month } = nowKST();
  const end = `${year}${String(month).padStart(2, '0')}`;

  // 전체 월 목록
  const months = [];
  let y = parseInt(start.slice(0, 4), 10);
  let m = parseInt(start.slice(4, 6), 10);
  for (;;) {
    const ym = `${y}${String(m).padStart(2, '0')}`;
    if (ym > end) break;
    months.push(ym);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }

  const maxDb = loadJson(PATHS.maxDb, {});
  const state = loadJson(PATHS.backfillState, { done: [] });
  const doneSet = new Set(state.done);

  let calls = 0;
  for (const d of DISTRICTS) {
    for (const ym of months) {
      const jobKey = `${d.code}-${ym}`;
      if (doneSet.has(jobKey)) continue;

      let rows;
      try {
        rows = await fetchMonth(serviceKey, d.code, ym);
      } catch (err) {
        // 진행 상황 저장 후 종료 → 다음 실행 때 이어서
        saveJson(PATHS.maxDb, maxDb);
        saveJson(PATHS.backfillState, { done: [...doneSet] });
        console.error(`${d.name} ${ym} 조회 실패, 진행 상황 저장 후 중단:`, err.message);
        process.exit(2);
      }

      for (const t of rows) {
        if (t.canceled || t.amountMan <= 0) continue;
        const key = tradeKey(t);
        const prev = maxDb[key];
        if (!prev || t.amountMan > prev.max) {
          maxDb[key] = { max: t.amountMan, date: t.date, area: t.area, floor: t.floor };
        }
      }

      doneSet.add(jobKey);
      calls += 1;
      if (calls % 20 === 0) {
        saveJson(PATHS.maxDb, maxDb);
        saveJson(PATHS.backfillState, { done: [...doneSet] });
        console.log(`진행: ${doneSet.size}/${months.length * DISTRICTS.length} (${d.name} ${ym}, ${rows.length}건)`);
      }
      await sleep(delayMs);
    }
  }

  saveJson(PATHS.maxDb, maxDb);
  saveJson(PATHS.backfillState, { done: [...doneSet] });
  console.log(`백필 완료: 최고가 DB ${Object.keys(maxDb).length}개 (단지·면적형)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
