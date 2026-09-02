# 수원 신고가 브리핑 🔥

수원시(장안구·권선구·팔달구·영통구) 아파트 실거래를 자동 집계해서

1. **웹페이지**(GitHub Pages)에 보여주고,
2. 매주 **월·목 오전 8:30(KST)** 에 아파트 커뮤니티 **아파트너에 자동 게시**하는 프로젝트입니다.

브리핑 구성 (페이지·게시글 동일):

1. 🏠 **우리 아파트(수원SK스카이뷰)** — 최근 거래가 + 면적형별 신고가(역대 최고)
2. 🏘 **인근 단지 신고가** — 같은 정자동 단지들의 면적형별 역대 최고가
3. 📈 **오늘의 수원 신고가** — 최근 계약 중 새로 나온 신고가 전체 목록

우리 아파트·인근 단지 기준은 `config.json` 에서 변경할 수 있습니다.

데이터 출처: 국토교통부 실거래가 공개시스템 (공공데이터포털 API)

## 신고가 기준

- **같은 단지 · 전용면적형(㎡ 정수 절사 기준)별 역대 최고 거래가** (예: 84.94㎡와 84.78㎡는 같은 "84형")
- 해당 면적형의 첫 거래는 `신규`로 표시
- 해제 신고된 거래는 제외. 실거래 신고는 계약 후 최대 30일 지연될 수 있어 매 실행 시 최근 3개월치를 다시 확인합니다.

## 구조

```
config.json            # 우리 아파트·인근 단지 설정
docs/                  # 웹페이지 (GitHub Pages, main 브랜치 /docs)
  index.html, style.css, app.js
  data/report.json     # 최신 브리핑 리포트 (자동 갱신)
scripts/
  backfill.js          # 2006년~현재 전체 실거래로 역대 최고가 DB 구축 (최초 1회)
  update.js            # 최근 3개월 조회 → 신고가 탐지 → 리포트 생성
  make-post.js         # 리포트 → 아파트너 게시글 텍스트 생성
  post-aptner.js       # Playwright로 아파트너 로그인 후 게시
data/
  max-prices.json      # 단지·면적형별 역대 최고가 DB
  our-apt-trades.json  # 우리 아파트 전체 거래 이력 (최근 거래 표시용)
  announced.json       # 이미 게시한 거래 (중복 게시 방지)
.github/workflows/update-and-post.yml  # 월·목 08:30 KST 자동 실행
```

## 최초 설정 (한 번만)

### 1. 국토부 실거래가 API 키 발급

1. [공공데이터포털](https://www.data.go.kr) 가입 → **"국토교통부_아파트 매매 실거래가 자료"** 검색 → 활용신청 (자동승인)
2. 마이페이지에서 **일반 인증키(Encoding)** 복사 ← 반드시 *Encoding* 키

### 2. GitHub Secrets 등록

저장소 **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | 값 | 필수 |
|---|---|---|
| `MOLIT_API_KEY` | 공공데이터포털 인증키(Encoding) | ✅ |
| `APTNER_ID` | 아파트너 로그인 아이디 | 게시 시 |
| `APTNER_PW` | 아파트너 비밀번호 | 게시 시 |
| `APTNER_WRITE_URL` | 아파트너 게시판 **글쓰기 페이지 URL** | 게시 시 |

> 아파트너 미설정 시에도 데이터 갱신·웹페이지는 정상 동작하고, 게시글 텍스트가 Actions 아티팩트(`run-output`)로 남으므로 복사해서 수동 게시할 수 있습니다.

### 3. 역대 최고가 DB 백필 (최초 1회)

**Actions 탭 → "수원 신고가 갱신·아파트너 게시" → Run workflow → `backfill` 체크 → 실행**

2006년 1월부터 현재까지 약 1,000회 API를 호출합니다(20~30분 소요). 중간에 실패해도 진행 상황이 저장되므로 다시 실행하면 이어서 합니다.

### 4. GitHub Pages 켜기

**Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**

몇 분 후 `https://<계정>.github.io/suwon-newhigh/` 에서 페이지 확인.
샘플 데이터 미리보기: `?sample=1` 붙이기.

### 5. 아파트너 게시 테스트

**Run workflow → `dry_run` 체크 → 실행** 하면 등록 버튼을 누르기 직전까지만 진행하고, 단계별 스크린샷을 아티팩트로 남깁니다. 스크린샷을 보고 입력창을 못 찾으면 아래 Secret(또는 Variables)으로 셀렉터를 지정하세요:

`APTNER_LOGIN_URL`, `APTNER_SEL_ID`, `APTNER_SEL_PW`, `APTNER_SEL_LOGIN`, `APTNER_SEL_TITLE`, `APTNER_SEL_BODY`, `APTNER_SEL_SUBMIT`

## 운영

- 매주 **월·목 08:30 KST** 자동 실행: 데이터 갱신 → 웹페이지 리포트 커밋 → 새 신고가가 있으면 아파트너 게시
- 새 신고가가 없으면 게시하지 않습니다 (빈 글 방지)
- 수동 실행: Actions 탭에서 언제든 Run workflow

## 로컬 실행

```bash
export MOLIT_API_KEY=발급받은키
node scripts/backfill.js   # 최초 1회
node scripts/update.js     # 신고가 탐지 + 리포트 생성
node scripts/make-post.js  # 게시글 텍스트 생성 (out/post.md)
node scripts/test.js       # 단위 테스트
```

## 유의사항

- 아파트너는 공개 API가 없어 웹 자동화(Playwright)로 게시합니다. 아파트너 사이트가 개편되면 셀렉터 조정이 필요할 수 있습니다.
- 본 데이터는 참고용이며, 국토부 신고 시점에 따라 결과가 추후 변경될 수 있습니다.
