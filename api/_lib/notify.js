/* 새 글 알림 — 구독자 저장·매칭·메일 생성·Resend 발송. api/notify.js·api/submit.js 공용.
   KV 키:
     notify:subscribers   해시  필드 = 소문자 이메일, 값 = { email, categories[], status: pending|active, token, createdAt, confirmedAt }
     notify:tokens        해시  토큰 → 이메일(확인·수신 거부 링크용, 이메일을 주소에 싣지 않는다)
     notify:seen          집합  이미 알림 처리한 항목 키(처음 실행 때는 현재 목록 전체를 채우기만 하고 보내지 않는다)
   키는 RESEND_API_KEY 환경변수에서만 읽고 응답·로그에 싣지 않는다. */

import crypto from "node:crypto";
import { pipeline } from "./kv.js";
import { esc, EMAIL_RE } from "./digest.js";
import { permalink } from "./catalog.js";

export const SUBS_KEY = "notify:subscribers";
export const TOKENS_KEY = "notify:tokens";
export const SEEN_KEY = "notify:seen";
export const MAX_CATEGORIES = 20;
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_SEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 20000;
const BATCH_SIZE = 100;
const MAX_ITEMS_PER_MAIL = 10;
const SUMMARY_CHARS = 140;
const DEFAULT_FROM = "리서치 데스크 <onboarding@resend.dev>";

export const notifyEnabled = () => !!process.env.RESEND_API_KEY;
export const notifyFrom = () => process.env.NOTIFY_FROM || process.env.DIGEST_FROM || DEFAULT_FROM;

export function cleanEmail(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v.length <= 254 && EMAIL_RE.test(v) ? v : "";
}

// 분류 이름 목록 정리(빈 배열 = 전체 분류)
export function cleanCategories(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    const v = typeof c === "string" ? c.trim().slice(0, 50) : "";
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

export const newToken = () => crypto.randomBytes(24).toString("base64url");

export function parseSub(raw) {
  try {
    const s = JSON.parse(raw);
    return s && s.email ? s : null;
  } catch {
    return null;
  }
}

// HGETALL 결과 → 활성 구독자 배열
export function activeSubs(flat) {
  const out = [];
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) {
    const s = parseSub(flat[i + 1]);
    if (s && s.status === "active") out.push(s);
  }
  return out;
}

// 관심 분류가 비어 있으면 모든 분류를 받는다.
export function matches(sub, item) {
  const cats = Array.isArray(sub.categories) ? sub.categories : [];
  return !cats.length || cats.includes(item.category);
}

/* ───────── 메일 내용 ───────── */
function clip(text, n) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// 알림 메일의 링크: 사이트 목록에 있는 글은 카드 주소, 독자 추천 링크는 원문 주소
function linkOf(base, it) {
  return it.siteLink === false ? it.url : permalink(base, it.itemId);
}

export function unsubscribeURL(base, token) {
  return `${base}/api/notify?unsubscribe=${encodeURIComponent(token)}`;
}

export function renderNotifyMail(items, { base, token }) {
  const list = items.slice(0, MAX_ITEMS_PER_MAIL);
  const more = items.length - list.length;
  const unsub = unsubscribeURL(base, token);
  const rows = list.map((it) =>
    `<tr><td style="padding:12px 0;border-bottom:1px solid #E2DCCF">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#2E4A7A">${esc(it.category || "기타")}</p>` +
    `<a href="${esc(linkOf(base, it))}" style="font-size:16px;font-weight:700;color:#1B1813;text-decoration:none">${esc(it.title)}</a>` +
    (it.summary ? `<p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:#5F5B52">${esc(clip(it.summary, SUMMARY_CHARS))}</p>` : "") +
    `</td></tr>`).join("");
  const html =
    `<!doctype html><html lang="ko"><body style="margin:0;background:#F6F1E7">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E7"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFDF8;border:1px solid #E2DCCF;border-radius:8px;font-family:'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif">` +
    `<tr><td style="padding:20px 20px 4px"><p style="margin:0;font-size:20px;font-weight:900;color:#1B1813">리서치 데스크 — 새 글 ${items.length}건</p>` +
    `<p style="margin:6px 0 0;font-size:13px;color:#5F5B52">관심 분류에 새 글이 올라왔습니다.</p></td></tr>` +
    `<tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` +
    (more > 0 ? `<tr><td style="padding:12px 20px 0;font-size:13px;color:#5F5B52">그 밖에 ${more}건 더 — <a href="${esc(base)}/#view=archive" style="color:#2E4A7A">아카이브에서 보기</a></td></tr>` : "") +
    `<tr><td style="padding:20px;font-size:12px;color:#5F5B52">이 메일은 새 글 알림을 신청하셔서 보내 드립니다. <a href="${esc(unsub)}" style="color:#5F5B52">수신 거부</a></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = [`리서치 데스크 — 새 글 ${items.length}건`, ""]
    .concat(list.map((it) => `[${it.category || "기타"}] ${it.title}\n${linkOf(base, it)}`))
    .concat(more > 0 ? [`그 밖에 ${more}건 더: ${base}/#view=archive`] : [])
    .concat(["", `수신 거부: ${unsub}`]).join("\n");
  const subject = `[리서치 데스크] 새 글 ${items.length}건 — ${clip(list[0]?.title, 40)}`;
  return { subject, html, text, unsub };
}

/* ───────── 발송 ───────── */
async function resend(url, payload, idempotencyKey) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(data?.message || data?.name || "").slice(0, 200)}`);
  return data;
}

// 메일 한 통(구독 확인 등)
export async function sendOne({ to, subject, html, text }) {
  if (!notifyEnabled()) throw Object.assign(new Error("RESEND_API_KEY 설정이 필요합니다."), { status: 503 });
  return resend(RESEND_SEND_URL, { from: notifyFrom(), to: [to], subject, html, text });
}

export function renderConfirmMail(base, token) {
  const link = `${base}/api/notify?confirm=${encodeURIComponent(token)}`;
  return {
    subject: "[리서치 데스크] 새 글 알림 신청 확인",
    html: `<!doctype html><html lang="ko"><body style="font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#F6F1E7;padding:24px">` +
      `<p style="font-size:16px;color:#1B1813">리서치 데스크 새 글 알림 신청을 확인해 주세요.</p>` +
      `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#1B1813;color:#F6F1E7;border-radius:6px;text-decoration:none">알림 신청 확인</a></p>` +
      `<p style="font-size:12px;color:#5F5B52">직접 신청하지 않으셨다면 이 메일을 무시하세요. 확인하지 않으면 알림이 가지 않습니다.</p></body></html>`,
    text: `리서치 데스크 새 글 알림 신청을 확인해 주세요.\n${link}\n\n직접 신청하지 않으셨다면 이 메일을 무시하세요.`
  };
}

/* 새 항목들을 구독자에게 보낸다. items: [{ itemId, title, summary, url, category, siteLink? }]
   구독자마다 관심 분류에 맞는 글만 모아 한 통씩. 반환 { recipients, sent, failed, errors } */
export async function notifySubscribers(items, { base, idempotencyBase }) {
  const result = { recipients: 0, sent: 0, failed: 0, errors: [] };
  if (!items.length || !notifyEnabled()) return result;
  const [flat] = await pipeline([["HGETALL", SUBS_KEY]]);
  const mails = [];
  for (const sub of activeSubs(flat)) {
    const mine = items.filter((it) => matches(sub, it));
    if (!mine.length) continue;
    const m = renderNotifyMail(mine, { base, token: sub.token });
    mails.push({
      from: notifyFrom(), to: [sub.email], subject: m.subject, html: m.html, text: m.text,
      headers: { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    });
  }
  result.recipients = mails.length;
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);
    try {
      await resend(RESEND_BATCH_URL, chunk, `${idempotencyBase}-${i / BATCH_SIZE}`);
      result.sent += chunk.length;
    } catch (err) {
      result.failed += chunk.length;
      result.errors.push(err.name === "TimeoutError" ? "Resend 응답 시간 초과" : err.message);
    }
  }
  return result;
}

// 같은 항목 묶음은 같은 키 → 24시간 안 재시도해도 Resend가 중복 발송하지 않는다.
export function idempotencyFor(prefix, ids) {
  return `${prefix}-${crypto.createHash("sha256").update(ids.slice().sort().join(",")).digest("hex").slice(0, 24)}`;
}
