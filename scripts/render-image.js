'use strict';

/**
 * report.json → 아파트너 게시용 이미지 카드(out/post-image.png) 렌더링.
 *
 * 웹페이지(docs/)와 동일한 디자인을 재사용한다:
 * index.html에 CSS·JS·데이터를 전부 인라인한 자체 완결 HTML을 만들어
 * Playwright(Chromium)로 스크린샷을 찍는다.
 *
 * 선택 환경변수
 *   CHROMIUM_PATH   크로미움 실행 파일 경로 (미지정 시 Playwright 기본)
 *   IMAGE_WIDTH     이미지 가로 CSS 픽셀 (기본 640, 2배율로 저장되어 실제 1280px)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PATHS, loadJson } = require('./lib');

const ROOT = path.join(__dirname, '..');
const OUT_HTML = path.join(ROOT, 'out', 'post-image.html');
const OUT_PNG = path.join(ROOT, 'out', 'post-image.png');

async function main() {
  const report = loadJson(PATHS.report, null);
  if (!report) {
    console.log('report.json이 없어 이미지를 생성하지 않습니다.');
    process.exit(0);
  }

  const width = parseInt(process.env.IMAGE_WIDTH || '640', 10);
  const indexHtml = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'docs', 'style.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');

  // 이미지 전용 보정: 고정 폭, 여백
  const imageCss = `
    body { max-width: ${width}px; padding: 26px 20px 40px; }
  `;

  const html = indexHtml
    .replace(
      '<link rel="stylesheet" href="style.css">',
      `<style>${css}\n${imageCss}</style>`
    )
    .replace(
      '<script src="app.js"></script>',
      `<script>window.__REPORT__ = ${JSON.stringify(report)};</script>\n<script>${appJs}</script>`
    );

  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  const launchOpts = {};
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({
    viewport: { width: width + 40, height: 1200 },
    deviceScaleFactor: 2, // 고해상도(레티나) 저장
  });
  await page.goto(`file://${OUT_HTML}`, { waitUntil: 'load' });
  await page.waitForSelector('#content .trade-row, #content .empty', { timeout: 10000 });
  await page.screenshot({ path: OUT_PNG, fullPage: true });
  await browser.close();

  const kb = Math.round(fs.statSync(OUT_PNG).size / 1024);
  console.log(`이미지 생성 완료 → ${OUT_PNG} (${kb}KB)`);
}

main().catch((err) => {
  console.error('이미지 렌더링 실패:', err);
  process.exit(1);
});
