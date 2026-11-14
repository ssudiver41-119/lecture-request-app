# 강의 의뢰 접수 웹앱 (lecture-request-app)

**119복지인권연구소 · ONEBLOCKAI연구소** — 이대영 강사(사회복지·돌봄·공공기관 AI 실무 교육)의
강의 의뢰를 받는 1페이지 웹앱입니다.

- 신청자가 의뢰서를 작성하면 → Vercel 서버리스 함수가 검증·스팸 차단 후
- **구글 드라이브**에 `[접수일] 기관명_강의의뢰서` Google 문서를 만들고
- **`강의의뢰_접수현황` Google 스프레드시트**에 1행을 누적합니다.
- 접수번호와 요약 카드, **의뢰 내용 복사** 버튼을 화면에 보여 줍니다.

빌드 도구 없이 GitHub → Vercel → Apps Script 만으로 배포됩니다.

---

## 1. 주요 기능

| 구분 | 내용 |
| --- | --- |
| 화면 | 한국어 단일 페이지, 모바일·PC 반응형, 인쇄 없이도 읽기 좋은 카드형 UI |
| 빠른 주제 선택 | 대표 강의 4종 칩 → 클릭 시 `희망 강의 주제` 란에 자동 입력(다시 누르면 해제) |
| 입력 항목 | 기관명\*, 담당자\*, 연락처\*, 이메일\*, 희망 날짜(KST 오늘 기본값), 희망 시간대, 진행 방식(대면/Zoom/혼합), 교육 대상, 예상 인원, 교육 시간, 예산·강사료, 희망 주제, 요청사항 |
| 개인정보 | 수집·이용 안내(항목·목적·보유기간·거부 권리) + 동의 체크 필수 |
| 스팸 차단 | 허니팟(숨김 필드) + IP 기준 Rate Limit(분당 3회 / 일 20회) |
| 저장 | Google 문서(의뢰서) + Google 스프레드시트 누적 + 문서 링크를 시트에 하이퍼링크 |
| 결과 안내 | 접수번호(`LR-YYYYMMDD-XXXX`), 요약 카드, 복사 버튼, 새 의뢰 작성 |
| 연동 전 상태 | `GOOGLE_DRIVE_WEBHOOK_URL` 미설정 시 503 대신 **데모 모드(200 + 안내문)** 로 동작해 화면 테스트 가능 |

---

## 2. 파일 구조

```
lecture-request-app/
├── index.html                     # 신청 화면 (HTML + CSS + JS 단일 파일)
├── api/submit.js                  # Vercel 서버리스 함수 (검증·Rate Limit·웹훅 전송)
├── lib/validate.js                # 검증/정규화 로직 (api 와 테스트가 공유)
├── apps-script/Code.gs            # Google Apps Script (드라이브 문서·시트 생성)
├── tests/api-submit.test.mjs      # API 테스트
├── tests/index-html.test.mjs      # 화면(마크업) 테스트
├── vercel.json                    # Vercel 설정 (함수 메모리/실행시간, no-store)
├── package.json                   # npm test 스크립트 (의존성 없음)
├── .env.example                   # 환경변수 예시
├── .gitignore                     # 비밀값·로그 제외
├── README.md
└── 구글드라이브_연동가이드.md      # 대표님이 따라 하실 상세 절차서
```

---

## 3. 로컬에서 테스트

```bash
cd lecture-request-app
node --test          # 또는 npm test
```

- Node.js 20 이상이면 됩니다(의존성 설치 불필요).
- 현재 테스트 **43건 전부 통과**: 필수값·형식·길이 검증, 허니팟, Rate Limit(분/일), 웹훅 성공·거절·오류·타임아웃, 데모 모드, 본문 크기 제한, 접수번호 형식, 화면 마크업·스크립트 문법.

브라우저에서 화면만 볼 때:

```bash
npx serve .           # http://localhost:3000
npx vercel dev        # API 까지 함께 (Vercel 로그인 필요)
```

> `index.html` 을 파일로 직접 열면 `/api/submit` 이 없으므로 접수는 실패합니다. 화면 확인 용도로만 쓰세요.

---

## 4. 배포 3단계

### 4-1. GitHub → Vercel

1. <https://vercel.com> 로그인 → **Add New… → Project**
2. GitHub 저장소 `ssudiver41-119/lecture-request-app` **Import**
3. Framework Preset: **Other**, Build Command·Output Directory: **비워 두기**
4. **Deploy** → `https://lecture-request-app-xxxx.vercel.app` 주소 생성

### 4-2. Google Apps Script 웹앱 만들기

`apps-script/Code.gs` 를 그대로 붙여넣고 웹 앱으로 배포합니다.
자세한 절차·스크린샷 없는 단계별 안내는 **[구글드라이브_연동가이드.md](./구글드라이브_연동가이드.md)** 를 보세요.

요약:
1. <https://script.google.com> → 새 프로젝트 → `Code.gs` 전체 교체 → 저장
2. (권장) 프로젝트 설정 → 스크립트 속성: `SHARED_TOKEN` = 임의의 긴 문자열
3. 배포 → 새 배포 → **웹 앱**, 실행 계정 **나**, 액세스 **모든 사용자** → 배포 → **웹 앱 URL** 복사

### 4-3. Vercel 환경변수 연결 후 재배포

Vercel → Project → **Settings → Environment Variables**

| 이름 | 값 | 필수 |
| --- | --- | --- |
| `GOOGLE_DRIVE_WEBHOOK_URL` | Apps Script 웹 앱 URL | ✅ |
| `WEBHOOK_SHARED_SECRET` | Apps Script 의 `SHARED_TOKEN` 과 같은 값 | 권장 |
| `RATE_LIMIT_PER_MINUTE` | 분당 접수 허용 횟수 (기본 3) | 선택 |
| `RATE_LIMIT_PER_DAY` | 일일 접수 허용 횟수 (기본 20) | 선택 |

저장 후 **Deployments → Redeploy** (환경변수는 재배포해야 반영됩니다).

### 4-4. 동작 확인

```bash
curl -X POST "https://<배포주소>/api/submit" \
  -H "Content-Type: application/json" \
  -d '{"orgName":"테스트복지관","contactName":"홍길동","phone":"010-1234-5678","email":"test@example.com","preferredDate":"2026-12-01","method":"대면","audience":"사회복지사","headcount":"30","duration":"2시간","topic":"실무자 생성형 AI 문서·서식 자동화","message":"연동 테스트","consent":true,"website":""}'
```

성공 시 `{"ok":true,"mode":"live","receiptNo":"LR-...","stored":{"docUrl":"...","sheetUrl":"...","folderUrl":"..."}}` 가 돌아오고,
드라이브에 `강의의뢰_접수` 폴더·문서·`강의의뢰_접수현황` 시트가 생깁니다.
확인 후 테스트 문서·행은 지워 주세요.

---

## 5. API 명세 — `POST /api/submit`

요청(JSON):

```json
{
  "orgName": "구래종합사회복지관",
  "contactName": "김복지",
  "phone": "010-1234-5678",
  "email": "staff@example.com",
  "preferredDate": "2026-12-01",
  "preferredTime": "오후 (13:00~18:00)",
  "method": "대면",
  "audience": "사회복지사",
  "audienceEtc": "",
  "headcount": "30",
  "duration": "2시간",
  "budget": "기관 기준 1회 60만원",
  "topic": "실무자 생성형 AI 문서·서식 자동화",
  "message": "노트북 지참 가능 여부 문의",
  "consent": true,
  "website": ""
}
```

| 필드 | 필수 | 규칙 |
| --- | --- | --- |
| `orgName` | ✅ | 1~100자 |
| `contactName` | ✅ | 1~50자 |
| `phone` | ✅ | 숫자 6~20자리, `0-9 + - ( ) 공백 .` 만 허용 |
| `email` | ✅ | 이메일 형식, 254자 이하 |
| `preferredDate` | — | `YYYY-MM-DD`, 실제 존재하는 날짜, KST 오늘 이후 |
| `preferredTime` | — | `오전 (09:00~12:00)` / `오후 (13:00~18:00)` / `저녁 (19:00~21:00)` / `협의 후 결정` |
| `method` | — | `대면` / `Zoom 온라인` / `혼합 (대면+온라인)` |
| `audience` | — | `사회복지사` / `요양·돌봄 실무자` / `장애인활동지원` / `공공기관·지자체` / `기타` |
| `audienceEtc` | — | 100자 |
| `headcount` | — | 1~1000 |
| `duration` | — | `90분` / `2시간` / `3시간` / `협의` |
| `budget` | — | 100자 |
| `topic` | — | 200자 |
| `message` | — | 2000자 |
| `consent` | ✅ | `true` 여야 접수 |
| `website` | — | **허니팟**: 값이 있으면 봇으로 보고 거절 |

응답:

| 상태 | `code` | 의미 |
| --- | --- | --- |
| 200 `mode:"live"` | — | 저장 완료 (`stored.docUrl`, `stored.sheetUrl`, `stored.folderUrl`) |
| 200 `mode:"demo"` | `WEBHOOK_NOT_CONFIGURED` | 연동 전 데모 모드 — 저장되지 않음, 안내문 반환 |
| 400 | `VALIDATION_ERROR` | `errors` 에 항목별 메시지 |
| 400 | `SPAM_DETECTED` | 허니팟 감지 |
| 400 | `INVALID_JSON` | 본문이 JSON 이 아님 |
| 405 | `METHOD_NOT_ALLOWED` | POST 이외 메서드 |
| 413 | `PAYLOAD_TOO_LARGE` | 본문 20KB 초과 |
| 429 | `RATE_LIMITED` | `scope: "minute" \| "day"`, `Retry-After` 헤더 |
| 502 | `WEBHOOK_ERROR` / `WEBHOOK_REJECTED` | Apps Script 오류 응답 |
| 504 | `WEBHOOK_UNREACHABLE` / `WEBHOOK_TIMEOUT` | Apps Script 연결 실패·8초 타임아웃 |

접수번호는 `LR-YYYYMMDD-XXXX` (혼동되기 쉬운 `O/0`, `I/1` 제외).

---

## 6. 구글 드라이브에 만들어지는 것

- 폴더: `강의의뢰_접수` (스크립트 속성 `PARENT_FOLDER_ID` 로 상위 폴더 지정 가능)
- 문서: `[2026-11-15] 구래종합사회복지관_강의의뢰서 (LR-20261115-AB3D)`
  - 제목·소속, 접수번호·접수일시, 기관/강의 정보 표, 요청사항
- 시트: `강의의뢰_접수현황` — 탭 `접수현황`
  - 접수일시 · 접수번호 · 기관명 · 담당자 · 연락처 · 이메일 · 희망날짜 · 희망시간대 · 진행방식 · 교육대상 · 예상인원 · 교육시간 · 예산·강사료 · 희망주제 · 요청사항 · 의뢰서문서(링크)
  - 머리글 자동 생성(고정 행), 열 너비·줄바꿈 자동 설정

설정은 Apps Script **프로젝트 설정 → 스크립트 속성**에서 바꿉니다(아래는 모두 선택).

| 속성 | 기본값 | 설명 |
| --- | --- | --- |
| `PARENT_FOLDER_ID` | (없음) | 폴더를 만들 상위 폴더 ID. 없으면 내 드라이브 최상위 |
| `FOLDER_NAME` | `강의의뢰_접수` | 저장 폴더 이름 |
| `SHEET_NAME` | `강의의뢰_접수현황` | 누적 시트 파일 이름 |
| `SHEET_TAB` | `접수현황` | 시트 탭 이름 |
| `SHARED_TOKEN` | (없음) | 설정 시 웹훅 호출에 `?token=` 필요 |

---

## 7. 화면 문구·항목 바꾸기

모두 `index.html` 안에서 수정합니다.

- 소속·강사 소개: `<header class="site">`, `<aside class="aside">`, `<footer class="site">`
- 대표 강의 칩: `.chips` 안의 `<button class="chip" data-topic="...">` (버튼 글자와 `data-topic` 을 함께 수정)
- 선택 항목(시간대·진행 방식·교육 대상·교육 시간): `<select>`/라디오의 `<option value="...">`
  - 값을 바꾸면 `lib/validate.js` 의 `OPTIONS` 도 같은 값으로 고쳐 주세요(서버가 목록 밖 값을 거절합니다).
- 입력 길이 상한: `maxlength` 속성과 `lib/validate.js` 의 `LIMITS`
- 색·글꼴: `:root` 의 CSS 변수(`--brand`, `--ink` …)
- 개인정보 보유기간 등 안내문: `<details class="privacy">` 안의 목록

---

## 8. 보안·개인정보

- **웹훅 URL 은 서버에서만** 사용합니다. 브라우저(HTML/JS)에는 절대 넣지 않습니다.
- Apps Script 액세스를 `모든 사용자`로 두는 경우 `SHARED_TOKEN` 을 설정하세요. 토큰이 없으면 URL 을 아는 누구나 가짜 접수를 넣을 수 있습니다.
- 허니팟 필드(`website`)는 화면 밖으로 밀어 두고 `tabindex="-1"`, `aria-hidden` 으로 접근성도 해치지 않게 했습니다.
- 접수 데이터에는 IP·쿠키를 저장하지 않습니다. IP 는 메모리 Rate Limit 에만 쓰고 외부로 보내지 않습니다.
- 개인정보(기관명·담당자·연락처·이메일)는 구글 드라이브 계정 안에만 저장됩니다. 공유 범위는 드라이브 폴더 권한을 따릅니다.
- **운영 시 참고**: Rate Limit 은 서버리스 인스턴스 메모리 기반이라 인스턴스가 여러 개 뜨면 한도가 인스턴스별로 적용됩니다(느슨해짐). 스팸이 문제가 되면 ① Vercel KV/Upstash Redis 로 교체, ② Cloudflare Turnstile 같은 CAPTCHA 추가, ③ Apps Script 쪽에서 하루 접수 건수 제한을 두는 방법이 있습니다.
- 비밀값은 `.env`/Vercel 환경변수에만 두고 저장소에 커밋하지 않습니다(`.gitignore` 처리됨).

---

## 9. 문제 해결

| 증상 | 확인 |
| --- | --- |
| 접수 후 "데모 모드" 안내가 뜬다 | Vercel 에 `GOOGLE_DRIVE_WEBHOOK_URL` 이 없거나, 추가 후 Redeploy 를 안 했습니다 |
| 502 `WEBHOOK_REJECTED`, "인증 토큰이 올바르지 않습니다" | `WEBHOOK_SHARED_SECRET` 과 Apps Script `SHARED_TOKEN` 값이 다릅니다 |
| 504 `WEBHOOK_UNREACHABLE` | Apps Script 배포 액세스가 `모든 사용자`인지, URL 이 `/exec` 로 끝나는지 확인 |
| 문서·시트가 안 생긴다 | Apps Script 편집기에서 `setupDrive()` 를 한 번 실행해 권한 승인·폴더 생성을 먼저 하세요 |
| 코드를 고쳤는데 반영이 안 된다 | `배포 관리` → 기존 배포 편집 → 새 버전 (새 배포를 만들면 URL 이 바뀝니다) |

더 자세한 절차와 오류별 대응은 [구글드라이브_연동가이드.md](./구글드라이브_연동가이드.md) 에 있습니다.

---

## 10. 라이선스

비공개 운영용 코드입니다(UNLICENSED). 저장소가 Public 이므로 코드는 공개되지만, 재사용·재배포는 119복지인권연구소·ONEBLOCKAI연구소의 허락이 필요합니다.
