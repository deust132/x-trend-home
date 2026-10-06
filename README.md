# 리서치 데스크 — AI 트렌드 리포트

정적 사이트(`index.html`, `app.js`, `styles.css`, `data/*.json`) + Vercel 서버리스 함수(`api/`).

| 경로 | 역할 |
|---|---|
| `api/chat.js` | 챗봇 (`POST /api/chat`) |
| `api/auth.js` | 로그인 4개 경로를 한 함수에서 처리(`vercel.json` rewrite → `?route=`) |
| └ `/api/auth/login` | `GET /api/auth/login?return=<경로>` — Google 로그인 화면으로 이동 |
| └ `/api/auth/callback` | `GET /api/auth/callback` — Google이 돌려보내는 주소. 세션 쿠키 발급 |
| └ `/api/auth/logout` | `POST /api/auth/logout` — 세션 쿠키 삭제 |
| └ `/api/auth/me` | `GET /api/auth/me` — 로그인 상태 `{ user, loginReady }` |
| `api/bookmarks.js` | `GET`(목록) · `POST {item}`(저장) · `DELETE {url}`(해제) — 로그인 필수 |
| `api/rss.js` | `GET /api/rss` — 아카이브 최신 30건 RSS 2.0 피드 (10분 CDN 캐시) |
| `api/_lib/` | 공용 모듈(세션·KV). 밑줄로 시작하는 경로는 Vercel이 함수로 배포하지 않는다 |
| `vercel.json` | Hobby 플랜 함수 12개 제한 때문에 하위 경로(`/api/auth/*`, `/api/jev/*`, `/api/likes/top`, `/api/submit/approve`)를 통합 파일(`api/auth.js`·`api/jev.js`·`api/likes.js`·`api/submit.js`)의 `?route=`로 넘기는 rewrite. `api/` 함수는 11개 |

외부 npm 패키지는 쓰지 않는다(Node 18+ 내장 `fetch`·`crypto`만 사용).

## 로그인·북마크 설정

필요한 환경변수는 모두 Vercel 프로젝트 **Settings → Environment Variables**에 넣는다. 코드·저장소에는 비밀값을 두지 않는다.

| 변수 | 필수 | 설명 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ✔ | Google OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | ✔ | Google OAuth 클라이언트 보안 비밀 |
| `SESSION_SECRET` | ✔ | 세션 쿠키 서명 키. 32자 이상 무작위 문자열 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | ✔ | 북마크 저장소(Upstash Redis). `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 이름도 받는다 |
| `PUBLIC_BASE_URL` | 선택 | 예: `https://x-trend-b.vercel.app`. 지정하면 OAuth 콜백 주소를 이 값으로 고정한다. 비우면 요청 호스트를 쓴다 |

세 가지 로그인 변수 중 하나라도 없으면 헤더에 "로그인 준비 중"이 뜨고, 나머지 기능(리포트·아카이브·검색·챗봇)은 그대로 동작한다.

### 1. Google OAuth 클라이언트 만들기

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 선택(또는 생성).
2. **Google Auth Platform → Branding / Audience**(구 "OAuth 동의 화면")에서 앱 이름·지원 이메일을 넣는다. 범위는 기본값(`openid`, `email`, `profile`)이면 충분하다. 테스트 단계라면 Audience의 테스트 사용자에 본인 Google 계정을 추가한다.
3. **Clients → Create client** → 유형 **Web application**.
4. **Authorized redirect URIs**에 배포 주소별로 콜백을 추가한다(글자 하나까지 정확히 일치해야 한다):
   - `https://<프로덕션 도메인>/api/auth/callback` (예: `https://x-trend-b.vercel.app/api/auth/callback`)
   - 로컬 개발용: `http://localhost:3000/api/auth/callback`
5. 생성된 Client ID와 Client secret을 Vercel 환경변수 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣는다.

> 미리보기(Preview) 배포는 주소가 배포마다 달라서 Google에 미리 등록할 수 없다. 미리보기에서 로그인까지 시험하려면 고정 도메인을 붙이거나, 로그인 시험은 프로덕션·로컬에서 한다.

### 2. 세션 키

```bash
openssl rand -hex 32   # 출력값을 SESSION_SECRET으로 등록
```

키를 바꾸면 기존 로그인 세션이 모두 풀린다(강제 로그아웃이 필요할 때 쓰면 된다).

### 3. 북마크 저장소 (Vercel KV = Upstash Redis)

Vercel KV는 현재 Vercel Marketplace의 **Upstash for Redis**로 제공된다.

1. Vercel 대시보드 → 프로젝트 → **Storage → Create Database → Upstash (Redis)** 선택 → 프로젝트에 연결.
2. 연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN`(또는 `UPSTASH_REDIS_REST_*`)이 자동으로 환경변수에 들어간다. 다른 이름으로 들어갔다면 위 표의 이름으로 맞춰 준다.

저장 구조: 사용자마다 Redis 해시 하나(`bm:v1:<Google 계정 sub>`). 필드는 원문 URL의 SHA-256 앞 32자, 값은 항목 스냅숏 JSON(제목·요약·인사이트·분류·원문 URL·저장 시각). 원본 리포트가 아카이브에서 빠져도 북마크에는 남는다. 사용자당 최대 500건.

### 4. 배포·로컬 실행

```bash
vercel env pull .env.local   # 환경변수를 로컬로(이 파일은 커밋하지 않는다)
vercel dev                   # http://localhost:3000 — 정적 파일 + /api/* 함수
vercel --prod                # 프로덕션 배포
```

`python3 -m http.server`로 열면 `/api/*`가 없으므로 로그인 영역과 저장 버튼이 자동으로 숨고, 나머지 기능만 동작한다.

## Jev 분석 API (OpenRouter)

| 변수 | 필수 | 설명 |
|---|---|---|
| `OPENROUTER_API_KEY` | ✔ | OpenRouter API 키. 없으면 `/api/jev/*`가 500 "Jev 설정이 필요합니다" |
| `JEV_MODEL` | | 기본값 `typesafe/jev-router` (OpenRouter "TypeSafe: Jev Router") |

모두 POST + JSON, temperature 0.1. 공용 호출 로직은 `api/_lib/jev.js`, 세 경로 모두 `api/jev.js` 한 함수가 처리한다.

- `/api/jev/categorize` — `{title, summary}` → `{category, confidence}` (8개 분류 밖 이름은 `기타`, confidence 0)
- `/api/jev/score` — `{title, summary, query}` → `{score}` (0~1)
- `/api/jev/duplicates` — `{items: [{id, title, summary}]}`(최대 100개) → `{duplicates: [{id1, id2, reason}]}` (입력에 없는 id·자기 자신·반복 쌍 제거)

## 동작 방식과 보안

- **로그인 흐름**: Authorization Code + PKCE(S256). `state`와 PKCE verifier는 서명된 10분짜리 임시 쿠키에 담아 콜백에서 대조한다. 토큰 교환은 서버에서만 하며 클라이언트 보안 비밀은 브라우저로 나가지 않는다.
- **id_token 확인**: Google 토큰 엔드포인트에서 TLS로 직접 받은 토큰이므로 서명 검증 대신 `iss`·`aud`·`exp`·`email_verified`를 확인한다(OpenID Connect Core 3.1.3.7).
- **세션**: 서버 저장 없이 HMAC-SHA256으로 서명한 쿠키 `rd_session`(`HttpOnly; Secure; SameSite=Lax`, 30일). 담는 정보는 Google 계정 `sub`·이메일·이름·프로필 사진 주소뿐이고 Google 액세스 토큰은 저장하지 않는다.
- **API 보호**: `/api/bookmarks`는 유효한 세션이 없으면 401. 쓰기 요청(`POST`·`DELETE`)과 로그아웃은 `Origin`이 사이트 주소와 같을 때만 받는다(SameSite 쿠키에 더한 CSRF 2중 방어). 로그인 후 돌아갈 주소는 사이트 내부 경로만 허용한다.
- **입력 정리**: 북마크 항목은 정해진 필드만 길이 제한을 두고 저장하며, 원문 URL은 `http(s)`만 받는다.
- 로그인 실패 시 사용자는 `/?login=failed`로 돌아가 안내 문구를 보고, 상세 사유는 Vercel 함수 로그에만 남는다.

## 공유 · 댓글 · RSS

- **카드 고정 주소**: `/#item=x-<트윗 번호>`. 같은 원문이면 오늘의 리포트·아카이브·북마크 어디서든 같은 주소다. 공유 링크·RSS 항목 링크·댓글 스레드가 모두 이 키를 쓴다(`app.js` `itemKey` = `api/rss.js` `itemKey`).
- **공유 버튼**: Web Share API가 있으면(대부분의 모바일) 기기 공유 시트, 없으면 카드 안에 X · 카카오톡 · 텔레그램 · 링크 복사 버튼.
  - 카카오톡: `app.js`의 `KAKAO_JS_KEY`에 Kakao Developers JavaScript 키를 넣고 플랫폼 → Web에 사이트 도메인을 등록하면 카카오톡으로 바로 보낸다. 비어 있으면 링크를 복사하고 "카카오톡에 붙여 넣어 주세요"라고 안내한다.
- **댓글(giscus)**: 카드의 "💬 댓글" 버튼을 누르면 GitHub Discussions 기반 giscus를 그 카드 안에 띄운다(한 번에 하나). 테마는 페이지 배경 밝기(또는 `<html data-theme>`)를 따라 light/dark로 맞춘다.
  1. `deust132/x-trend-home` → Settings → General → Features → **Discussions** 체크(공개 저장소여야 함).
  2. https://github.com/apps/giscus 에서 앱을 이 저장소에 설치.
  3. https://giscus.app/ko 에서 저장소 입력 → 카테고리 **Announcements** 선택 → 생성된 `data-category-id` 값을 `app.js`의 `GISCUS.categoryId`에 넣는다. (`repoId`는 이미 `R_kgDOU8F1mA`로 채워 둠)
  - `categoryId`가 비어 있으면 댓글 창 대신 "준비 중" 안내가 보인다.
- **RSS**: `/api/rss` (`index.html`에 `<link rel="alternate">`, 꼬리말에 "RSS 구독" 링크). 서버 번들의 `data/archive.json`을 읽고, 없으면 같은 사이트의 `/data/archive.json`을 받아 온다. 주소는 `PUBLIC_BASE_URL`(없으면 요청 호스트) 기준.

## 좋아요 · 주간 베스트 · 트렌드 리포트 · 주간 다이제스트 (Phase 2)

모두 기존 북마크와 같은 Upstash KV(`KV_REST_API_URL`/`KV_REST_API_TOKEN` 또는 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`)를 쓴다. KV가 없으면 좋아요 버튼은 숨겨지고, 트렌드 리포트·다이제스트 미리보기는 KV 없이도 집계된다.

| 경로 | 내용 |
|---|---|
| `GET /api/likes?itemId=<키>` | 누적 좋아요 수 `{ itemId, likes, liked }` |
| `GET /api/likes?ids=<키>,<키>…` | 카드 여러 장(최대 200개) `{ likes: {키: n}, liked: [...] }` |
| `POST /api/likes` `{ itemId }` | 좋아요 +1 `{ ok, likes, already }` — 로그인 사용자는 계정당 1회, 비로그인은 IP·브라우저 해시당 1회(30일) + 화면 localStorage |
| `GET /api/likes/top?period=week\|month` | 최근 7·30일 좋아요 TOP 10 |
| `GET /api/trends-report?period=week\|month[&date=YYYY-MM-DD]` | 가장 많이 저장된 글 TOP 5 · 급상승 카테고리 · 새 태그 트렌드(JSON) |
| `GET /api/digest[?period=…&note=…&format=html\|text\|json]` | 다이제스트 이메일 미리보기 |
| `POST /api/digest` `{ to?, note?, dryRun? }` + `Authorization: Bearer <DIGEST_SECRET 또는 CRON_SECRET>` | Resend 발송(to가 있으면 테스트 발송, 없으면 구독자 전원) |

- 항목 키는 카드 고정 주소와 같다(`x-<번호>`, 그 밖의 출처는 id의 기호를 `-`로 바꾼 값 예: `th:DeIZu…` → `th-DeIZu…`). 목록(archive.json·daily.json)에 없는 키는 좋아요를 받지 않는다.
- KV 키: `likes:<키>`(누적), `likes:day:<날짜>`·`saves:day:<날짜>`(일별 정렬 집합, 40일 보관), `likes:all`·`saves:all`, `likes:users:<키>`, `likes:anon:<해시>:<키>`. 저장(북마크) 집계는 `api/bookmarks.js`가 새 저장·해제 때 함께 갱신한다.
- "가장 많이 저장된 글"·다이제스트 TOP 10은 기록이 없으면 좋아요/저장 → 원문(X) 좋아요 → 최근 보관순으로 대체하고, 응답의 `basis`로 기준을 알려 준다.
- 화면: 카드마다 ♡ 버튼(숫자), 상단 **주간 베스트** 탭(좋아요 TOP 10 + 트렌드 리포트 주간/월간).

### 다이제스트 발송 설정(나중에)
1. [Resend](https://resend.com)에서 API 키 발급 → Vercel 환경변수 `RESEND_API_KEY`.
2. 보낼 도메인을 Resend에 인증하고 `DIGEST_FROM="리서치 데스크 <digest@내도메인>"`. 설정 전 기본값 `onboarding@resend.dev`는 Resend 계정 본인 주소로만 전달된다.
3. `DIGEST_SECRET`(또는 `CRON_SECRET`) 설정. 선택: `DIGEST_EDITOR_NOTE`(코멘트 기본값), `DIGEST_UNSUBSCRIBE_URL`(수신 거부 링크).
4. 테스트: `curl -X POST -H "Authorization: Bearer $DIGEST_SECRET" -H "Content-Type: application/json" -d '{"to":["me@example.com"],"note":"이번 주 한 줄 평"}' https://<사이트>/api/digest`
5. 구독자는 KV 집합 `digest:subscribers`에 이메일을 `SADD`(구독 폼은 아직 없음). 이번 호 코멘트는 KV `digest:note`에 넣어도 된다.

### Cron(예정)
Vercel Cron은 `CRON_SECRET`을 `Authorization: Bearer`로 붙여 GET을 호출한다. 예(`vercel.json`, 아직 추가 안 함):
```json
{ "crons": [
  { "path": "/api/trends-report?period=week", "schedule": "0 0 * * 1" },
  { "path": "/api/digest?period=week&send=1", "schedule": "0 1 * * 1" }
] }
```
(UTC 기준 — 위 예는 월요일 오전 9시·10시 KST.) `trends-report`는 인증된 호출 때 KV에 `report:<기간>:<기준일>`·`report:<기간>:latest` 스냅숏을 남긴다.

## 링크 추천 · 새 글 알림 · 북마크 내보내기 (Phase 3)

| 경로 | 설명 |
|---|---|
| `POST /api/submit` `{url,title,description,category}` | 링크 추천(로그인 필요, 아니면 401). KV `submissions:<타임스탬프>`에 `pending`으로 저장. 같은 링크·아카이브에 있는 링크는 409, 하루 10건. |
| `GET /api/submit` | 심사 대기 목록(관리자). `?status=approved` 공개 승인 목록, `?mine=1` 내 추천. |
| `POST /api/submit/approve` `{id, action?}` | 승인(기본)·반려(`reject`, 관리자). 승인하면 KV 승인 목록 + `data/pending.json`(쓰기 가능한 환경일 때만, Vercel은 읽기 전용이라 건너뜀) + 알림 발송. 승인된 링크는 아카이브 보기 아래 "독자 추천 링크"에 표시. |
| `GET/POST/DELETE /api/notify` | 알림 상태 조회 / 구독(로그인 본인 주소는 즉시, 그 밖은 확인 메일) / 해지(로그인 본인 또는 메일 토큰). 메일의 수신 거부 링크·원클릭 수신 거부 지원. |
| `POST /api/notify?action=dispatch` | 아직 알리지 않은 아카이브 항목을 관심 분류 구독자에게 발송(Bearer `NOTIFY_SECRET`·`DIGEST_SECRET`·`CRON_SECRET`). 첫 실행은 기존 항목을 "본 것"으로 채우기만 한다. `{dryRun:true}`로 미리 보기. Vercel Cron은 `GET ?dispatch=1`. |
| `GET /api/export?format=md\|csv` | 내 북마크를 파일로 내려받기(로그인 필요). CSV는 엑셀용 BOM 포함, 수식으로 해석될 칸은 앞에 `'`. |

환경변수: `RESEND_API_KEY`(없으면 알림 화면에 "알림 기능 비활성화"), `NOTIFY_FROM`(없으면 `DIGEST_FROM` → Resend 테스트 주소),
`ADMIN_EMAILS`(쉼표 구분, 추천 심사할 로그인 이메일), `SUBMIT_ADMIN_SECRET`(선택, curl 심사용), `NOTIFY_SECRET`(선택).

```bash
# 심사 대기 목록 / 승인
curl -H "Authorization: Bearer $SUBMIT_ADMIN_SECRET" https://<도메인>/api/submit
curl -X POST -H "Authorization: Bearer $SUBMIT_ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"id":"1791234567890"}' https://<도메인>/api/submit/approve
# 새 아카이브 항목 알림(아카이브 갱신 뒤 실행)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<도메인>/api/notify?action=dispatch"
```
