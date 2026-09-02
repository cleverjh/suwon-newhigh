'use strict';

/* 아파트너 게시용 이미지 카드 렌더러 (Claude Design 시안 구현)
   - 우리 단지 vs 인근 단지: 면적형별 최고가 막대 비교 + 금액차
   - 우리 단지 최근 거래: 역대 최고가 대비 증감
   - 오늘의 수원 신고가: 구별 상위 N건만 (전체는 웹페이지에서 확인) */

const CARD_OPTIONS = {
    compareTypes: [59, 84], // 막대 비교에 쓸 전용면적형
    topN: 3,                // 구별 노출 건수
    showRecent: true,
};

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

function setText(id, text) {
    const e = document.getElementById(id);
    if (e) e.textContent = text;
}

/** 면적형 하나에 대한 우리 단지·인근 단지 최고가 막대 묶음 */
function buildCompareBlock(report, areaType) {
    const o = report.ourApt;
    const ourRec = (o.records || []).find((x) => x.areaType === areaType);
    const ourMax = ourRec ? ourRec.max : 0;

    const entries = [];
    if (ourRec) entries.push({ name: `우리 단지 (${o.name})`, price: ourMax, ours: true });
    for (const n of report.neighbors || []) {
        const rec = (n.records || []).find((x) => x.areaType === areaType);
        if (rec) entries.push({ name: n.apt, price: rec.max, ours: false });
    }
    if (entries.length === 0) return null;

    entries.sort((a, b) => b.price - a.price);
    const max = entries[0].price || 1;

    const wrap = document.createElement('div');
    wrap.appendChild(el('div', 'band', `${areaType}형 최고가 비교 (전용 ${areaType}㎡대)`));

    const bars = el('div', 'bars');
    for (const e of entries) {
        const row = el('div', 'bar-row');
        row.appendChild(el('span', `bar-name ${e.ours ? 'ours' : 'other'}`, e.name));

        const track = el('span', 'bar-track');
        const fill = el('span', `bar-fill${e.ours ? ' ours' : ''}`);
        // 금액이 작아도 막대가 보이도록 최소 16%
        fill.style.width = `${Math.max(16, Math.round((e.price / max) * 100))}%`;
        track.appendChild(fill);
        row.appendChild(track);

        row.appendChild(el('span', `bar-price${e.ours ? ' ours' : ''}`, formatMan(e.price)));

        // 우리 단지 최고가를 기준으로 한 차이
        const d = e.price - ourMax;
        let cls = 'chip same';
        let label = '동일';
        if (e.ours) {
            cls = 'chip base';
            label = '기준';
        } else if (d > 0) {
            cls = 'chip up';
            label = `+${formatMan(d)}`;
        } else if (d < 0) {
            cls = 'chip down';
            label = `−${formatMan(-d)}`;
        }
        row.appendChild(el('span', cls, label));
        bars.appendChild(row);
    }
    wrap.appendChild(bars);
    return wrap;
}

function renderCompare(report) {
    const host = document.getElementById('compare');
    if (!host || !report.ourApt) return;
    host.innerHTML = '';
    for (const type of CARD_OPTIONS.compareTypes) {
        const block = buildCompareBlock(report, type);
        if (block) host.appendChild(block);
    }
}

function renderRecent(report) {
    const host = document.getElementById('recent');
    if (!host || !report.ourApt) return;
    host.innerHTML = '';
    const rows = report.ourApt.recent || [];
    if (!CARD_OPTIONS.showRecent || rows.length === 0) return;

    host.appendChild(el('div', 'band', '우리 단지 최근 거래'));
    for (const t of rows) {
        const row = el('div', 'recent-row');
        row.appendChild(el('span', 'recent-label', `${t.areaType}형 (${fmtArea(t.area)}㎡/${t.floor}층)`));
        row.appendChild(el('span', 'recent-price', formatMan(t.amountMan)));

        const vs = t.vsOurMaxMan;
        let vsLabel = '';
        let vsCls = 'recent-vs';
        if (vs != null) {
            if (vs > 0) {
                vsLabel = `신고가 경신 +${formatMan(vs)}`;
                vsCls = 'recent-vs up';
            } else if (vs < 0) {
                vsLabel = `최고가 대비 −${formatMan(-vs)}`;
            } else {
                vsLabel = '최고가 동일';
            }
        }
        row.appendChild(el('span', vsCls, vsLabel));
        row.appendChild(el('span', 'recent-date', `${fmtDate(t.date)} 계약`));
        host.appendChild(row);
    }
}

function renderToday(report) {
    const host = document.getElementById('today');
    if (!host) return;
    host.innerHTML = '';

    const topN = CARD_OPTIONS.topN;
    setText('topTag', `구별 TOP ${topN}`);
    setText('totalTag', `전체 ${report.totalCount || 0}건 중`);

    const districts = report.districts || [];
    if (districts.length === 0) {
        const empty = el('div', 'recent-row');
        empty.appendChild(el('span', 'recent-label', '이번에 새로 나온 신고가가 없습니다.'));
        host.appendChild(empty);
        return;
    }

    for (const d of districts) {
        const head = el('div', 'district');
        head.appendChild(el('span', 'district-name', d.name));
        head.appendChild(el('span', 'district-count',
            `전체 ${d.items.length}건 중 상위 ${Math.min(topN, d.items.length)}건`));
        host.appendChild(head);

        d.items.slice(0, topN).forEach((it, i) => {
            const row = el('div', `item${i % 2 === 0 ? ' odd' : ''}`);
            row.appendChild(el('span', 'rank', String(i + 1)));
            row.appendChild(el('span', 'item-apt', it.apt));
            row.appendChild(el('span', 'item-meta',
                `${it.umd} · ${fmtArea(it.area)}㎡/${it.floor}층 · ${fmtDate(it.date)}`));
            row.appendChild(el('span', 'item-price', formatMan(it.amountMan)));
            row.appendChild(it.diffMan == null
                ? el('span', 'item-diff new', '신규')
                : el('span', 'item-diff up', `▲${formatMan(it.diffMan)}`));
            host.appendChild(row);
        });
    }
}

function render(report) {
    if (report.ourApt) {
        setText('headApt', report.ourApt.name);
        document.title = `${report.ourApt.name} 신고가 브리핑 카드`;
    }
    setText('headSub', `국토부 실거래가 기준 · ${report.generatedAt || ''}`.trim());

    for (const [name, fn] of [['비교', renderCompare], ['최근 거래', renderRecent], ['오늘의 신고가', renderToday]]) {
        try {
            fn(report);
        } catch (err) {
            console.error(`${name} 렌더링 실패:`, err);
        }
    }
    document.documentElement.dataset.rendered = '1';
}

async function load() {
    // 이미지 렌더링 시에는 데이터가 주입되어 들어온다
    if (window.__REPORT__) {
        render(window.__REPORT__);
        return;
    }
    try {
        const res = await fetch(`data/report.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(String(res.status));
        render(await res.json());
    } catch {
        try {
            const res = await fetch('data/sample-report.json');
            if (res.ok) render(await res.json());
        } catch { /* 무시 */ }
    }
}

load();
