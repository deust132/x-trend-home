/* 새 글 알림 — /api/notify
   GET                              → { enabled, categories, user, subscription }  설정 화면용 상태
   GET  ?confirm=<토큰>             → (확인 메일 링크) 구독 확정 HTML 페이지
   GET  ?unsubscribe=<토큰>         → (알림 메일 링크) 수신 거부 확인 HTML 페이지(버튼 → POST ?unsubscribe=)
   POST { email, categories[] }     → 구독 등록. 로그인한 본인 주소면 바로 활성, 아니면 확인 메일을 보내고 확인 후 활성.
   DELETE { token } | { email }     → 구독 해지. token(메일 링크)이 있거나, 로그인한 본인 주소일 때만.
   POST ?unsubscribe=<토큰>         → 수신 거부 페이지의 버튼·메일 앱의 원클릭 수신 거부(RFC 8058)
   POST ?action=dispatch  또는  GET ?dispatch=1   + "Authorization: Bearer <NOTIFY_SECRET·DIGEST_SECRET·CRON_SECRET>"
        → 사이트 목록(archive.json·daily.json)에서 아직 알리지 않은 항목을 찾아 관심 분류가 맞는 구독자에게 발송.
          처음 실행할 때는 현재 목록을 "이미 본 것"으로 채우기만 한다(구독자에게 과거 글 수백 건이 가지 않게).
          body/query dryRun이면 보내지 않고 새 항목·받을 사람 수만 돌려준다.
   RESEND_API_KEY가 없으면 enabled:false — 화면은 "알림 기능 비활성화"를 표시하고, 등록·발송은 503.
   저장 구조는 api/_lib/notify.js 참고. */

import crypto from "node:crypto";
import { command, kvConfigured, pipeline } from "./_lib/kv.js";
import { baseURL, bearerMatches, getSession, noStore, sameOrigin } from "./_lib/session.js";
import { kstDate, loadCatalog } from "./_lib/catalog.js";
import { esc } from "./_lib/digest.js";
import {
  SEEN_KEY, SUBS_KEY, TOKENS_KEY, activeSubs, cleanCategories, cleanEmail, idempotencyFor, matches,
  newToken, notifyEnabled, notifySubscribers, parseSub, renderConfirmMail, sendOne
} from "./_lib/notify.js";

const CONFIRM_KEY = "notify:confirm"; // 해시 확인 토큰 → 이메일
const CONFIRM_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const RATE_LIMIT = 5; // IP당 시간당 등록 요청
const MAX_BODY_CHARS = 4000;
const MAX_NEW_PER_DISPATCH = 50;

function pick(v) {
  return String((Array.isArray(v) ? v[0] : v) ?? "").trim();
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const text = typeof req.body === "string" ? req.body : "";
  if (text.length > MAX_BODY_CHARS) throw new Error("too large");
  const body = JSON.parse(text || "{}");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not object");
  return body;
}

function session(req) {
  try {
    return getSession(req);
  } catch (err) {
    console.error("[notify] 세션 확인 오류:", err.message);
    return null;
  }
}

const authorized = (req) =>
  bearerMatches(req, process.env.NOTIFY_SECRET) || bearerMatches(req, process.env.DIGEST_SECRET) || bearerMatches(req, process.env.CRON_SECRET);

function ipHash(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const salt = process.env.SESSION_SECRET || "research-desk-notify";
  return crypto.createHmac("sha256", salt).update(ip).digest("hex").slice(0, 24);
}

function page(res, status, title, body) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(status).send(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)} — 리서치 데스크</title></head>` +
    `<body style="margin:0;padding:32px 16px;background:#F6F1E7;color:#1B1813;font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif">` +
    `<main style="max-width:480px;margin:0 auto;background:#FFFDF8;border:1px solid #E2DCCF;border-radius:8px;padding:20px">` +
    `<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${body}` +
    `<p style="margin-top:20px"><a href="/" style="color:#2E4A7A">리서치 데스크로 돌아가기</a></p></main></body></html>`
  );
}

// 사이트 목록의 분류(많은 순) — 설정 화면의 선택지
async function categoryList(req) {
  try {
    const counts = new Map();
    (await loadCatalog(req)).items.forEach((it) => { if (it.category) counts.set(it.category, (counts.get(it.category) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
  } catch (err) {
    console.error("[notify] 분류 목록 읽기 실패:", err.message);
    return [];
  }
}

const publicSub = (s) => s && { email: s.email, categories: s.categories || [], status: s.status };

/* ───────── 상태 ───────── */
async function handleStatus(req, res) {
  const user = session(req);
  let subscription = null;
  if (user?.email && kvConfigured()) {
    subscription = publicSub(parseSub(await command("HGET", SUBS_KEY, cleanEmail(user.email))));
  }
  return res.status(200).json({
    enabled: notifyEnabled() && kvConfigured(),
    reason: !notifyEnabled() ? "메일 발송 설정(RESEND_API_KEY)이 아직 없습니다." : !kvConfigured() ? "알림 저장소 설정이 아직 끝나지 않았습니다." : "",
    categories: await categoryList(req),
    user: user ? { email: user.email } : null,
    subscription
  });
}

/* ───────── 확인 링크 ───────── */
async function handleConfirm(req, res, token) {
  const email = await command("HGET", CONFIRM_KEY, token);
  const sub = email ? parseSub(await command("HGET", SUBS_KEY, email)) : null;
  if (!sub || sub.confirmToken !== token || Date.now() - (Date.parse(sub.requestedAt) || 0) > CONFIRM_TTL_MS) {
    return page(res, 400, "확인 링크가 만료됐습니다", "<p>사이트에서 새 글 알림을 다시 신청해 주세요.</p>");
  }
  const next = {
    ...sub, status: "active", categories: sub.pendingCategories || sub.categories || [],
    confirmedAt: new Date().toISOString()
  };
  delete next.confirmToken;
  delete next.pendingCategories;
  delete next.requestedAt;
  await pipeline([
    ["HSET", SUBS_KEY, email, JSON.stringify(next)],
    ["HSET", TOKENS_KEY, next.token, email],
    ["HDEL", CONFIRM_KEY, token]
  ]);
  const cats = next.categories.length ? next.categories.map(esc).join(", ") : "모든 분류";
  return page(res, 200, "새 글 알림을 신청했습니다", `<p>${esc(email)}로 <strong>${cats}</strong>의 새 글을 알려 드립니다.</p>`);
}

/* ───────── 수신 거부 ───────── */
async function removeSub(email) {
  const sub = parseSub(await command("HGET", SUBS_KEY, email));
  if (!sub) return false;
  const ops = [["HDEL", SUBS_KEY, email]];
  if (sub.token) ops.push(["HDEL", TOKENS_KEY, sub.token]);
  if (sub.confirmToken) ops.push(["HDEL", CONFIRM_KEY, sub.confirmToken]);
  await pipeline(ops);
  return true;
}

function unsubscribePage(res, token) {
  return page(res, 200, "새 글 알림 수신 거부",
    `<p>아래 버튼을 누르면 새 글 알림 메일이 더 이상 가지 않습니다.</p>` +
    `<form method="post" action="/api/notify?unsubscribe=${encodeURIComponent(token)}">` +
    `<button type="submit" style="min-height:44px;padding:0 16px;border:0;border-radius:6px;background:#1B1813;color:#F6F1E7;font:inherit;font-weight:700">수신 거부</button></form>`);
}

async function unsubscribeByToken(req, res, token, asPage) {
  const email = token ? await command("HGET", TOKENS_KEY, token) : null;
  const removed = email ? await removeSub(email) : false;
  if (asPage) {
    return removed
      ? page(res, 200, "수신 거부했습니다", "<p>새 글 알림 메일이 더 이상 가지 않습니다.</p>")
      : page(res, 404, "이미 해지됐거나 잘못된 링크입니다", "<p>구독 정보를 찾지 못했습니다.</p>");
  }
  if (!removed) return res.status(404).json({ error: "구독 정보를 찾지 못했습니다." });
  return res.status(200).json({ ok: true });
}

async function handleDelete(req, res) {
  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
  }
  const token = typeof body.token === "string" ? body.token.trim() : pick(req.query?.token);
  if (token) return unsubscribeByToken(req, res, token, false);
  const user = session(req);
  if (!user) return res.status(401).json({ error: "로그인하거나 메일의 수신 거부 링크를 이용해 주세요." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  const own = cleanEmail(user.email);
  const email = body.email ? cleanEmail(body.email) : own;
  if (!email || email !== own) return res.status(403).json({ error: "로그인한 계정의 주소만 해지할 수 있습니다." });
  await removeSub(email);
  return res.status(200).json({ ok: true });
}

/* ───────── 등록 ───────── */
async function handleSubscribe(req, res) {
  if (!sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  if (!notifyEnabled()) return res.status(503).json({ error: "알림 기능이 비활성화돼 있습니다(메일 발송 설정 전)." });
  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
  }
  const email = cleanEmail(body.email);
  if (!email) return res.status(400).json({ error: "올바른 이메일 주소를 입력해 주세요." });
  if (body.categories != null && !Array.isArray(body.categories)) return res.status(400).json({ error: "categories는 배열이어야 합니다." });
  const categories = cleanCategories(body.categories);

  const rateKey = `notify:rate:${ipHash(req)}:${new Date().toISOString().slice(0, 13)}`;
  const [count] = await pipeline([["INCR", rateKey], ["EXPIRE", rateKey, "3600"]]);
  if (Number(count) > RATE_LIMIT) return res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });

  const user = session(req);
  const verified = !!user && cleanEmail(user.email) === email;
  const prev = parseSub(await command("HGET", SUBS_KEY, email));
  const now = new Date().toISOString();
  const base = baseURL(req);

  if (verified) {
    // 로그인한 본인 주소: 확인 메일 없이 바로 활성(분류 변경도 즉시 반영)
    const next = { email, categories, status: "active", token: prev?.token || newToken(), createdAt: prev?.createdAt || now, confirmedAt: now };
    const ops = [["HSET", SUBS_KEY, email, JSON.stringify(next)], ["HSET", TOKENS_KEY, next.token, email]];
    if (prev?.confirmToken) ops.push(["HDEL", CONFIRM_KEY, prev.confirmToken]);
    await pipeline(ops);
    return res.status(200).json({ ok: true, status: "active", subscription: publicSub(next) });
  }

  // 그 밖: 확인 메일. 이미 활성인 구독이면 기존 설정은 그대로 두고 확인 후에만 분류를 바꾼다.
  const confirmToken = newToken();
  const next = prev?.status === "active"
    ? { ...prev, pendingCategories: categories, confirmToken, requestedAt: now }
    : { email, categories, status: "pending", token: prev?.token || newToken(), createdAt: prev?.createdAt || now, confirmToken, requestedAt: now };
  const ops = [["HSET", SUBS_KEY, email, JSON.stringify(next)], ["HSET", CONFIRM_KEY, confirmToken, email]];
  if (prev?.confirmToken) ops.push(["HDEL", CONFIRM_KEY, prev.confirmToken]);
  await pipeline(ops);
  try {
    await sendOne({ to: email, ...renderConfirmMail(base, confirmToken) });
  } catch (err) {
    console.error("[notify] 확인 메일 발송 실패:", err.message);
    return res.status(502).json({ error: "확인 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
  // 이미 구독 중인지 여부는 알려 주지 않는다(다른 사람 주소 확인 방지).
  return res.status(200).json({ ok: true, status: "pending" });
}

/* ───────── 새 항목 발송 ───────── */
async function handleDispatch(req, res, dryRun) {
  const catalog = await loadCatalog(req);
  const keys = catalog.items.map((it) => it.itemId);
  const [seenCount] = await pipeline([["SCARD", SEEN_KEY]]);
  if (!Number(seenCount)) {
    if (!dryRun && keys.length) await pipeline([["SADD", SEEN_KEY, ...keys]]);
    return res.status(200).json({ ok: true, seeded: keys.length, newItems: 0, recipients: 0, sent: 0, dryRun });
  }
  const flags = await pipeline(keys.map((k) => ["SISMEMBER", SEEN_KEY, k]));
  const fresh = catalog.items.filter((_, i) => Number(flags[i]) !== 1)
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, MAX_NEW_PER_DISPATCH);
  if (!fresh.length) return res.status(200).json({ ok: true, newItems: 0, recipients: 0, sent: 0, dryRun });

  if (dryRun) {
    const [flat] = await pipeline([["HGETALL", SUBS_KEY]]);
    const recipients = activeSubs(flat).filter((s) => fresh.some((it) => matches(s, it))).length;
    return res.status(200).json({ ok: true, dryRun, newItems: fresh.length, items: fresh.map((it) => it.itemId), recipients, sent: 0 });
  }
  if (!notifyEnabled()) return res.status(503).json({ error: "RESEND_API_KEY 설정이 필요합니다." });

  const ids = fresh.map((it) => it.itemId);
  const result = await notifySubscribers(fresh, { base: baseURL(req), idempotencyBase: idempotencyFor(`notify-${kstDate()}`, ids) });
  // 실패한 묶음이 없을 때만 "본 것"으로 표시한다(다음 실행에서 재시도 — Idempotency-Key로 24시간 내 중복 방지).
  if (!result.failed) await pipeline([["SADD", SEEN_KEY, ...ids]]);
  return res.status(result.failed && !result.sent ? 502 : 200).json({ ok: !result.failed, newItems: fresh.length, ...result });
}

export default async function handler(req, res) {
  noStore(res);
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "GET·POST·DELETE 요청만 받습니다." });
  }
  const q = req.query || {};
  const confirm = pick(q.confirm);
  const unsub = pick(q.unsubscribe);
  const dispatch = (req.method === "POST" && pick(q.action) === "dispatch") || (req.method === "GET" && pick(q.dispatch) === "1");

  if (req.method === "GET" && !confirm && !unsub && !dispatch) {
    try {
      return await handleStatus(req, res);
    } catch (err) {
      console.error("[notify] 상태 조회 오류:", err.message);
      return res.status(502).json({ error: "알림 저장소에 연결하지 못했습니다." });
    }
  }
  if (dispatch && !authorized(req)) return res.status(401).json({ error: "발송 권한이 없습니다." });
  if (!kvConfigured()) {
    console.error("[notify] KV 환경변수 미설정");
    if (confirm || unsub) return page(res, 503, "잠시 후 다시 시도해 주세요", "<p>알림 저장소 설정이 아직 끝나지 않았습니다.</p>");
    return res.status(503).json({ error: "알림 저장소 설정이 아직 끝나지 않았습니다." });
  }
  try {
    if (dispatch) {
      let body = {};
      if (req.method === "POST") {
        try { body = readBody(req); } catch { return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." }); }
      }
      return await handleDispatch(req, res, body.dryRun === true || pick(q.dryRun) === "1");
    }
    if (req.method === "GET" && confirm) return await handleConfirm(req, res, confirm);
    if (req.method === "GET" && unsub) return unsubscribePage(res, unsub);
    if (req.method === "POST" && unsub) return await unsubscribeByToken(req, res, unsub, true);
    if (req.method === "POST") return await handleSubscribe(req, res);
    return await handleDelete(req, res);
  } catch (err) {
    console.error("[notify] 오류:", err.message);
    if (confirm || unsub) return page(res, 502, "처리하지 못했습니다", "<p>잠시 후 다시 시도해 주세요.</p>");
    return res.status(502).json({ error: "알림 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}
