/* 로그인 세션 — 서명된 쿠키(HMAC-SHA256). 서버에 세션 저장소를 두지 않는다.
   api/_lib/ 아래 파일은 밑줄로 시작해 Vercel이 함수로 배포하지 않는다(공용 모듈 전용).
   비밀값은 SESSION_SECRET 환경변수에서만 읽는다. */

import crypto from "node:crypto";

export const SESSION_COOKIE = "rd_session";
export const OAUTH_COOKIE = "rd_oauth";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30일
export const OAUTH_MAX_AGE = 60 * 10; // 로그인 진행 중 state·PKCE 보관 10분
const MIN_SECRET_CHARS = 32;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < MIN_SECRET_CHARS) throw new Error("SESSION_SECRET 미설정 또는 32자 미만");
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function randomToken(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

export function pkceChallenge(verifier) {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}

// 서명이 틀리거나 만료됐으면 null
function verify(token) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(b64url(crypto.createHmac("sha256", secret()).update(body).digest()));
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/* ───────── 쿠키 ───────── */
export function readCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const name = part.slice(0, i).trim();
    if (!name || name in out) return;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* 잘못된 인코딩은 무시 */
    }
  });
  return out;
}

// 로컬(http://localhost)에서도 브라우저는 Secure 쿠키를 받아 준다.
function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function appendCookie(res, value) {
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader("Set-Cookie", list.concat(value));
}

export function clearCookie(res, name) {
  appendCookie(res, cookie(name, "", 0));
}

/* ───────── 세션 ───────── */
export function setSession(res, user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.sub, email: user.email, name: user.name, picture: user.picture, iat: now, exp: now + SESSION_MAX_AGE };
  appendCookie(res, cookie(SESSION_COOKIE, sign(payload), SESSION_MAX_AGE));
}

// { sub, email, name, picture } 또는 null
export function getSession(req) {
  const token = readCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const p = verify(token);
  if (!p || typeof p.sub !== "string" || !p.sub) return null;
  return { sub: p.sub, email: p.email || "", name: p.name || "", picture: p.picture || "" };
}

// 로그인 시작~콜백 사이에 state·PKCE verifier·돌아갈 주소를 서명해 보관
export function setOAuthState(res, data) {
  const exp = Math.floor(Date.now() / 1000) + OAUTH_MAX_AGE;
  appendCookie(res, cookie(OAUTH_COOKIE, sign({ ...data, exp }), OAUTH_MAX_AGE));
}

export function takeOAuthState(req, res) {
  const token = readCookies(req)[OAUTH_COOKIE];
  clearCookie(res, OAUTH_COOKIE);
  return token ? verify(token) : null;
}

/* ───────── 요청 도우미 ───────── */
// 배포 주소. PUBLIC_BASE_URL이 있으면 그것을, 없으면 요청 호스트를 쓴다.
export function baseURL(req) {
  const fixed = process.env.PUBLIC_BASE_URL;
  if (fixed) return fixed.replace(/\/+$/, "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = String(req.headers["x-forwarded-proto"] || (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

// 다른 사이트에서 보낸 쓰기 요청 차단(SameSite=Lax 쿠키에 더한 2중 방어).
// Origin이 없으면(일부 동일 출처 요청) Sec-Fetch-Site로 판단한다.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin === baseURL(req);
  const site = req.headers["sec-fetch-site"];
  return !site || site === "same-origin";
}

// 로그인 후 돌아갈 경로: 같은 사이트 안의 상대 경로만 허용(오픈 리다이렉트 방지)
export function safeReturnPath(value) {
  const v = typeof value === "string" ? value : "";
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.length > 512) return "/";
  return v;
}

export function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

// "Authorization: Bearer <비밀값>"이 secret과 같은지(해시 후 비교해 길이·내용 시간 차를 숨긴다). secret이 비면 false.
export function bearerMatches(req, secret) {
  if (!secret) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1].trim()).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}
