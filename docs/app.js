'use strict';

/* 수원 오늘의 신고가 — report.json 렌더링 */

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

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

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

    const [y, m, d] = item.date.split('-');
    main.appendChild(el('div', 'trade-meta',
        `${item.umd} · ${item.area}㎡ / ${item.floor}층 · ${y.slice(2)}.${m}.${d} 계약`));

    row.appendChild(main);
    return row;
}

function render(report) {
    const content = document.getElementById('content');
    content.innerHTML = '';

    const total = report.totalCount || 0;
    document.getElementById('cityBadge').textContent = `${report.city} ${total}건`;
    document.getElementById('totalBadge').textContent = `총 ${total}건`;
    document.getElementById('countChip').textContent = `${total}건`;
    if (report.generatedAt) {
        document.getElementById('dateChip').textContent = `${report.generatedAt} 기준`;
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

async function load() {
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
