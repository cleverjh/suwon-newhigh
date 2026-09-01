'use strict';

/**
 * 정기 업데이트 스크립트 (월/목 아침 GitHub Actions에서 실행)
 *
 * 1. 최근 3개월치 수원시 4개 구 실거래 데이터를 API로 조회
 * 2. 단지·전용면적형별 역대 최고가 DB(data/max-prices.json)와 비교해 신고가 탐지
 * 3. 최근 RECENT_DAYS일 이내 계약 중 아직 게시 안 된 신고가로 리포트 생성
 *    - docs/data/report.json (웹페이지용)
 * 4. 게시 이력(data/announced.json)에 기록해 중복 게시 방지
 *
 * 필요 환경변수: MOLIT_API_KEY (공공데이터포털 서비스 키, URL 인코딩된 형태)
 */

const {
  DISTRICTS,
  PATHS,
  nowKST,
  recentMonths,
  fetchMonth,
  tradeKey,
  announceKey,
  loadJson,
  saveJson,
  sleep,
} = require('./lib');

const RECENT_DAYS = parseInt(process.env.RECENT_DAYS || '14', 10);
const FETCH_MONTHS = parseInt(process.env.FETCH_MONTHS || '3', 10);

async function main() {
  const serviceKey = process.env.MOLIT_API_KEY;
  if (!serviceKey) {
    console.error('MOLIT_API_KEY 환경변수가 없습니다. 공공데이터포털 서비스 키를 설정하세요.');
    process.exit(1);
  }

  const maxDb = loadJson(PATHS.maxDb, {});
  const dbSize = Object.keys(maxDb).length;
  if (dbSize === 0) {
    console.error(
      '역대 최고가 DB(data/max-prices.json)가 비어 있습니다.\n' +
        '먼저 `node scripts/backfill.js`로 과거 데이터를 적재해야 신고가 판정이 가능합니다.'
    );
    process.exit(1);
  }
  console.log(`역대 최고가 DB 로드: ${dbSize}개 (단지·면적형)`);

  const announced = loadJson(PATHS.announced, { keys: [] });
  const announcedSet = new Set(announced.keys);

  // 1) 최근 N개월 조회 (계약 신고가 최대 30일 지연되므로 여유 있게)
  const months = recentMonths(FETCH_MONTHS);
  const trades = [];
  for (const d of DISTRICTS) {
    for (const ym of months) {
      const rows = await fetchMonth(serviceKey, d.code, ym);
      console.log(`${d.name} ${ym}: ${rows.length}건`);
      trades.push(...rows);
      await sleep(200);
    }
  }

  // 2) 해제 거래 제외, 계약일 순 정렬 후 신고가 탐지
  const valid = trades.filter((t) => !t.canceled && t.amountMan > 0);
  valid.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const now = nowKST();
  const cutoff = new Date(Date.now() + 9 * 3600 * 1000 - RECENT_DAYS * 86400 * 1000)
    .toISOString()
    .slice(0, 10);

  const events = [];
  for (const t of valid) {
    const key = tradeKey(t);
    const prev = maxDb[key];
    const isFirst = !prev;
    const isNewHigh = !isFirst && t.amountMan > prev.max;
    if (!isFirst && !isNewHigh) continue;

    const diff = isFirst ? null : t.amountMan - prev.max;

    // DB는 항상 갱신 (오래된 신고가도 최고가 기록으로 반영)
    maxDb[key] = { max: t.amountMan, date: t.date, area: t.area, floor: t.floor };

    // 리포트에는 최근 계약 + 미게시 건만
    if (t.date < cutoff) continue;
    const aKey = announceKey(t);
    if (announcedSet.has(aKey)) continue;

    events.push({ ...t, diff, isFirst, aKey });
  }

  // 3) 리포트 생성 (구별 그룹, 가격 내림차순)
  const districts = DISTRICTS.map((d) => {
    const items = events
      .filter((e) => e.lawdCd === d.code)
      .sort((a, b) => b.amountMan - a.amountMan)
      .map((e) => ({
        apt: e.apt,
        umd: e.umd,
        amountMan: e.amountMan,
        diffMan: e.diff, // null = 해당 면적형 첫 거래
        area: e.area,
        floor: e.floor,
        date: e.date,
      }));
    return { name: d.name, items };
  }).filter((d) => d.items.length > 0);

  const total = events.length;
  const report = {
    city: '수원',
    generatedAt: `${now.ymd}`,
    rangeDays: RECENT_DAYS,
    totalCount: total,
    districts,
  };
  saveJson(PATHS.report, report);
  console.log(`리포트 생성: 신고가 ${total}건 → docs/data/report.json`);

  // 4) 게시 이력·최고가 DB 저장
  for (const e of events) announcedSet.add(e.aKey);
  // 이력이 무한히 커지지 않도록 최근 5000건만 유지
  saveJson(PATHS.announced, { keys: [...announcedSet].slice(-5000) });
  saveJson(PATHS.maxDb, maxDb);

  // GitHub Actions 출력: 새 신고가 있는지 여부
  const ghOut = process.env.GITHUB_OUTPUT;
  if (ghOut) {
    require('fs').appendFileSync(ghOut, `has_new=${total > 0 ? 'true' : 'false'}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
