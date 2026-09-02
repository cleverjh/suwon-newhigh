'use strict';

/* 수원SK스카이뷰 신고가 브리핑 — report.json 렌더링
   구성: ① 우리 아파트 최근 거래·신고가 ② 인근 단지 신고가 ③ 오늘의 수원 신고가 */

// 만원 → "15억", "10억3천", "8억7천500", "4억900" 형식
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

// 면적은 소수점 2자리까지만 (API가 104.9868 같은 값을 주는 경우가 있음)
function fmtArea(a) {
    const s = Number(a).toFixed(2);
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function fmtDate(d) {
    const [y, m, day] = d.split('-');
    return `${y.slice(2)}.${m}.${day}`;
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

/* ── ① 우리 아파트 ─────────────────────────────── */
function renderOurApt(report) {
    const body = document.getElementById('ourAptBody');
    body.innerHTML = '';
    const o = report.ourApt;
    document.getElementById('ourAptName').textContent = o ? o.name : '-';
    if (o) {
        document.getElementById('titleApt').textContent = o.name;
        document.title = `${o.name} 신고가 브리핑`;
        document.getElementById('ourAptBadge').textContent =
            [o.districtName, o.umd].filter(Boolean).join(' ') || o.name;
    }
    if (!o) {
        body.appendChild(el('p', 'empty', '우리 아파트 데이터가 아직 없습니다.'));
        return;
    }

    body.appendChild(el('div', 'subhead', '최근 거래 · 같은 평형 인근 단지 비교'));
    if (o.recent && o.recent.length > 0) {
        for (const t of o.recent) {
            const row = el('div', 'mini-row');
            row.appendChild(el('span', 'mini-label', `${t.areaType}형 (${fmtArea(t.area)}㎡/${t.floor}층)`));
            row.appendChild(el('span', 'mini-price', formatMan(t.amountMan)));
            row.appendChild(el('span', 'mini-date', `${fmtDate(t.date)} 계약`));
            body.appendChild(row);

            // 같은 면적형 비교: 우리 단지 최고가 + 인근 단지 최고가
            const cmp = el('div', 'compare-row');
            cmp.appendChild(el('span', 'compare-label', `${t.areaType}형 최고가`));
            const ourMax = (o.records || []).find((r) => r.areaType === t.areaType);
            if (ourMax) {
                const chip = el('span', 'compare-chip ours');
                chip.innerHTML = `우리 <b>${formatMan(ourMax.max)}</b>`;
                cmp.appendChild(chip);
            }
            for (const n of t.neighbors || []) {
                const chip = el('span', 'compare-chip');
                chip.appendChild(document.createTextNode(`${n.apt} `));
                const b = el('b', null, formatMan(n.max));
                chip.appendChild(b);
                cmp.appendChild(chip);
            }
            if (cmp.childElementCount > 1) body.appendChild(cmp);
        }
    } else {
        body.appendChild(el('p', 'mini-empty', '최근 거래 없음'));
    }

    body.appendChild(el('div', 'subhead', '우리 단지 면적형별 신고가 (역대 최고)'));
    if (o.records && o.records.length > 0) {
        for (const r of o.records) {
            const row = el('div', 'mini-row');
            row.appendChild(el('span', 'mini-label', `${r.areaType}형 (${fmtArea(r.area)}㎡/${r.floor}층)`));
            row.appendChild(el('span', 'mini-price strong', formatMan(r.max)));
            row.appendChild(el('span', 'mini-date', `${fmtDate(r.date)} 계약`));
            body.appendChild(row);
        }
    } else {
        body.appendChild(el('p', 'mini-empty', '데이터 없음'));
    }
}

/* ── ② 인근 단지 신고가 ────────────────────────── */
function renderNeighbors(report) {
    const body = document.getElementById('neighborBody');
    body.innerHTML = '';
    document.getElementById('neighborUmd').textContent =
        report.ourApt ? report.ourApt.umd : '-';

    if (!report.neighbors || report.neighbors.length === 0) {
        body.appendChild(el('p', 'empty', '인근 단지 데이터가 아직 없습니다.'));
        return;
    }
    for (const n of report.neighbors) {
        const wrap = el('div', 'neighbor');
        wrap.appendChild(el('div', 'neighbor-name', n.apt));
        for (const r of n.records) {
            const row = el('div', 'mini-row');
            row.appendChild(el('span', 'mini-label', `${r.areaType}형 (${fmtArea(r.area)}㎡/${r.floor}층)`));
            row.appendChild(el('span', 'mini-price', formatMan(r.max)));
            row.appendChild(el('span', 'mini-date', `${fmtDate(r.date)} 계약`));
            wrap.appendChild(row);
        }
        body.appendChild(wrap);
    }
}

/* ── ③ 오늘의 신고가 ───────────────────────────── */
function renderRow(item, rank) {
    const row = el('div', 'trade-row');
    row.appendChild(el('span', 'rank', String(rank)));

    const main = el('div', 'trade-main');
    const top = el('div', 'trade-top');
    top.appendChild(el('span', 'apt-name', item.apt));
    top.appendChild(el('span', 'price', formatMan(item.amountMan)));
    top.appendChild(item.diffMan == null
        ? el('span', 'diff none', '신규')
        : el('span', 'diff', `▲${formatMan(item.diffMan)}`));
    main.appendChild(top);

    main.appendChild(el('div', 'trade-meta',
        `${item.umd} · ${fmtArea(item.area)}㎡ / ${item.floor}층 · ${fmtDate(item.date)} 계약`));

    row.appendChild(main);
    return row;
}

function renderToday(report) {
    const content = document.getElementById('content');
    content.innerHTML = '';

    const total = report.totalCount || 0;
    document.getElementById('countChip').textContent = `${total}건`;
    if (report.generatedAt) {
        document.getElementById('dateChip').textContent = `${report.generatedAt} 기준`;
        document.getElementById('dateBadge').textContent = report.generatedAt;
    }

    if (!report.districts || total === 0) {
        const empty = el('div', 'empty');
        empty.appendChild(el('strong', null, '이번에 새로 나온 신고가가 없습니다'));
        empty.appendChild(el('span', null, '다음 갱신(월·목 오전)을 기다려 주세요.'));
        content.appendChild(empty);
        return;
    }

    for (const district of report.districts) {
        content.appendChild(el('div', 'district-header', district.name));
        district.items.forEach((item, i) => {
            content.appendChild(renderRow(item, i + 1));
        });
    }
}

function render(report) {
    renderOurApt(report);
    renderNeighbors(report);
    renderToday(report);
}

async function load() {
    // 이미지 렌더링 모드: 데이터가 직접 주입된 경우 fetch 없이 렌더
    if (window.__REPORT__) {
        render(window.__REPORT__);
        return;
    }
    const useSample = new URLSearchParams(location.search).has('sample');
    const url = useSample ? 'data/sample-report.json' : 'data/report.json';
    try {
        const res = await fetch(`${url}?t=${Date.now()}`);
        if (!res.ok) throw new Error(String(res.status));
        render(await res.json());
    } catch {
        if (!useSample) {
            // 실데이터가 아직 없으면 샘플로 대체 시도
            try {
                const res = await fetch('data/sample-report.json');
                if (res.ok) {
                    render(await res.json());
                    return;
                }
            } catch { /* 무시 */ }
        }
        document.getElementById('content').innerHTML =
            '<p class="empty">데이터를 불러오지 못했습니다.</p>';
    }
}

load();
