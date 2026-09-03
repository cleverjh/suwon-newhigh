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
  lastTradeIndex,
  lastBelowMax,
  announceKey,
  loadJson,
  saveJson,
  sleep,
  loadConfig,
  isOurApt,
  normName,
} = require('./lib');

const RECENT_DAYS = parseInt(process.env.RECENT_DAYS || '14', 10);
const FETCH_MONTHS = parseInt(process.env.FETCH_MONTHS || '3', 10);

/** maxDb를 {lawdCd, apt, areaType, max, date, area, floor, umd} 배열로 펼침 */
function dbRecords(maxDb) {
  const out = [];
  for (const [key, v] of Object.entries(maxDb)) {
    const first = key.indexOf('|');
    const last = key.lastIndexOf('|');
    out.push({
      lawdCd: key.slice(0, first),
      apt: key.slice(first + 1, last),
      areaType: parseInt(key.slice(last + 1), 10),
      ...v,
    });
  }
  return out;
}

/** 단지명이 패턴 목록 중 하나를 포함하는지 */
function matchesName(apt, patterns) {
  const n = normName(apt);
  return patterns.some((p) => n.includes(normName(p)));
}

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

  const cfg = loadConfig();
  const announced = loadJson(PATHS.announced, { keys: [] });
  const announcedSet = new Set(announced.keys);
  const ourTrades = loadJson(PATHS.ourTrades, { trades: [] });
  const ourSeen = new Set(ourTrades.trades.map((t) => `${t.date}|${t.amountMan}|${t.area}|${t.floor}`));

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

  // 우리 아파트 거래 이력 갱신 (최근 거래 표시용)
  let ourNewCount = 0;
  for (const t of valid) {
    if (!isOurApt(t, cfg)) continue;
    const seenKey = `${t.date}|${t.amountMan}|${t.area}|${t.floor}`;
    if (ourSeen.has(seenKey)) continue;
    ourSeen.add(seenKey);
    ourNewCount += 1;
    ourTrades.trades.push({
      date: t.date, amountMan: t.amountMan, area: t.area,
      areaType: t.areaType, floor: t.floor,
    });
  }
  ourTrades.trades.sort((a, b) => (a.date < b.date ? -1 : 1));

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
    maxDb[key] = { max: t.amountMan, date: t.date, area: t.area, floor: t.floor, umd: t.umd };

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

  // 면적형별 '직전 실거래' 색인.
  // 역대 최고가가 몇 년 전 기록이면 그 값만으로는 지금 시세를 알 수 없다.
  // 최고가를 넘지 못해 신고가로 잡히지 않은 최근 거래도 함께 보여주기 위한 것.
  // 우리 아파트는 전체 거래 이력이 있어 항상 직전 거래를 알 수 있다.
  const ourLastByType = lastTradeIndex(ourTrades.trades, (t) => t.areaType);
  // 인근 단지는 이번에 조회한 최근 몇 개월치 안에서만 알 수 있다 (없으면 표기 생략).
  const neighborLastByKey = lastTradeIndex(valid, (t) => tradeKey(t));

  // 4) 우리 아파트 섹션: 최근 거래 + 면적형별 역대 최고가
  const ourAllRecords = dbRecords(maxDb)
    .filter((r) => r.lawdCd === cfg.ourApt.lawdCd && matchesName(r.apt, cfg.ourApt.match))
    .sort((a, b) => a.areaType - b.areaType)
    .map((r) => ({
      areaType: r.areaType, max: r.max, date: r.date, area: r.area, floor: r.floor,
      last: lastBelowMax(ourLastByType.get(r.areaType), r.max),
    }));
  // 목록에 노출할 면적형은 maxAreaType 이하로 제한 (대형 평형은 거래가 드물어 목록만 길어짐).
  // 비교용 최고가(ourMaxByType)는 전체를 그대로 쓴다.
  const maxAreaType = cfg.ourApt.maxAreaType;
  const ourRecords = maxAreaType
    ? ourAllRecords.filter((r) => r.areaType <= maxAreaType)
    : ourAllRecords;

  // 5) 인근 단지 섹션: 같은 법정동(+extra 지정 단지)의 면적형별 역대 최고가
  const extra = (cfg.neighbors.extra || []).map(normName);
  const neighborEntries = dbRecords(maxDb).filter((r) => {
    if (r.lawdCd === cfg.ourApt.lawdCd && matchesName(r.apt, cfg.ourApt.match)) return false;
    const sameUmd = r.lawdCd === cfg.ourApt.lawdCd && r.umd === cfg.ourApt.umd;
    return sameUmd || extra.includes(normName(r.apt));
  });

  // 면적형별 인근 단지 최고가 색인 (우리 아파트 최근 거래와 같은 평형끼리 비교하기 위함)
  const neighborByType = new Map();
  for (const r of neighborEntries) {
    if (!neighborByType.has(r.areaType)) neighborByType.set(r.areaType, []);
    neighborByType.get(r.areaType).push({
      apt: r.apt, max: r.max, date: r.date,
      last: lastBelowMax(neighborLastByKey.get(tradeKey(r)), r.max),
    });
  }
  const compareCount = cfg.neighbors.compareCount || 2;
  const sameTypeNeighbors = (areaType) =>
    (neighborByType.get(areaType) || []).sort((a, b) => b.max - a.max).slice(0, compareCount);

  const ourMaxByType = new Map(ourAllRecords.map((r) => [r.areaType, r]));

  const ourApt = {
    name: cfg.ourApt.name,
    umd: cfg.ourApt.umd,
    districtName: cfg.ourApt.districtName,
    recent: [...ourTrades.trades]
      .sort((a, b) => (a.date > b.date ? -1 : 1))
      .slice(0, cfg.ourRecentTradeCount || 3)
      .map((t) => {
        const ourMax = ourMaxByType.get(t.areaType);
        return {
          ...t,
          // 같은 면적형의 우리 단지 최고가 (목록에서 잘린 대형 평형도 비교되도록 값을 직접 담음)
          ourMaxMan: ourMax ? ourMax.max : null,
          vsOurMaxMan: ourMax ? t.amountMan - ourMax.max : null,
          // 같은 면적형 인근 단지 최고가 (비교용)
          neighbors: sameTypeNeighbors(t.areaType),
        };
      }),
    records: ourRecords,
  };
  const byComplex = new Map();
  for (const r of neighborEntries) {
    const k = `${r.lawdCd}|${r.apt}`;
    if (!byComplex.has(k)) byComplex.set(k, { apt: r.apt, umd: r.umd || '', records: [] });
    byComplex.get(k).records.push({
      areaType: r.areaType, max: r.max, date: r.date, area: r.area, floor: r.floor,
      last: lastBelowMax(neighborLastByKey.get(tradeKey(r)), r.max),
    });
  }
  // 우리 아파트 주력 면적형(compareAreaTypes)과 가까운 순으로 노출해야 비교가 된다.
  // 대형 평형만 뽑히면 59·84형 위주인 우리 아파트와 견줄 수 없기 때문.
  const compareTypes = cfg.compareAreaTypes || [];
  const typeDistance = (areaType) =>
    compareTypes.length === 0
      ? 0
      : Math.min(...compareTypes.map((t) => Math.abs(areaType - t)));

  const neighbors = [...byComplex.values()]
    .map((c) => ({
      ...c,
      records: c.records
        .sort((a, b) => typeDistance(a.areaType) - typeDistance(b.areaType) || b.max - a.max)
        .slice(0, cfg.neighbors.maxTypesPerComplex || 3)
        .sort((a, b) => a.areaType - b.areaType),
    }))
    // 단지 정렬도 비교 대상 면적형의 가격 기준으로
    .sort((a, b) => {
      const price = (c) => Math.max(...c.records.map((r) => r.max));
      return price(b) - price(a);
    })
    .slice(0, cfg.neighbors.maxComplexes || 8);

  const total = events.length;
  const report = {
    city: '수원',
    generatedAt: `${now.ymd}`,
    rangeDays: RECENT_DAYS,
    totalCount: total,
    ourApt,
    neighbors,
    districts,
  };
  saveJson(PATHS.report, report);
  console.log(`리포트 생성: 신고가 ${total}건, 인근 단지 ${neighbors.length}곳 → docs/data/report.json`);

  // 6) 게시 이력·최고가 DB·우리 아파트 거래 이력 저장
  for (const e of events) announcedSet.add(e.aKey);
  // 이력이 무한히 커지지 않도록 최근 5000건만 유지
  saveJson(PATHS.announced, { keys: [...announcedSet].slice(-5000) });
  saveJson(PATHS.maxDb, maxDb);
  saveJson(PATHS.ourTrades, ourTrades);

  // GitHub Actions 출력: 게시할 새 소식(수원 신고가 or 우리 아파트 새 거래)이 있는지
  const shouldPost = total > 0 || ourNewCount > 0;
  console.log(`새 수원 신고가 ${total}건, 우리 아파트 새 거래 ${ourNewCount}건 → 게시 ${shouldPost ? '진행' : '생략'}`);
  const ghOut = process.env.GITHUB_OUTPUT;
  if (ghOut) {
    require('fs').appendFileSync(
      ghOut,
      `has_new=${total > 0 ? 'true' : 'false'}\nshould_post=${shouldPost ? 'true' : 'false'}\n`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
