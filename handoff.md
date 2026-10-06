# handoff — x-trend-b Phase 3: 링크 추천 · 새 글 알림 · 북마크 내보내기 (2026-10-06)

1. **목표**: (1) `api/submit.js` 링크 추천 접수(로그인)·관리자 pending 조회·`/api/submit/approve` 승인 (2) `api/notify.js` 이메일·관심 분류 구독/해지, 새 아카이브 항목 매칭 시 Resend 발송, 키 없으면 비활성 표시 (3) `api/export.js` 북마크 MD/CSV 다운로드 + 화면 버튼. 후원 제외. 기존 기능 유지, 로그인 필요 기능 401, `node --check`.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261006-phase3/`(app.js, styles.css, index.html, README.md, handoff.md, api/bookmarks.js). 배포 안 함.
3. **수행 내용**:
   - 신규 `api/_lib/notify.js`(구독 저장 구조·분류 매칭·알림/확인 메일 HTML·Resend 배치/단건 발송), `api/notify.js`, `api/submit.js`, `api/submit/approve.js`(likes/top.js와 같은 래퍼), `api/export.js`.
   - `api/bookmarks.js`: `keyFor`·`parseAll`에 `export`만 추가(동작 변경 없음, export.js가 재사용).
   - `index.html`: 머리말 아래 "＋ 링크 추천하기"·"✉ 새 글 알림 받기" 버튼, 북마크 보기용 내보내기 막대, 아카이브 보기 "독자 추천 링크" 섹션, `<dialog>` 2개. `app.js`: 독자 참여 블록(`setupParticipation` 등), `selectView`·`refreshBookmarks`·`signedOut`에서 내보내기 막대 갱신. `styles.css`: Phase 3 절. README에 Phase 3 절.
4. **결정**: 추천 = 로그인 필수, 같은 링크 1회(반려 포함)·아카이브 중복 409·하루 10건. 관리자 = `ADMIN_EMAILS` 로그인 또는 Bearer `SUBMIT_ADMIN_SECRET`/`DIGEST_SECRET`. 승인 결과는 KV 승인 목록(공개 `?status=approved`)이 기준이고 `data/pending.json`은 쓰기 가능한 환경에서만(Vercel은 읽기 전용) — archive.json은 직접 고치지 않음(데이터 파이프라인이 외부에서 갱신 중). 알림 구독은 로그인 없이도 가능하되 남의 주소 스팸 방지로 확인 메일(double opt-in), 로그인 본인 주소면 즉시 활성. 분류 미선택 = 전체. "새 항목" 감지는 `notify:seen` 집합 대조(첫 실행은 채우기만), 실패 묶음이 있으면 seen 표시 안 함(재시도, Idempotency-Key로 24시간 중복 방지). 승인된 추천도 즉시 알림. 내보내기 파일명은 ASCII(`bookmarks-날짜.md/csv`) — 한글 이름은 Chromium이 `download`로 바꿔 저장함을 확인.
5. **변경 파일**: 신규 5개(위), 수정 `api/bookmarks.js`, `app.js`, `index.html`, `styles.css`, `README.md`, `handoff.md`.
6. **검증**: 전체 api·app.js `node --check` 통과. 가짜 Upstash+Resend+함수 서버(`/tmp/xtb-phase3/server.mjs`)로 API 63/63(`api-test.mjs`): 추천 401/400/409/403/201·`submissions:{ts}` 저장·관리자 목록 401/403/200·mine·승인/반려/중복 409/404·승인 시 관심 분류 구독자 2명 배치 발송(수신자별 분리, List-Unsubscribe 헤더, 제목 이스케이프)·공개 승인 목록에 추천자 정보 없음, 알림 구독 즉시/확인 메일/확인 링크 1회용/IP 한도 429, dispatch 401·첫 실행 seed·dryRun·발송·재실행 0건, 수신 거부 페이지·폼·토큰 재사용 404·DELETE 401/403/200, 내보내기 401·MD 본문 형식·CSV BOM(바이트 efbbbf)·따옴표/줄바꿈/수식 방지·400/405. Resend 키 없음 2/2(enabled:false, 등록 503). KV 없음: export 401, notify enabled:false. headless Chromium 375px: 로그인 30/30(추천 폼·검증·중복 오류·알림 신청/재열기/해지·승인 후 아카이브 독자 추천·내보내기 0건 비활성→저장 후 MD/CSV 다운로드·검색/좋아요/공유/주간 베스트 유지·가로 스크롤 없음·JS 오류 0), 비로그인 9/9, 키 없음 5/5, 정적 서버 5/5. 스크린샷 `/tmp/xtb-phase3/*.png`. 테스트가 만든 `data/pending.json`은 삭제함.
7. **알려진 한계**: 실제 Upstash·Resend 호출·배포·실폰 확인 안 함. 관리자 승인 화면(UI)은 없음 — curl/API로 심사. Vercel에선 승인 항목이 archive.json에 자동 병합되지 않고 "독자 추천 링크" 섹션에만 보임. 비로그인 구독자는 화면에서 해지 버튼이 안 보이고 메일 링크로 해지.
8. **미해결 질문**: 승인 항목을 archive.json 파이프라인에서 병합할지(`?status=approved` 또는 pending.json 읽기). 관리자 심사 화면이 필요한지. `vercel.json`에 dispatch Cron을 넣을지.
9. **리스크**: 낮음~중간. 확인 메일 발송은 IP당 시간당 5회 제한뿐. `NOTIFY_FROM` 미설정 시 Resend 테스트 주소라 본인 계정 주소로만 전달됨.
10. **다음 액션 + 완료 기준**: Vercel에 `RESEND_API_KEY`·`ADMIN_EMAILS`·(선택)`NOTIFY_FROM` 등록 후 배포 → 폰에서 링크 추천 1건 → curl로 승인 → 아카이브 "독자 추천 링크" 표시 + 알림 메일 1통 수신, 내 북마크에서 MD/CSV 파일이 저장되면 완료.

---
## 이전 단계 기록 (Phase 2: 좋아요 · 트렌드 리포트 · 다이제스트)

1. **목표**: (1) `api/digest.js` 주간 TOP 10 + 에디터 코멘트 자리 + 카테고리별 하이라이트 HTML 이메일(Resend, 발송은 키 생기면 테스트) (2) `api/likes.js` 좋아요 POST/GET/TOP 10 + 카드 ♡ 버튼 + 중복 방지 + "주간 베스트" (3) `api/trends-report.js` 가장 많이 저장된 글 TOP 5·급상승 카테고리·새 태그 JSON + 화면 섹션. 기존 기능 유지, Upstash KV, `node --check` 통과.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261006-phase2/`(app.js, styles.css, index.html, README.md, handoff.md, bookmarks.js, rss.js). 배포 안 함.
3. **수행 내용**:
   - 신규 `api/_lib/catalog.js`(archive+daily 통합 목록, itemKey, KST 날짜), `api/_lib/ranking.js`(KV 키·일별 집합 합산·대체 순위), `api/_lib/report.js`(리포트 집계), `api/_lib/digest.js`(이메일 HTML/텍스트·Resend 배치 발송), `api/likes.js`, `api/likes/top.js`, `api/trends-report.js`, `api/digest.js`.
   - 수정 `api/bookmarks.js`: 새 저장 시 `saves:day:<날짜>`·`saves:all` +1, 해제 시 `saves:all` −1(실패해도 북마크는 성공). `api/_lib/session.js`: `bearerMatches` 추가.
   - itemKey 확장(app.js·rss.js·catalog.js 동일): `th:…`/`gh:owner/repo`/`hn:`/`hf:` id의 기호를 `-`로 → 그 카드들도 좋아요·공유·댓글 가능(기존 `x-<번호>` 키는 그대로).
   - `app.js`: 카드·최대 화제에 ♡ 버튼(숫자 일괄 조회 `?ids=`, 낙관적 갱신, localStorage `rd_liked_v1`, 실패 시 원복+토스트, API 없으면 `body.likes-off`로 숨김). 보기 탭 "주간 베스트"(`#view=best`, 순위 배지·이번 주 ♥). 트렌드 리포트(주간/월간 탭, 항목 클릭 → 카드 이동, 새 태그 클릭 → 아카이브 태그 필터).
   - `index.html`: 4번째 탭, `#trend-report` 섹션. `styles.css`: 탭 4열(480px 미만 축소), `.like-toggle`, `.rank-badge`, `.tr-*`. README에 Phase 2 절.
4. **결정**: 주간 = 최근 7일(월간 30일) 롤링, 일별 정렬 집합 합산. "저장" = 북마크(새로 저장된 횟수). 저장 기록이 없으면 좋아요 → 원문 좋아요 → 최근 보관순으로 대체하고 `basis`로 표시. 비로그인 중복 방지는 IP+UA HMAC 해시 30일 + localStorage, 로그인은 계정당 영구 1회. 좋아요 취소 기능은 없음. 목록에 없는 키는 404(순위 오염 방지). 다이제스트 미리보기 GET은 공개, 발송은 `DIGEST_SECRET`/`CRON_SECRET` 필요. 테스트 발송은 매번 새 Idempotency-Key, 구독자 발송은 같은 날 같은 호 1회.
5. **변경 파일**: 신규 8개(위), 수정 `api/bookmarks.js`, `api/rss.js`(itemKey), `api/_lib/session.js`, `app.js`, `index.html`, `styles.css`, `README.md`, `handoff.md`.
6. **검증**: 모든 api·app.js `node --check` 통과. 가짜 Upstash REST + Vercel 함수 흉내 서버 + 가짜 Resend(`/tmp/xtb-phase2/server.mjs`)로 API 45/45(`api-test.mjs`): 좋아요 +1·비로그인/로그인 중복 차단·일괄 조회·TOP 순위·month·404/400/403/405, 리포트 대체(likes)→북마크 후 saves 기준·스냅숏 저장·인증 401, 다이제스트 HTML/텍스트/JSON·코멘트 이스케이프·발송 401·dryRun·테스트 발송 요청 형식(배치 URL·수신자별 분리·Idempotency-Key). 기간 기준일 이동 단위 확인(`unit.mjs`). headless Chromium 375px 35/35(`e2e.cjs`): 버튼 수=카드 수, 좋아요 0→1·localStorage·재클릭 토스트·저장소 지운 뒤 서버 차단, 비-X 출처 카드 좋아요, 주간 베스트 순위·해시 진입·탭 숫자, 리포트 3구역·월간 탭·태그/항목 클릭, 공유·댓글·검색·챗봇 유지, 가로 스크롤 없음, JS 오류 0. API 없는 정적 서버 7/7(버튼 숨김·안내 문구). RSS 30건 well-formed. 스크린샷 `/tmp/xtb-phase2/*.png`, 이메일 `digest.html`/`digest.png`.
7. **알려진 한계**: 실제 Upstash·Resend 호출은 안 함(키 없음·외부 발송 승인 필요). 실제 배포·실폰 확인 안 함. 작업 중 09:15에 `data/*.json`이 외부에서 갱신됨(아카이브 172→215건, 중복 id 제외 화면 195건 — 이 작업과 무관). 현재 데이터가 모두 10/5~10/6이라 급상승 카테고리는 전부 "신규", 새 태그도 사실상 상위 태그와 같음(데이터가 쌓이면 의미가 생김).
8. **미해결 질문**: 다이제스트 보낼 도메인(`DIGEST_FROM`)과 구독 폼·수신 거부 페이지를 만들지. 좋아요 취소를 허용할지. Cron을 `vercel.json`에 실제로 넣을지(README에 예시만).
9. **리스크**: 낮음~중간. 비로그인 중복 방지는 IP+UA 기준이라 같은 회사망·같은 기기 다른 사람이 막히거나, UA 바꾸면 다시 누를 수 있음. CDN 캐시로 주간 베스트가 최대 1분 늦을 수 있음. Resend 배치 API의 `headers` 필드·응답 형식은 문서 기준이며 실호출 미확인.
10. **다음 액션 + 완료 기준**: Vercel에 KV 연결 상태로 배포 → 폰에서 ♡ 눌러 숫자 증가·새로고침 유지·"주간 베스트"에 표시 확인. `/api/trends-report` 200 JSON 확인. `RESEND_API_KEY`·`DIGEST_SECRET` 등록 후 README의 curl로 본인 주소 테스트 발송 1건 수신되면 완료.

---
## 이전 단계 기록 (Phase 1: 댓글 · RSS · 공유)

1. **목표**: (1) 카드별 giscus 댓글(repo `deust132/x-trend-home`, 다크/라이트 대응) (2) `api/rss.js` 아카이브 최신 30건 RSS 2.0 + `<link rel="alternate">` (3) 카드별 공유(X·카카오톡·텔레그램·링크 복사, Web Share 우선). 기존 기능 유지, 375px 가로 스크롤 없음.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261005-phase1/`(app.js, styles.css, index.html, README.md, handoff.md). 배포 안 함.
3. **수행 내용**:
   - `app.js`: 카드 고정 키 `itemKey`(X status 번호 → `x-<번호>`, 없으면 id) + `#item=` 해시(읽기·쓰기·hashchange). `focusItem`이 해당 보기로 이동, 가려지면 분류·태그·검색 해제, 카드 펼침·강조·즉시 스크롤. `?giscus=`(GitHub 로그인 복귀)면 댓글 창 재오픈. 공유: `shareHTML`(카드·최대 화제), `navigator.share` 우선(AbortError는 무시, 그 외 실패 시 버튼 목록), X intent / t.me share URL, 링크 복사(clipboard → execCommand → prompt 폴백), 카카오(`KAKAO_JS_KEY` 있으면 SDK `sendScrap`, 없으면 복사+안내 토스트). 댓글: `GISCUS` 설정(설치 방법 주석), 버튼 클릭 시 client.js 스크립트 태그 삽입(mapping=specific, term=itemKey, strict, lang=ko, lazy), 한 번에 하나만 열림, 테마는 `<html data-theme>` 또는 body 배경 밝기, 변경 시 iframe에 `setConfig` postMessage.
   - `api/rss.js` 신규: 파일 읽기 → 실패 시 `${baseURL}/data/archive.json` fetch. 보관일 내림차순 30건, 링크 `/#item=키`, guid=키, 설명=요약+인사이트+원문 URL, 분류·태그 `<category>`, atom:link self, 캐시 10분.
   - `index.html`: RSS alternate link, og/twitter 메타, 꼬리말 "RSS 구독", `#toast`.
   - `styles.css`: `.share-toggle/.comment-toggle`, `.share`(375px 2×2, 480px↑ 4열, 버튼 44px), `.comments`, `.report--target`, `.toast`.
4. **결정**: 댓글은 카드마다 버튼(오늘의 리포트·아카이브·북마크 공통, 같은 원문 = 같은 스레드). giscus 카테고리는 Announcements 권장. 공유 URL은 원문 X 주소가 아니라 사이트 카드 주소. 카카오 키가 없으므로 복사 폴백.
5. **변경 파일**: 수정 `app.js`, `styles.css`, `index.html`, `README.md`, `handoff.md`. 신규 `api/rss.js`.
6. **검증**: `node --check` app.js·api 전체 통과. RSS 핸들러 직접 호출: 200, `application/rss+xml`, item 30개, XML well-formed(minidom), 특수문자·제어문자 이스케이프, POST 405. headless Chromium 375px(`/tmp/xtb-phase1/e2e.cjs`) 46/46: 172+30 카드·최대 화제 공유 버튼, 공유 목록 4버튼 44px·넘침 없음, X/텔레그램 URL, 클립보드 복사·토스트, 카카오 폴백, navigator.share 호출/취소/오류 폴백, 댓글 미설정 안내, (가짜 client.js로) giscus 속성·카드 내 iframe·하나만 열림·dark 전환 postMessage, `#item=` 진입(필터 해제·펼침·화면 내), `?giscus=` 재오픈, 없는 키 해시 정리, 상세 분석·태그·검색·챗봇·미디어 유지, 가로 스크롤 없음, JS 오류 0. 스크린샷 `/tmp/xtb-phase1/*.png`.
7. **알려진 한계**: giscus 실제 동작은 미검증 — 저장소에 Discussions 꺼져 있고 giscus 앱 미설치(giscus API: "not installed") → `categoryId` 비어 있어 현재 "준비 중" 안내만 뜸. 카카오톡 직접 전송은 JS 키 없음. 실제 배포·실폰·Vercel에서 `/api/rss` 실행은 안 함. 로그인·북마크는 API 404 상태로만 확인(코드 경로 미변경).
8. **미해결 질문**: 카카오 JavaScript 키를 발급해 넣을지. giscus 카테고리를 Announcements로 할지.
9. **리스크**: 낮음. 사이트는 아직 밝은 테마뿐이라 giscus도 light로 뜸(다크 모드 추가 시 자동 추종). 미리보기 배포에 Deployment Protection이 켜져 있으면 RSS의 fetch 폴백이 401일 수 있음(파일 읽기가 먼저라 보통 무관).
10. **다음 액션 + 완료 기준**: Discussions 활성화 + giscus 앱 설치 + `GISCUS.categoryId` 입력 → 배포 → 폰에서 댓글 작성 1건, 공유 시트, `/api/rss`를 RSS 리더에 등록해 30건 보이면 완료.

---
## 이전 단계 기록 (태그 뱃지 + 태그 필터)

1. **목표**: archive.json `tags`를 카드에 뱃지로 표시, 태그 클릭 시 필터(분류·검색과 AND), 적용 중 태그 표시 + ✕ 해제. 기존 기능 유지.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261005-tags/`(app.js, styles.css, index.html). 배포 안 함.
3. **수행 내용**:
   - `app.js`: `tagsOf`(아카이브 URL 색인 `tagsByURL` — 오늘의 리포트·북마크도 같은 URL이면 태그 표시), 제목 아래 `tagsHTML`(버튼, `aria-pressed`), `reportView.tag` 상태, `inTag`를 `applyReportView`에서 분류 뒤에 적용(→ 검색은 그 결과 안에서). 같은 태그 재클릭 시 해제. 상태 문구 "#태그 태그 N건" / "‘분류’ · #태그에서 검색 결과 N건". 해시 `tag=` 읽기·쓰기·hashchange. 빈 결과 문구에 "태그 필터를 해제해 보세요".
   - `index.html`: 분류 아래 `#tag-filter`(태그 이름 + ✕ 버튼 32px).
   - `styles.css`: `.tags`, `.tag`(중립 회색 테두리·옅은 배경, 높이 24px, 선택 시 먹색 반전), `.tag-filter*`.
4. **결정**: 태그 필터는 한 번에 1개. 분류 버튼 숫자는 태그와 무관한 전체 개수 유지. 보기(탭)를 바꿔도 태그 필터 유지.
5. **변경 파일**: `app.js`, `styles.css`, `index.html`, `handoff.md`.
6. **검증**: `node --check app.js` 통과. headless Chromium 375px(`/tmp/xtb-tags/e2e.cjs`): 172장 모두 태그, 프롬프트 클릭→36건(전부 해당 태그), 분류 AND(AI 미디어 생성 13/13), 검색 AND(9건), 태그 전환, ✕ 해제→172건·해시 제거, 재클릭 해제, `#tag=` 해시 진입(오픈소스 24건), 오늘의 리포트 빈 결과 문구, 상세 분석·미디어·챗봇 버튼 유지, 가로 스크롤 없음, JS 오류 0. 로그인/북마크 API 가짜 응답(`bm.cjs`)으로 북마크 카드 태그 표시·필터 확인. 스크린샷 `/tmp/xtb-tags/*.png`.
7. **알려진 한계**: 오늘의 리포트 30건은 아카이브와 URL이 안 겹쳐 태그 없음. 실제 배포·실폰 확인 안 함.
8. **미해결 질문**: 태그 211종 중 다수가 1~2건 — 태그 목록(상위 N개) 패널이 필요한지.
9. **리스크**: 낮음(데이터·API 미변경).
10. **다음 액션 + 완료 기준**: 배포 후 폰에서 태그 탭·✕ 해제 확인되면 완료.

---
## 이전 단계 기록 (챗봇 환각 방지 + Jev)

1. **목표**: (1) 챗봇이 없는 분류·제목·작성자·좋아요를 지어내는 문제 완화. (2) Jev로 분류·관련도·중복 탐지 API 3개 추가. 기존 기능 유지.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261005-jev/`(chat.js, README.md, handoff.md). 배포 안 함.
3. **수행 내용**:
   - `api/chat.js`: temperature 0.6→0.2. SYSTEM_PROMPT를 요청 문구 [절대 규칙] 5개 + 기존 보충 규칙으로 교체(분류 목록은 `_lib/jev.js`의 `CATEGORIES` 공유). 응답 후 `verifyReply()`: 따옴표·굵게 인용 제목(8자 이상), `[분류]`·`X·Y 카테고리/분류` 표현, `좋아요 N`, `@작성자`를 컨텍스트(+검색 결과 제목)와 대조 → 없으면 답변 끝에 "⚠️ 확인 필요 — …" 목록 추가.
   - `api/_lib/jev.js`: OpenRouter 호출(`typesafe/jev-router`, `JEV_MODEL`로 변경 가능), temperature 0.1, `response_format: json_object`, 45초 제한, 키 없으면 500 "Jev 설정이 필요합니다", JSON 추출(코드블록·앞뒤 설명 허용), 공통 오류 처리.
   - `api/jev/{categorize,score,duplicates}.js` 신규. README에 Jev 절 추가.
4. **결정**: 모델 ID는 지정 문서(`skills/x-access/SKILL.md`)에 Jev 언급이 없어 OpenRouter 공개 모델 목록에서 "jev" 검색 → 유일 결과 `typesafe/jev-router`. 경고는 별도 필드가 아니라 reply 끝에 붙임(app.js 수정 없이 화면에 표시되도록).
5. **변경 파일**: 수정 `api/chat.js`, `README.md`, `handoff.md`. 신규 `api/_lib/jev.js`, `api/jev/*.js`(3). app.js·data·기타 api 미변경.
6. **검증**: 5개 파일 `node --check` 통과. 가짜 fetch 테스트(`/tmp/xtb-jev/test.mjs`) 19/19: 키 없음 500 문구, 405/400, 요청 URL·모델·temperature·인증 헤더, 분류 정상·목록 밖→기타, 점수 0~1 제한, 중복 쌍 필터, 상위 오류 502, 챗봇 temperature·프롬프트, 가짜 분류·제목·작성자·좋아요 4건 경고, 정상 인용 무경고.
7. **알려진 한계**: 실제 OpenRouter·DeepSeek 호출은 안 함(유료 실행 — 승인 필요). 검증은 따옴표/굵게로 인용한 제목만 잡음(평문 언급은 못 잡음). app.js에서 Jev API를 아직 쓰지 않음.
8. **미해결 질문**: `data/daily.json`(오늘의 리포트)이 8개 밖 분류(`커리어·비즈니스` 6건, `AI 코딩·에이전트` 6건, `개발·기술 일반` 4건)를 실제로 씀 → 프롬프트 규칙 2와 충돌. 검증 코드는 컨텍스트에 있는 분류는 경고하지 않음. daily 분류를 8개로 재분류할지(예: Jev categorize로) 결정 필요. 아카이브 172건은 작성자 `@?`·좋아요 0뿐이라 작성자·좋아요 질문엔 답할 데이터가 없음.
9. **리스크**: `typesafe/jev-router` 가격이 OpenRouter 목록에서 -1(변동/라우터)로 표시 → 호출 비용 예측 불가. duplicates는 최대 100개를 한 번에 보내 토큰이 클 수 있음.
10. **다음 액션 + 완료 기준**: Vercel에 `OPENROUTER_API_KEY` 등록·배포 후 categorize 1회 실호출로 200 + 8개 중 하나 반환 확인, 챗봇에 "커리어 관련 알려줘" 질문 시 없는 분류를 만들지 않으면 완료.

---
## 이전 단계 기록 (미디어 표시)

1. **목표**: archive.json `media`(139건)를 카드에 썸네일로 표시(사진 라이트박스, 영상 인라인 재생, 여러 장 갤러리), 분류별 색상으로 카드를 더 시각적으로. 기존 기능 유지.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261005-media/`(app.js, styles.css, index.html). 배포 안 함.
3. **수행 내용**:
   - `app.js`: `mediaHTML`/`mediaOf`(아카이브 URL 색인으로 오늘의 리포트·북마크도 조회), pbs 사진은 `name=small|medium` srcset + `loading="lazy"`, 크게 보기는 `name=large`. 영상은 썸네일 URL이 데이터에 없어 `<video preload=none>`를 IntersectionObserver로 화면 300px 전에 `#t=0.1` 첫 프레임 로드. 클릭 시 그 자리에서 `controls` 재생(GIF는 음소거 반복). 사진 클릭은 `<dialog>` 라이트박스(미지원 브라우저는 새 탭 링크). 로드 실패는 document 캡처 error 리스너로 해당 칸 숨김, 전부 실패하면 미디어 영역 숨김. 여러 장은 scroll-snap 가로 갤러리 + "1 / N" 카운터.
   - 분류 색상: `CATEGORY_COLORS`(코드 목록 + 실제 아카이브 분류 Jev·Grok Bot·AI 코딩·AI 에이전트·자동화) + 해시 폴백. 카드 `--cat` 인라인 변수 → 상단 5px 테두리, 옅은 색 머리띠, 칩 배경, 분류 버튼 왼쪽 띠/선택 시 배경, 최대 화제 kicker.
   - `styles.css`: `.media*`, `.lightbox*`, 카드·칩·분류 버튼 색, 600px 이상 여백 보정.
4. **결정**: 썸네일은 카드 맨 위 꽉 찬 폭(한 장은 원래 비율 0.8~1.91로 제한, 여러 장은 4:3). 영상 재생은 인라인(새 탭보다 흐름 유지).
5. **변경 파일**: `app.js`, `styles.css`, `handoff.md`. index.html·api·data 미변경.
6. **검증**: `node --check app.js` 통과. headless Chromium 375px(`/tmp/xtb-media/e2e.cjs`) 28/28 통과: 미디어 139·갤러리 25, 전부 lazy, 화면 밖 영상 미로드, 사진 실제 로드, 라이트박스 열기/Esc 닫기, 404 사진 조용히 숨김, 영상 첫 프레임 로드·재생 버튼·인라인 재생, 갤러리 내부만 스크롤·카운터, 가로 스크롤 없음, 상세 분석·검색·분류·챗봇 열기·오늘의 리포트 정상, JS 오류 0. 스크린샷 `/tmp/xtb-media/*.png`.
7. **알려진 한계**: 테스트 Chromium은 VM 프록시 인증이 안 돼 twimg 요청을 Node가 대신 받아 넘김(실제 트위터 응답이지만 브라우저 직결은 아님). 영상 썸네일은 첫 프레임을 받아야 보여서 4K 영상은 늦게 뜰 수 있음(그동안 어두운 판+재생 버튼). 로그인·북마크는 정적 서버라 이번에 실서버 확인 안 함(코드 경로 미변경). 오늘의 리포트 30건은 미디어 없음(아카이브와 URL 겹침 없음).
8. **미해결 질문**: video.twimg.com 영상이 실제 배포 도메인에서 핫링크 차단되는지 확인 필요(차단 시 자동으로 숨김 처리됨).
9. **리스크**: 아카이브 화면에서 영상 다수를 지나갈 때 메타데이터 요청이 여러 번 발생(모바일 데이터 사용량).
10. **다음 액션 + 완료 기준**: 배포 후 실제 폰에서 사진 라이트박스·영상 재생 확인되면 완료.

---
## 이전 단계 기록 (챗봇 환각 방지 + 상세 분석 UI)


1. **목표**: (1) 챗봇이 제목만 보고 내용을 추측하는 문제("크몽"→"크롬") 완화. (2) 카드마다 "📖 상세 분석 보기"로 archive.json의 `detail`을 펼쳐 보기.
2. **저장소 상태**: git 저장소 아님. 수정 전 파일은 `~/workspace/backups/x-trend-b-20261005-detail/`(app.js, styles.css, api/chat.js). 배포 안 함.
3. **수행 내용**:
   - `app.js` `buildChatContext(question)`: 질문 단어(조사·요청어 제거, 2글자 이상)를 제목·요약·인사이트·분류와 대조 → 관련 항목을 맨 앞에 요약+인사이트 전체로. 다음 지금 보이는 항목을 전체로(나머지 제목 목록 자리는 미리 남겨 둠), 마지막에 나머지 제목. 한도 12,000자. 넣지 못한 건수는 표시.
   - `api/chat.js` SYSTEM_PROMPT에 정확성 규칙(제목만으로 추측 금지, 불확실하면 "원문 확인이 필요합니다", 이름 정확 인용) 추가.
   - 상세 분석: 카드 안에서 펼치는 방식(모바일 우선, 모달 안 씀). 처음 열 때 마크다운을 HTML로 변환(`##`→h4, `###`→h5, 문단, `- ` 목록, `**굵게**`). 모든 텍스트는 이스케이프. `detail`이 없는 항목은 버튼을 숨김. 오늘의 리포트·북마크 항목은 URL이 같은 아카이브 항목의 detail을 찾아 씀.
   - `styles.css`: `.detail-toggle`, `.detail`, `.detail__heading` (16px, 줄 간격 1.8), `.report__actions`에 flex-wrap.
4. **결정**: 카드 안 펼침 방식 선택(모바일에서 스크롤 흐름 유지, 포커스 가두기 불필요). 관련도는 단순 포함 검사(Fuse 미사용) — 고유명사 질문에 정확.
5. **변경 파일**: `app.js`, `api/chat.js`, `styles.css`, `handoff.md`.
6. **검증**: `node --check app.js`, `node --check api/chat.js` 통과. headless Chromium 375px(`/tmp/xtb-detail/e2e.cjs`): 아카이브 172장 모두 버튼 표시, 펼침/접힘, 소제목 3개 변환, `##` 미노출, 가로 스크롤 없음, 검색·분류 정상, 다른 분류를 보면서 "크몽" 질문 시 크몽 항목이 요약과 함께 맨 앞에 들어감, 컨텍스트 11,879자에 172건 모두 포함. 콘솔 오류는 테스트가 일부러 404로 막은 로그인 API뿐.
7. **알려진 한계**: daily.json 30건은 `detail`이 없고 아카이브와 URL도 겹치지 않아 오늘의 리포트에는 버튼이 안 보임. 실제 DeepSeek 응답으로는 시험 안 함(챗 API는 가짜 응답으로 대체).
8. **미해결 질문**: 오늘의 리포트에도 상세 분석을 넣을지(데이터 생성 쪽 작업 필요). 챗봇 temperature 0.6을 낮출지.
9. **리스크**: 질문에 흔한 단어(예: "AI")가 있으면 관련 항목이 많아져 지금 보이는 항목의 요약이 덜 들어갈 수 있음.
10. **다음 액션 + 완료 기준**: 배포 후 실제 챗봇에 "크몽 관련 알려줘"라고 질문 → 이름을 정확히 인용하면 완료.

---
## 이전 단계 기록 (로그인 + 북마크)

1. **목표**: Google OAuth 로그인(헤더 버튼, 쿠키 세션) + 리포트/아카이브 항목 북마크(저장·해제 토글, "내 북마크" 보기). 저장소는 Vercel KV. 기존 기능 유지.
2. **저장소 상태**: git 저장소 아님. 이번 작업 전 파일(index.html, app.js, styles.css, api/)은 `~/workspace/backups/x-trend-b-20261005-auth/`에 백업. 배포는 하지 않음.
3. **수행 내용**:
   - 서버: `api/auth/{login,callback,logout,me}.js`, `api/bookmarks.js`, 공용 `api/_lib/{session,kv}.js`. npm 패키지 없음.
   - 로그인: Authorization Code + PKCE, state·verifier는 서명된 10분 쿠키. 세션은 HMAC 서명 쿠키 `rd_session`(HttpOnly·Secure·SameSite=Lax, 30일).
   - 북마크: Upstash Redis REST(`KV_REST_API_*` 또는 `UPSTASH_REDIS_REST_*`). 해시 `bm:v1:<sub>`, 필드 = URL SHA-256 앞 32자, 값 = 항목 스냅숏. 최대 500건.
   - 화면: 헤더 오른쪽 로그인/이름·로그아웃, 상단 탭에 "내 북마크"(`#view=bookmarks`), 카드·오늘의 최대 화제에 ☆ 저장 버튼. 북마크 보기에서도 분류·검색·챗봇 컨텍스트 동작.
   - README.md 신규(환경변수·Google Console·KV 설정·보안 설명). `.gitignore`에 `.env*` 추가.
4. **결정**: Vercel Postgres·KV가 Marketplace(Neon·Upstash)로 이전된 상태라 의존성 없는 Upstash REST 선택. 콜백 주소는 쿼리 없는 고정 경로가 되도록 `api/auth/*` 파일 분리. 로그아웃은 POST+동일 출처만. API가 없는 정적 서버에선 로그인 UI·저장 버튼 자동 숨김.
5. **변경 파일**: 신규 `api/auth/*.js`(4), `api/bookmarks.js`, `api/_lib/*.js`(2), `README.md`. 수정 `index.html`, `app.js`, `styles.css`, `.gitignore`, `handoff.md`. `api/chat.js`·`data/` 미변경.
6. **검증**:
   - 모든 api 파일과 app.js `node --check` 통과.
   - 로컬 모의 서버(Google 토큰·KV를 가짜로 대체, `/tmp/xtb-auth/`) API 시험 28/28 통과: 로그인 리다이렉트·PKCE·콜백·쿠키 속성, 변조 쿠키·state 불일치·aud 불일치 거부, 오픈 리다이렉트 차단, 저장/조회/삭제, 다른 출처 403, 사용자 분리, 로그아웃.
   - headless Chromium 21/21 통과: 로그아웃 상태 저장 클릭→로그인→같은 보기 복귀, 저장·새로고침 유지, 북마크 보기·검색·해제, 로그아웃, `?login=failed` 안내, 375px 가로 스크롤 없음, 콘솔 오류 0.
   - 정적 서버 모드: 로그인 영역·저장 버튼 숨김, 아카이브 172건 정상.
7. **알려진 실패**: 없음. 단 실제 Google·실제 Upstash와는 아직 연결해 보지 않음(키 없음).
8. **미해결 질문**: 로그인 허용 계정을 제한할지(현재 모든 Google 계정 허용). Google 동의 화면을 "테스트" 상태로 둘지 게시할지.
9. **리스크**: Preview 배포는 콜백 주소가 달라 로그인 불가(README에 명시). id_token은 서명 대신 클레임만 검증(토큰 엔드포인트 직접 수신이라 OIDC 규격상 허용).
10. **다음 액션 + 완료 기준**: Google OAuth 클라이언트 생성 → Vercel에 `GOOGLE_CLIENT_ID/SECRET`, `SESSION_SECRET` 등록 → Upstash Redis 연결 → 배포 후 실제 계정으로 로그인·저장·새로고침·로그아웃 확인되면 완료.
