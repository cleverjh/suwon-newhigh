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
  loadConfig,
  isOurApt,
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

  const cfg = loadConfig();
  const maxDb = loadJson(PATHS.maxDb, {});
  const ourTrades = loadJson(PATHS.ourTrades, { trades: [] });
  const ourSeen = new Set(ourTrades.trades.map((t) => `${t.date}|${t.amountMan}|${t.area}|${t.floor}`));
  const state = loadJson(PATHS.backfillState, { done: [] });
  const doneSet = new Set(state.done);

  const saveAll = () => {
    ourTrades.trades.sort((a, b) => (a.date < b.date ? -1 : 1));
    saveJson(PATHS.maxDb, maxDb);
    saveJson(PATHS.ourTrades, ourTrades);
    saveJson(PATHS.backfillState, { done: [...doneSet] });
  };

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
        saveAll();
        console.error(`${d.name} ${ym} 조회 실패, 진행 상황 저장 후 중단:`, err.message);
        process.exit(2);
      }

      for (const t of rows) {
        if (t.canceled || t.amountMan <= 0) continue;
        const key = tradeKey(t);
        const prev = maxDb[key];
        if (!prev || t.amountMan > prev.max) {
          maxDb[key] = { max: t.amountMan, date: t.date, area: t.area, floor: t.floor, umd: t.umd };
        }
        // 우리 아파트 거래는 전체 이력 보관 (최근 거래 표시용)
        if (isOurApt(t, cfg)) {
          const seenKey = `${t.date}|${t.amountMan}|${t.area}|${t.floor}`;
          if (!ourSeen.has(seenKey)) {
            ourSeen.add(seenKey);
            ourTrades.trades.push({
              date: t.date, amountMan: t.amountMan, area: t.area,
              areaType: t.areaType, floor: t.floor,
            });
          }
        }
      }

      doneSet.add(jobKey);
      calls += 1;
      if (calls % 20 === 0) {
        saveAll();
        console.log(`진행: ${doneSet.size}/${months.length * DISTRICTS.length} (${d.name} ${ym}, ${rows.length}건)`);
      }
      await sleep(delayMs);
    }
  }

  saveAll();
  console.log(`백필 완료: 최고가 DB ${Object.keys(maxDb).length}개 (단지·면적형), 우리 아파트 거래 ${ourTrades.trades.length}건`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
