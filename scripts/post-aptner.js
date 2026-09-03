'use strict';

/**
 * 아파트너(aptner.com) 자동 게시 스크립트 (Playwright 사용)
 *
 * 아파트너는 공개 API가 없어 웹 자동화로 게시한다.
 * 로그인 → 게시판 글쓰기 페이지 이동 → 제목/본문 입력 → 등록.
 *
 * 아파트너는 단지별 서브도메인을 쓴다 (예: https://skskyview.aptner.com).
 * APTNER_WRITE_URL 은 글쓰기 페이지 URL이어도 되고 게시판 목록 URL이어도 된다.
 * 목록 URL이면 페이지에서 '글쓰기' 버튼을 찾아 눌러 작성 화면으로 들어간다.
 *
 * 필수 환경변수
 *   APTNER_ID        아파트너 로그인 아이디
 *   APTNER_PW        아파트너 비밀번호
 *   APTNER_WRITE_URL 게시판 목록 또는 글쓰기 URL
 *                    (예: https://skskyview.aptner.com/v2/board/lists/comm)
 *
 * 선택 환경변수 (사이트 개편 시 셀렉터만 바꿔 대응)
 *   APTNER_LOGIN_URL   미지정 시 APTNER_WRITE_URL과 같은 도메인의 /v2/sign/in 사용
 *   APTNER_SEL_WRITE_BTN  글쓰기 버튼 셀렉터
 *   APTNER_SEL_ID      아이디 입력창 셀렉터
 *   APTNER_SEL_PW      비밀번호 입력창 셀렉터
 *   APTNER_SEL_LOGIN   로그인 버튼 셀렉터
 *   APTNER_SEL_TITLE   제목 입력창 셀렉터
 *   APTNER_SEL_BODY    본문 입력 영역 셀렉터
 *   APTNER_SEL_SUBMIT  등록 버튼 셀렉터
 *   DRY_RUN=1          등록 버튼을 누르기 직전까지만 실행(스크린샷 확인용)
 *
 * 실행 단계마다 out/shots/ 에 스크린샷을 남기므로,
 * 셀렉터가 맞지 않아 실패하면 스크린샷을 보고 셀렉터 환경변수를 조정하면 된다.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PATHS } = require('./lib');

const SHOTS = path.join(__dirname, '..', 'out', 'shots');

const env = (k, d) => process.env[k] || d;

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/**
 * 셀렉터를 못 찾았을 때 페이지 구조를 로그로 남긴다.
 * 아티팩트를 열어보지 않고도 로그만으로 올바른 셀렉터를 찾을 수 있게 하기 위함.
 */
async function dumpPageStructure(page, label) {
  console.log(`\n===== [${label}] 페이지 구조 진단 =====`);
  console.log('URL   :', page.url());
  console.log('TITLE :', await page.title().catch(() => '(제목 없음)'));

  const describe = async (frame, tag) => {
    try {
      const items = await frame.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll('input, textarea, select, button, a[role="button"], div[contenteditable="true"]')) {
          const r = e.getBoundingClientRect();
          out.push({
            tag: e.tagName.toLowerCase(),
            type: e.getAttribute('type') || '',
            name: e.getAttribute('name') || '',
            id: e.id || '',
            cls: (e.className || '').toString().slice(0, 60),
            ph: e.getAttribute('placeholder') || '',
            text: (e.innerText || e.value || '').trim().slice(0, 24),
            visible: r.width > 0 && r.height > 0,
          });
        }
        return out.slice(0, 40);
      });
      if (items.length === 0) return;
      console.log(`--- ${tag} (${items.length}개) ---`);
      for (const i of items) {
        console.log(
          `  <${i.tag}${i.type ? ` type=${i.type}` : ''}${i.name ? ` name=${i.name}` : ''}` +
            `${i.id ? ` id=${i.id}` : ''}${i.ph ? ` placeholder="${i.ph}"` : ''}` +
            `${i.cls ? ` class="${i.cls}"` : ''}> ${i.text}${i.visible ? '' : '  [숨김]'}`
        );
      }
    } catch (err) {
      console.log(`  (${tag} 조회 실패: ${err.message})`);
    }
  };

  await describe(page.mainFrame(), '메인 프레임');
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    console.log(`--- iframe: ${f.url()} ---`);
    await describe(f, 'iframe 내부');
  }
  console.log('===== 진단 끝 =====\n');
}

/** 여러 후보 셀렉터 중 처음 보이는 요소를 반환 */
async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 })) return loc;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

async function main() {
  const id = process.env.APTNER_ID;
  const pw = process.env.APTNER_PW;
  const writeUrl = process.env.APTNER_WRITE_URL;
  if (!id || !pw || !writeUrl) {
    console.log('APTNER_ID / APTNER_PW / APTNER_WRITE_URL 미설정 → 아파트너 게시를 건너뜁니다.');
    process.exit(0);
  }

  if (!fs.existsSync(PATHS.post)) {
    console.log('out/post.md 가 없어(새 신고가 없음) 게시를 건너뜁니다.');
    process.exit(0);
  }
  const postText = fs.readFileSync(PATHS.post, 'utf8');
  const [title, ...rest] = postText.split('\n');
  const body = rest.join('\n').trim();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20000);

  // 단지별 서브도메인이므로 로그인 주소를 글쓰기 URL에서 유추한다
  let loginUrl = process.env.APTNER_LOGIN_URL;
  if (!loginUrl) {
    try {
      loginUrl = `${new URL(writeUrl).origin}/v2/sign/in`;
    } catch {
      loginUrl = 'https://www.aptner.com/login';
    }
  }
  console.log('로그인 주소:', loginUrl);
  console.log('게시판 주소:', writeUrl);

  try {
    // 1) 로그인
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    // 로그인 폼이 스크립트로 그려지는 경우가 있어 네트워크가 잠잠해질 때까지 기다린다
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, '01-login-page');

    const idInput = await firstVisible(page, [
      env('APTNER_SEL_ID', ''),
      'input[name="id"]',
      'input[name="userId"]',
      'input[name="loginId"]',
      'input[type="email"]',
      'input[placeholder*="아이디"]',
      'input[type="text"]',
    ].filter(Boolean));
    const pwInput = await firstVisible(page, [
      env('APTNER_SEL_PW', ''),
      'input[name="password"]',
      'input[name="pw"]',
      'input[placeholder*="비밀번호"]',
      'input[type="password"]',
    ].filter(Boolean));
    if (!idInput || !pwInput) {
      await dumpPageStructure(page, '로그인 페이지');
      throw new Error(
        '로그인 입력창을 찾지 못했습니다. 위 진단 목록에서 아이디/비밀번호 입력 요소를 찾아 ' +
          'APTNER_SEL_ID / APTNER_SEL_PW 를 설정하거나, APTNER_LOGIN_URL 이 올바른지 확인하세요.'
      );
    }

    await idInput.fill(id);
    await pwInput.fill(pw);
    await shot(page, '02-login-filled');

    const loginBtn = await firstVisible(page, [
      env('APTNER_SEL_LOGIN', ''),
      'button[type="submit"]',
      'button:has-text("로그인")',
      'a:has-text("로그인")',
      'input[type="submit"]',
    ].filter(Boolean));
    if (!loginBtn) {
      await dumpPageStructure(page, '로그인 버튼 탐색');
      throw new Error('로그인 버튼을 찾지 못했습니다. APTNER_SEL_LOGIN을 설정하세요.');
    }
    await loginBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, '03-after-login');
    console.log('로그인 후 URL:', page.url());
    if (page.url().includes('/sign/in')) {
      await dumpPageStructure(page, '로그인 실패 추정');
      throw new Error('로그인 후에도 로그인 화면에 머물러 있습니다. 아이디·비밀번호를 확인하세요.');
    }

    // 2) 글쓰기 페이지 이동
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, '04-write-page');

    // 목록 페이지가 열렸다면 '글쓰기' 버튼을 눌러 작성 화면으로 이동
    const titleSelectors = [
      env('APTNER_SEL_TITLE', ''),
      'input[name="title"]',
      'input[placeholder*="제목"]',
      'input[type="text"]',
    ].filter(Boolean);

    if (!(await firstVisible(page, titleSelectors))) {
      const writeBtn = await firstVisible(page, [
        env('APTNER_SEL_WRITE_BTN', ''),
        'a:has-text("글쓰기")',
        'button:has-text("글쓰기")',
        'a:has-text("글 쓰기")',
        'button:has-text("글 쓰기")',
        'a:has-text("작성하기")',
        'button:has-text("작성하기")',
        '[class*="write"]',
      ].filter(Boolean));
      if (writeBtn) {
        console.log('목록 페이지로 판단 → 글쓰기 버튼 클릭');
        await writeBtn.click();
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        console.log('글쓰기 화면 URL:', page.url());
        await shot(page, '04b-after-write-btn');
      }
    }

    // 3) 제목/본문 입력
    const titleInput = await firstVisible(page, [
      env('APTNER_SEL_TITLE', ''),
      'input[name="title"]',
      'input[placeholder*="제목"]',
      'input[type="text"]',
    ].filter(Boolean));
    if (!titleInput) {
      await dumpPageStructure(page, '글쓰기 페이지');
      throw new Error('제목 입력창을 찾지 못했습니다. APTNER_SEL_TITLE을 설정하세요.');
    }
    await titleInput.fill(title);

    const bodySel = env('APTNER_SEL_BODY', '');
    let filledBody = false;
    const bodyCandidates = [
      bodySel,
      'textarea[name="content"]',
      'textarea',
      'div[contenteditable="true"]',
    ].filter(Boolean);
    for (const sel of bodyCandidates) {
      const loc = await firstVisible(page, [sel]);
      if (!loc) continue;
      const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'textarea' || tag === 'input') await loc.fill(body);
      else {
        await loc.click();
        await loc.evaluate((el, text) => { el.innerText = text; }, body);
      }
      filledBody = true;
      break;
    }
    // 에디터가 iframe(스마트에디터류)인 경우
    if (!filledBody) {
      for (const frame of page.frames()) {
        try {
          const editable = frame.locator('body[contenteditable="true"], div[contenteditable="true"]').first();
          if (await editable.isVisible({ timeout: 1500 })) {
            await editable.click();
            await editable.evaluate((el, text) => { el.innerText = text; }, body);
            filledBody = true;
            break;
          }
        } catch { /* 다음 프레임 */ }
      }
    }
    if (!filledBody) {
      await dumpPageStructure(page, '본문 입력 탐색');
      throw new Error('본문 입력 영역을 찾지 못했습니다. APTNER_SEL_BODY를 설정하세요.');
    }

    // 이미지 카드 첨부 (out/post-image.png가 있으면)
    const imgPath = path.join(__dirname, '..', 'out', 'post-image.png');
    if (fs.existsSync(imgPath)) {
      try {
        const fileInput = page.locator(env('APTNER_SEL_FILE', 'input[type="file"]')).first();
        await fileInput.setInputFiles(imgPath, { timeout: 8000 });
        await page.waitForTimeout(3000); // 업로드 완료 대기
        console.log('이미지 카드 첨부 완료.');
      } catch {
        console.warn('파일 첨부 입력을 찾지 못해 텍스트만 게시합니다. (APTNER_SEL_FILE 셀렉터로 지정 가능)');
      }
    }
    await shot(page, '05-form-filled');

    // 4) 등록
    if (process.env.DRY_RUN === '1') {
      console.log('DRY_RUN=1 → 등록 버튼 클릭 없이 종료합니다. 05-form-filled.png 를 확인하세요.');
      return;
    }
    const submitBtn = await firstVisible(page, [
      env('APTNER_SEL_SUBMIT', ''),
      'button:has-text("등록")',
      'button:has-text("작성")',
      'button:has-text("완료")',
      'button[type="submit"]',
    ].filter(Boolean));
    if (!submitBtn) {
      await dumpPageStructure(page, '등록 버튼 탐색');
      throw new Error('등록 버튼을 찾지 못했습니다. APTNER_SEL_SUBMIT을 설정하세요.');
    }
    await submitBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, '06-after-submit');
    console.log('아파트너 게시 완료.');
  } catch (err) {
    await shot(page, '99-error').catch(() => {});
    console.error('아파트너 게시 실패:', err.message);
    console.error('out/shots/ 스크린샷을 확인해 셀렉터 환경변수를 조정하세요.');
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
