'use strict';

/**
 * 과거 실거래 전체를 훑어 단지·전용면적형별 역대 최고가 DB를 구축하는 스크립트.
 * 최초 1회(또는 DB 재구축 시)만 실행하면 된다.
 *
 * - 기간: 2006-01 ~ 현재 (아파트 실거래 신고제 시행 이후 전체)
 * - 중간에 끊겨도 data/backfill-state.json 에 진행 상황을 저장해 이어서 실행 가능
 * - 호출량: 약 250개월 × 4개 구 ≒ 1,000회 (공공데이터포털 일일 트래픽 한도 내에서 실행)
 *
 * 중요: 최근 EXCLUDE_RECENT_DAYS일(기본 14일) 이내 계약은 최고가 DB에 반영하지 않는다.
 * 백필은 "과거 기준선"을 만드는 작업이므로, 최근 거래까지 최고가로 등록해 버리면
 * 첫 정기 실행이 그 거래들을 신고가로 탐지하지 못한다.
 * (우리 아파트 거래 이력에는 최근 거래도 그대로 기록한다 — 최근 거래 표시에 쓰이므로)
 *
 * 필요 환경변수: MOLIT_API_KEY
 * 선택 환경변수: BACKFILL_START(기본 200601), BACKFILL_DELAY_MS(기본 250),
 *               EXCLUDE_RECENT_DAYS(기본 14, update.js의 RECENT_DAYS와 맞출 것)
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
  const excludeDays = parseInt(process.env.EXCLUDE_RECENT_DAYS || '14', 10);
  // 이 날짜 이후(포함) 계약은 최고가 DB에 넣지 않는다 → 첫 정기 실행이 신고가로 탐지
  const maxDbCutoff = new Date(Date.now() + 9 * 3600 * 1000 - excludeDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  console.log(`최고가 DB 반영 대상: ${maxDbCutoff} 이전 계약 (최근 ${excludeDays}일은 신고가 탐지용으로 제외)`);
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
  let consecutiveFailures = 0;
  const failedJobs = [];
  const MAX_CONSECUTIVE_FAILURES = parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '5', 10);
  for (const d of DISTRICTS) {
    for (const ym of months) {
      const jobKey = `${d.code}-${ym}`;
      if (doneSet.has(jobKey)) continue;

      let rows;
      try {
        rows = await fetchMonth(serviceKey, d.code, ym);
        consecutiveFailures = 0;
      } catch (err) {
        // 한 구간 실패로 전체를 포기하지 않는다. 해당 구간은 done에 넣지 않으므로
        // 다음 실행에서 다시 시도되고, 나머지 구간은 계속 진행한다.
        consecutiveFailures += 1;
        failedJobs.push(`${d.name} ${ym}`);
        console.warn(`${d.name} ${ym} 조회 실패(${consecutiveFailures}회 연속): ${err.message}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          saveAll();
          console.error(
            `연속 ${consecutiveFailures}회 실패로 중단합니다. API 서버에 연결할 수 없는 상태로 보입니다.\n` +
              `진행 상황은 저장했으니, 잠시 후 [backfill]만 체크해 다시 실행하면 이어서 진행합니다.\n` +
              `완료 ${doneSet.size}/${months.length * DISTRICTS.length} 구간`
          );
          process.exit(2);
        }
        await sleep(delayMs * 4);
        continue;
      }

      for (const t of rows) {
        if (t.canceled || t.amountMan <= 0) continue;
        if (t.date < maxDbCutoff) {
          const key = tradeKey(t);
          const prev = maxDb[key];
          if (!prev || t.amountMan > prev.max) {
            maxDb[key] = { max: t.amountMan, date: t.date, area: t.area, floor: t.floor, umd: t.umd };
          }
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
  if (failedJobs.length > 0) {
    console.warn(
      `조회하지 못한 구간 ${failedJobs.length}개: ${failedJobs.slice(0, 10).join(', ')}` +
        `${failedJobs.length > 10 ? ' 외' : ''}\n` +
        `[backfill]만 체크해 다시 실행하면 이 구간들만 재시도합니다.`
    );
    process.exit(3); // 부분 완료 — 데이터는 저장됨
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
