'use strict';

/**
 * 공통 라이브러리
 * - 국토교통부 아파트 매매 실거래가 API 호출/파싱
 * - 신고가 판정용 키/가격 포맷 유틸
 *
 * 데이터 출처: 국토교통부 실거래가 공개시스템 (공공데이터포털)
 * API: 아파트 매매 실거래가 자료 (RTMSDataSvcAptTrade)
 */

const fs = require('fs');
const path = require('path');

// 수원시 4개 구 법정동 시군구 코드 (LAWD_CD 앞 5자리)
const DISTRICTS = [
  { code: '41111', name: '장안구' },
  { code: '41113', name: '권선구' },
  { code: '41115', name: '팔달구' },
  { code: '41117', name: '영통구' },
];

const API_BASE =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

const ROOT = path.join(__dirname, '..');
const PATHS = {
  config: path.join(ROOT, 'config.json'),
  maxDb: path.join(ROOT, 'data', 'max-prices.json'),
  announced: path.join(ROOT, 'data', 'announced.json'),
  backfillState: path.join(ROOT, 'data', 'backfill-state.json'),
  ourTrades: path.join(ROOT, 'data', 'our-apt-trades.json'),
  report: path.join(ROOT, 'docs', 'data', 'report.json'),
  post: path.join(ROOT, 'out', 'post.md'),
};

/** 단지명 비교용 정규화 (공백 제거 + 대문자) */
function normName(s) {
  return String(s || '').replace(/\s/g, '').toUpperCase();
}

/** config.json 로드 */
function loadConfig() {
  return JSON.parse(fs.readFileSync(PATHS.config, 'utf8'));
}

/** 우리 아파트 거래인지 판정 */
function isOurApt(trade, cfg) {
  if (trade.lawdCd !== cfg.ourApt.lawdCd) return false;
  const n = normName(trade.apt);
  return cfg.ourApt.match.some((p) => n.includes(normName(p)));
}

/** 현재 KST 기준 Date 유사 객체 반환 */
function nowKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    ymd: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
  };
}

/** YYYYMM 문자열 목록: 이번 달 포함 최근 n개월 (KST) */
function recentMonths(n) {
  const { year, month } = nowKST();
  const out = [];
  let y = year;
  let m = month;
  for (let i = 0; i < n; i++) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** XML에서 태그 값 추출 (단순 플랫 구조 전용) */
function xmlValue(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
}

/** API 한 달치 호출 (페이지네이션 포함) → 거래 배열 */
async function fetchMonth(serviceKey, lawdCd, dealYmd, { numOfRows = 1000 } = {}) {
  const all = [];
  let pageNo = 1;
  for (;;) {
    const url =
      `${API_BASE}?serviceKey=${serviceKey}` +
      `&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}` +
      `&numOfRows=${numOfRows}&pageNo=${pageNo}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API HTTP ${res.status} (LAWD_CD=${lawdCd}, DEAL_YMD=${dealYmd})`);
    }
    const xml = await res.text();

    const resultCode = xmlValue(xml, 'resultCode');
    if (resultCode && !['00', '000'].includes(resultCode)) {
      const msg = xmlValue(xml, 'resultMsg');
      throw new Error(`API 오류 ${resultCode}: ${msg} (LAWD_CD=${lawdCd}, DEAL_YMD=${dealYmd})`);
    }

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const block of items) {
      const trade = parseItem(block, lawdCd);
      if (trade) all.push(trade);
    }

    const totalCount = parseInt(xmlValue(xml, 'totalCount') || '0', 10);
    if (pageNo * numOfRows >= totalCount || items.length === 0) break;
    pageNo += 1;
  }
  return all;
}

/** <item> 블록 하나 → 거래 객체 */
function parseItem(block, lawdCd) {
  const apt = xmlValue(block, 'aptNm');
  const amountRaw = xmlValue(block, 'dealAmount');
  if (!apt || !amountRaw) return null;

  const area = parseFloat(xmlValue(block, 'excluUseAr')) || 0;
  const year = parseInt(xmlValue(block, 'dealYear'), 10);
  const month = parseInt(xmlValue(block, 'dealMonth'), 10);
  const day = parseInt(xmlValue(block, 'dealDay'), 10);
  return {
    lawdCd,
    umd: xmlValue(block, 'umdNm'),
    apt,
    jibun: xmlValue(block, 'jibun'),
    area,
    areaType: Math.floor(area), // 전용면적형(㎡ 정수 절사) 기준
    floor: parseInt(xmlValue(block, 'floor'), 10) || 0,
    year,
    month,
    day,
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    amountMan: parseInt(amountRaw.replace(/[^0-9]/g, ''), 10), // 만원 단위
    canceled: xmlValue(block, 'cdealType') === 'O', // 해제 거래 여부
  };
}

/** 신고가 판정 키: 같은 단지 · 전용면적형 */
function tradeKey(t) {
  return `${t.lawdCd}|${t.apt}|${t.areaType}`;
}

/** 개별 거래 고유 키 (중복 게시 방지용) */
function announceKey(t) {
  return `${tradeKey(t)}|${t.date}|${t.amountMan}|${t.floor}`;
}

/** 만원 → "15억", "10억3천", "8억7천500", "4억900", "9천500" 형식 */
function formatMan(man) {
  if (!man || man <= 0) return '0';
  const eok = Math.floor(man / 10000);
  const rem = man % 10000;
  let s = eok > 0 ? `${eok}억` : '';
  if (rem > 0) {
    const cheon = Math.floor(rem / 1000);
    const under = rem % 1000;
    if (cheon > 0) s += `${cheon}천`;
    if (under > 0) s += `${under}`;
  }
  return s || '0';
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1), 'utf8');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  DISTRICTS,
  API_BASE,
  PATHS,
  normName,
  loadConfig,
  isOurApt,
  nowKST,
  recentMonths,
  fetchMonth,
  parseItem,
  tradeKey,
  announceKey,
  formatMan,
  loadJson,
  saveJson,
  sleep,
  xmlValue,
};
