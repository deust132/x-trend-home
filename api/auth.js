/* 로그인 — /api/auth/<route> (Hobby 플랜 함수 12개 제한 때문에 한 함수로 합침)
   GET  /api/auth/login?return=<경로>  Google 로그인 화면으로 보낸다.
        CSRF 방지용 state와 PKCE verifier는 서명된 임시 쿠키에 담아 콜백에서 확인한다.
   GET  /api/auth/callback  Google이 돌려보낸 code를 토큰으로 바꾸고 세션 쿠키를 굽는다.
        id_token은 Google 토큰 엔드포인트에서 TLS로 직접 받은 것이라 서명 검증 대신
        iss·aud·exp·email_verified를 확인한다(OpenID Connect Core 3.1.3.7).
   POST /api/auth/logout  세션 쿠키를 지운다. 다른 사이트가 강제로 로그아웃시키지 못하게 POST + 동일 출처만 받는다.
   GET  /api/auth/me  로그인 상태 확인. 로그인 전이면 { user: null } (200)을 준다.
   옛 주소 /api/auth/<route>는 vercel.json rewrite가 /api/auth?route=<route>로 넘긴다. */

import crypto from "node:crypto";
import {
  SESSION_COOKIE, baseURL, clearCookie, getSession, noStore, pkceChallenge, randomToken,
  safeReturnPath, sameOrigin, setOAuthState, setSession, takeOAuthState
} from "./_lib/session.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/* ───────── login ───────── */
function handleLogin(req, res) {
  noStore(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET 요청만 받습니다." });
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("[auth] GOOGLE_CLIENT_ID/SECRET 미설정");
    return res.status(500).json({ error: "로그인 설정이 아직 끝나지 않았습니다." });
  }

  const state = randomToken();
  const verifier = randomToken(48);
  const ret = safeReturnPath(req.query && req.query.return);
  try {
    setOAuthState(res, { state, verifier, ret });
  } catch (err) {
    console.error("[auth] 세션 설정 오류:", err.message);
    return res.status(500).json({ error: "로그인 설정이 아직 끝나지 않았습니다." });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseURL(req)}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account"
  });
  res.statusCode = 302;
  res.setHeader("Location", `${GOOGLE_AUTH_URL}?${params}`);
  return res.end();
}

/* ───────── callback ───────── */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TOKEN_TIMEOUT_MS = 10000;

function sameString(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// 실패하면 첫 화면으로 돌려보내고 ?login=failed 로 알린다(상세 사유는 서버 로그에만).
function fail(res, reason) {
  console.warn("[auth] 로그인 실패:", reason);
  res.statusCode = 302;
  res.setHeader("Location", "/?login=failed");
  return res.end();
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || "").split(".")[1];
  if (!part) throw new Error("id_token 형식 오류");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function handleCallback(req, res) {
  noStore(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET 요청만 받습니다." });
  }
  const q = req.query || {};
  let saved;
  try {
    saved = takeOAuthState(req, res);
  } catch (err) {
    return fail(res, err.message);
  }
  if (q.error) return fail(res, `Google 응답 오류: ${String(q.error).slice(0, 100)}`);
  if (!saved || !sameString(saved.state, q.state)) return fail(res, "state 불일치 또는 만료");
  if (typeof q.code !== "string" || !q.code) return fail(res, "code 없음");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(res, "GOOGLE_CLIENT_ID/SECRET 미설정");

  let claims;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: q.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseURL(req)}/api/auth/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.verifier
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    });
    if (!tokenRes.ok) throw new Error(`토큰 교환 HTTP ${tokenRes.status}`);
    claims = decodeJwtPayload((await tokenRes.json()).id_token);
  } catch (err) {
    return fail(res, err.message);
  }

  if (!GOOGLE_ISSUERS.includes(claims.iss)) return fail(res, "iss 불일치");
  if (claims.aud !== clientId) return fail(res, "aud 불일치");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return fail(res, "id_token 만료");
  if (!claims.sub) return fail(res, "sub 없음");
  if (claims.email && claims.email_verified === false) return fail(res, "이메일 미인증 계정");

  try {
    setSession(res, {
      sub: String(claims.sub),
      email: String(claims.email || "").slice(0, 200),
      name: String(claims.name || claims.email || "").slice(0, 100),
      picture: /^https:\/\//.test(claims.picture || "") ? String(claims.picture).slice(0, 500) : ""
    });
  } catch (err) {
    return fail(res, err.message);
  }
  res.statusCode = 302;
  res.setHeader("Location", saved.ret || "/");
  return res.end();
}

/* ───────── logout ───────── */
function handleLogout(req, res) {
  noStore(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST 요청만 받습니다." });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  clearCookie(res, SESSION_COOKIE);
  return res.status(200).json({ ok: true });
}

/* ───────── me ───────── */
function handleMe(req, res) {
  noStore(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET 요청만 받습니다." });
  }
  let user = null;
  try {
    user = getSession(req);
  } catch (err) {
    console.error("[auth] 세션 확인 오류:", err.message);
  }
  const loginReady = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET);
  return res.status(200).json({
    user: user && { email: user.email, name: user.name, picture: user.picture },
    loginReady
  });
}

const ROUTES = { login: handleLogin, callback: handleCallback, logout: handleLogout, me: handleMe };

// rewrite가 붙인 ?route= 를 먼저 보고, 없으면 경로 끝(/api/auth/<route>)을 본다.
function routeOf(req) {
  const q = req.query?.route;
  const v = Array.isArray(q) ? q[0] : q;
  if (typeof v === "string" && v) return v;
  return String(req.url || "").split("?")[0].replace(/\/+$/, "").split("/").pop();
}

export default function handler(req, res) {
  const route = routeOf(req);
  if (!Object.hasOwn(ROUTES, route)) {
    noStore(res);
    return res.status(404).json({ error: "없는 주소입니다." });
  }
  return ROUTES[route](req, res);
}
