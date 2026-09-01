'use strict';

/**
 * report.json → 아파트너 게시용 글(out/post.md) 생성.
 * 첫 줄 = 제목, 빈 줄 이후 = 본문.
 */

const { PATHS, formatMan, loadJson, nowKST } = require('./lib');
const fs = require('fs');
const path = require('path');

const report = loadJson(PATHS.report, null);
if (!report || report.totalCount === 0) {
  console.log('새 신고가가 없어 게시글을 생성하지 않습니다.');
  process.exit(0);
}

// generatedAt이 날짜(YYYY-MM-DD)가 아니면 오늘(KST) 기준으로
const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(report.generatedAt || '')
  ? report.generatedAt
  : nowKST().ymd;
const [, mm, dd] = dateStr.split('-');
const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
const dow = dayNames[new Date(`${dateStr}T00:00:00+09:00`).getDay()];

const lines = [];
lines.push(`🔥 ${Number(mm)}/${Number(dd)}(${dow}) 수원 아파트 신고가 ${report.totalCount}건`);
lines.push('');
lines.push(`국토교통부 실거래가 기준, 최근 ${report.rangeDays}일 내 계약된 수원시 신고가 거래입니다.`);
lines.push('');

for (const d of report.districts) {
  lines.push(`■ ${d.name} (${d.items.length}건)`);
  for (const it of d.items) {
    const diff =
      it.diffMan == null ? '신규' : `▲${formatMan(it.diffMan)}`;
    const [, cm, cd] = it.date.split('-');
    lines.push(
      `· ${it.apt} (${it.umd}) ${formatMan(it.amountMan)} (${diff}) ` +
        `${it.area}㎡/${it.floor}층, ${Number(cm)}.${Number(cd)} 계약`
    );
  }
  lines.push('');
}

lines.push('※ 신고가 기준: 같은 단지·전용면적형(㎡ 정수 기준)별 역대 최고 거래가');
lines.push('※ 해제 신고된 거래는 제외. 신고 시점에 따라 결과가 추후 변경될 수 있습니다.');
lines.push('※ 자료: 국토교통부 실거래가 공개시스템');

fs.mkdirSync(path.dirname(PATHS.post), { recursive: true });
fs.writeFileSync(PATHS.post, lines.join('\n'), 'utf8');
console.log(`게시글 생성 완료 → ${PATHS.post}`);
console.log('----------------------------------------');
console.log(lines.join('\n'));
