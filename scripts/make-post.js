'use strict';

/**
 * report.json → 아파트너 게시용 글(out/post.md) 생성.
 * 첫 줄 = 제목, 빈 줄 이후 = 본문.
 *
 * 본문 형식은 config.post.bodyMode 로 고른다.
 *   image (기본) — 이미지 카드 한 장이 본문 역할. 글에는 요약 몇 줄만 남긴다.
 *   full         — 우리 아파트·인근 단지·오늘의 신고가를 모두 텍스트로 나열한다.
 */

const { PATHS, formatMan, loadJson, nowKST, loadConfig } = require('./lib');
const fs = require('fs');
const path = require('path');

const report = loadJson(PATHS.report, null);
if (!report) {
  console.log('report.json이 없어 게시글을 생성하지 않습니다.');
  process.exit(0);
}

// generatedAt이 날짜(YYYY-MM-DD)가 아니면 오늘(KST) 기준으로
const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(report.generatedAt || '')
  ? report.generatedAt
  : nowKST().ymd;
const [, mm, dd] = dateStr.split('-');
const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
const dow = dayNames[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];

const fmtArea = (a) => {
  const s = Number(a).toFixed(2);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

const fmtDate = (d) => {
  const [y, m, day] = d.split('-');
  return `${y.slice(2)}.${Number(m)}.${Number(day)}`;
};

const cfg = loadConfig();
const bodyMode = (cfg.post && cfg.post.bodyMode) || 'image';

const lines = [];
const ourName = report.ourApt ? report.ourApt.name : '우리 아파트';
lines.push(`🔥 ${Number(mm)}/${Number(dd)}(${dow}) ${ourName} 신고가 브리핑`);
lines.push('');

if (bodyMode === 'image') {
  // 이미지 한 장으로 전달하고, 글에는 핵심 수치만 짧게 남긴다
  lines.push('아래 이미지에 이번 브리핑을 정리했습니다.');
  lines.push('');
  if (report.ourApt) {
    const o = report.ourApt;
    const recent = (o.recent || [])[0];
    if (recent) {
      lines.push(
        `· 우리 단지 최근 거래: ${recent.areaType}형 ${formatMan(recent.amountMan)} ` +
          `(${fmtArea(recent.area)}㎡/${recent.floor}층, ${fmtDate(recent.date)} 계약)`
      );
    }
    for (const type of cfg.compareAreaTypes || []) {
      const rec = (o.records || []).find((r) => r.areaType === type);
      if (rec) lines.push(`· 우리 단지 ${type}형 역대 최고가: ${formatMan(rec.max)}`);
    }
  }
  lines.push(`· 오늘의 수원 신고가: ${report.totalCount}건 (최근 ${report.rangeDays}일 내 계약)`);
  lines.push('');
  lines.push('※ 신고가 기준: 같은 단지·전용면적형(㎡ 정수 기준)별 역대 최고 거래가');
  lines.push('※ 해제 신고된 거래는 제외. 신고 시점에 따라 결과가 추후 변경될 수 있습니다.');
  lines.push('※ 자료: 국토교통부 실거래가 공개시스템');

  fs.mkdirSync(path.dirname(PATHS.post), { recursive: true });
  fs.writeFileSync(PATHS.post, lines.join('\n'), 'utf8');
  console.log(`게시글 생성 완료 (이미지 중심) → ${PATHS.post}`);
  console.log('----------------------------------------');
  console.log(lines.join('\n'));
  process.exit(0);
}

lines.push('국토교통부 실거래가 공개시스템 기준입니다.');
lines.push('');

// ① 우리 아파트
if (report.ourApt) {
  const o = report.ourApt;
  lines.push(`🏠 우리 아파트 (${o.name})`);
  lines.push('[최근 거래 · 같은 평형 비교]');
  if (o.recent && o.recent.length > 0) {
    for (const t of o.recent) {
      lines.push(
        `· ${t.areaType}형 ${formatMan(t.amountMan)} (${fmtArea(t.area)}㎡/${t.floor}층) ${fmtDate(t.date)} 계약`
      );
      const ourMaxMan =
        t.ourMaxMan ?? (o.records || []).find((r) => r.areaType === t.areaType)?.max;
      const parts = [];
      if (ourMaxMan) parts.push(`우리 ${formatMan(ourMaxMan)}`);
      for (const n of t.neighbors || []) parts.push(`${n.apt} ${formatMan(n.max)}`);
      if (parts.length > 0) {
        lines.push(`   └ ${t.areaType}형 최고가: ${parts.join(' / ')}`);
      }
    }
  } else {
    lines.push('· 최근 거래 없음');
  }
  lines.push('[우리 단지 면적형별 신고가 · 역대 최고]');
  if (o.records && o.records.length > 0) {
    for (const r of o.records) {
      // 최고가가 몇 년 전 기록일 수 있어, 넘지 못한 직전 실거래가를 함께 적는다
      const last = r.last ? ` / 직전 ${formatMan(r.last.man)}(${fmtDate(r.last.date)})` : '';
      lines.push(`· ${r.areaType}형 ${formatMan(r.max)} (${fmtArea(r.area)}㎡/${r.floor}층) ${fmtDate(r.date)} 계약${last}`);
    }
  } else {
    lines.push('· 데이터 없음');
  }
  lines.push('');
}

// ② 인근 단지 신고가
if (report.neighbors && report.neighbors.length > 0) {
  const umd = report.ourApt ? report.ourApt.umd : '';
  lines.push(`🏘 인근 단지 신고가${umd ? ` (${umd})` : ''}`);
  for (const n of report.neighbors) {
    const recs = n.records
      .map((r) => {
        const base = `${r.areaType}형 ${formatMan(r.max)}(${fmtDate(r.date)})`;
        return r.last ? `${base}·직전 ${formatMan(r.last.man)}` : base;
      })
      .join(' / ');
    lines.push(`· ${n.apt}: ${recs}`);
  }
  lines.push('');
}

// ③ 오늘의 수원 신고가
lines.push(`📈 오늘의 수원 신고가 ${report.totalCount}건 (최근 ${report.rangeDays}일 내 계약)`);
if (report.totalCount === 0) {
  lines.push('· 이번에 새로 나온 신고가가 없습니다.');
} else {
  for (const d of report.districts) {
    lines.push(`■ ${d.name} (${d.items.length}건)`);
    for (const it of d.items) {
      const diff = it.diffMan == null ? '신규' : `▲${formatMan(it.diffMan)}`;
      lines.push(
        `· ${it.apt} (${it.umd}) ${formatMan(it.amountMan)} (${diff}) ` +
          `${fmtArea(it.area)}㎡/${it.floor}층, ${fmtDate(it.date)} 계약`
      );
    }
  }
}
lines.push('');

lines.push('※ 신고가 기준: 같은 단지·전용면적형(㎡ 정수 기준)별 역대 최고 거래가');
lines.push('※ 해제 신고된 거래는 제외. 신고 시점에 따라 결과가 추후 변경될 수 있습니다.');
lines.push('※ 자료: 국토교통부 실거래가 공개시스템');

fs.mkdirSync(path.dirname(PATHS.post), { recursive: true });
fs.writeFileSync(PATHS.post, lines.join('\n'), 'utf8');
console.log(`게시글 생성 완료 → ${PATHS.post}`);
console.log('----------------------------------------');
console.log(lines.join('\n'));
