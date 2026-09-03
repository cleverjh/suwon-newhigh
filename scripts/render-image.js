'use strict';

/**
 * report.json → 아파트너 게시용 이미지 카드(out/post-image.png) 렌더링.
 *
 * docs/card.html(게시용 카드 전용 디자인)에 CSS·JS·데이터를 인라인한
 * 자체 완결 HTML을 만들어 Playwright(Chromium)로 스크린샷을 찍는다.
 * 웹페이지(docs/index.html)는 전체 목록, 카드는 요약(구별 TOP N) 구성이다.
 *
 * 선택 환경변수
 *   CHROMIUM_PATH   크로미움 실행 파일 경로 (미지정 시 Playwright 기본)
 *   IMAGE_SCALE     저장 배율 (기본 2 → 가로 1280px, 용량이 크면 1.5나 1로)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PATHS, loadJson } = require('./lib');

const ROOT = path.join(__dirname, '..');
const OUT_HTML = path.join(ROOT, 'out', 'post-image.html');
const OUT_PNG = path.join(ROOT, 'out', 'post-image.png');
// 본문에 data URI 로 직접 넣어야 할 때 쓰는 경량본 (PNG 는 base64 로 바꾸면 너무 커진다)
const OUT_JPG = path.join(ROOT, 'out', 'post-image.jpg');

async function main() {
  const report = loadJson(PATHS.report, null);
  // 아파트너 업로드 용량을 고려해 기본 2배율, IMAGE_SCALE로 조정 가능
  const scale = parseFloat(process.env.IMAGE_SCALE || '2');
  if (!report) {
    console.log('report.json이 없어 이미지를 생성하지 않습니다.');
    process.exit(0);
  }

  const cardHtml = fs.readFileSync(path.join(ROOT, 'docs', 'card.html'), 'utf8');
  const cardJs = fs.readFileSync(path.join(ROOT, 'docs', 'card.js'), 'utf8');

  const html = cardHtml.replace(
    '<script src="card.js?v=1"></script>',
    `<script>window.__REPORT__ = ${JSON.stringify(report)};</script>\n<script>${cardJs}</script>`
  );

  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  const launchOpts = {};
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({
    viewport: { width: 700, height: 1200 },
    deviceScaleFactor: scale,
  });
  await page.goto(`file://${OUT_HTML}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.rendered === '1', { timeout: 15000 });
  // 웹폰트(Pretendard)가 적용된 뒤에 찍는다 — 실패해도 시스템 폰트로 진행
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const card = page.locator('#card');
  await card.screenshot({ path: OUT_PNG });
  await card.screenshot({ path: OUT_JPG, type: 'jpeg', quality: 82 });
  await browser.close();

  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(`이미지 생성 완료 → ${OUT_PNG} (${kb(OUT_PNG)}KB), ${OUT_JPG} (${kb(OUT_JPG)}KB)`);
}

main().catch((err) => {
  console.error('이미지 렌더링 실패:', err);
  process.exit(1);
});
