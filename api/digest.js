/* 주간 다이제스트 이메일 — /api/digest
   GET  ?period=week|month[&date=YYYY-MM-DD][&note=…][&format=html|text|json]
        → 이메일 미리보기(기본 HTML). 공개 데이터만 담기므로 인증 없이 볼 수 있다.
   POST { period?, date?, note?, to?: [이메일…], dryRun? }  + "Authorization: Bearer <DIGEST_SECRET 또는 CRON_SECRET>"
        → Resend로 발송. to가 있으면 그 주소로만(테스트), 없으면 KV 집합 digest:subscribers 전원.
          dryRun이면 보내지 않고 받는 사람 수·제목만 돌려준다.
   GET + 같은 인증 + ?send=1 → POST와 같음(Vercel Cron은 GET만 호출한다).
   환경변수: RESEND_API_KEY(발송), DIGEST_FROM(보내는 사람, 기본 Resend 테스트 주소 — 본인 계정 주소로만 전달됨),
            DIGEST_EDITOR_NOTE(에디터 코멘트 기본값), DIGEST_UNSUBSCRIBE_URL(수신 거부 링크, 선택).
   에디터 코멘트 우선순위: 요청 note → KV digest:note → DIGEST_EDITOR_NOTE → 빈 자리 안내 문구. */

import { command, kvConfigured } from "./_lib/kv.js";
import { baseURL, bearerMatches, noStore } from "./_lib/session.js";
import { isDay, kstDate, loadCatalog } from "./_lib/catalog.js";
import { periodOf } from "./_lib/ranking.js";
import {
  EDITOR_NOTE_KEY, EMAIL_RE, SUBSCRIBERS_KEY,
  buildDigestData, digestSubject, renderDigestHTML, renderDigestText, sendDigest
} from "./_lib/digest.js";

const DEFAULT_FROM = "리서치 데스크 <onboarding@resend.dev>";
const MAX_NOTE_CHARS = 1500;
const MAX_TEST_RECIPIENTS = 10;
const MAX_BODY_CHARS = 10000;

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

const authorized = (req) => bearerMatches(req, process.env.DIGEST_SECRET) || bearerMatches(req, process.env.CRON_SECRET);

async function editorNote(requested) {
  if (requested) return requested.slice(0, MAX_NOTE_CHARS);
  if (kvConfigured()) {
    try {
      const saved = await command("GET", EDITOR_NOTE_KEY);
      if (typeof saved === "string" && saved.trim()) return saved.trim().slice(0, MAX_NOTE_CHARS);
    } catch (err) {
      console.error("[digest] 에디터 코멘트 읽기 실패:", err.message);
    }
  }
  return String(process.env.DIGEST_EDITOR_NOTE || "").trim().slice(0, MAX_NOTE_CHARS);
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GET·POST 요청만 받습니다." });
  }
  const q = req.query || {};
  const sending = req.method === "POST" || pick(q.send) === "1";
  if (sending && !authorized(req)) {
    const configured = process.env.DIGEST_SECRET || process.env.CRON_SECRET;
    return res.status(configured ? 401 : 503).json({
      error: configured ? "인증이 필요합니다." : "DIGEST_SECRET(또는 CRON_SECRET) 환경변수를 설정해야 발송할 수 있습니다."
    });
  }

  let body = {};
  if (req.method === "POST") {
    try {
      body = readBody(req);
    } catch {
      return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
    }
  }
  const period = periodOf(pick(body.period ?? q.period) || "week");
  const date = pick(body.date ?? q.date);
  if (date && !isDay(date)) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });

  const base = baseURL(req).replace(/\/+$/, "");
  const unsubscribeURL = String(process.env.DIGEST_UNSUBSCRIBE_URL || "").trim();
  let data, note;
  try {
    [data, note] = await Promise.all([
      loadCatalog(req).then((catalog) => buildDigestData(catalog, { period, anchor: date })),
      editorNote(pick(body.note ?? q.note))
    ]);
  } catch (err) {
    console.error("[digest] 집계 실패:", err.message);
    return res.status(502).json({ error: "다이제스트 내용을 만들지 못했습니다." });
  }
  const opts = { base, note, unsubscribeURL };
  const subject = digestSubject(data);
  const html = renderDigestHTML(data, opts);
  const text = renderDigestText(data, opts);

  if (!sending) {
    const format = pick(q.format) || "html";
    if (format === "json") {
      return res.status(200).json({
        subject, period: data.period, from: data.from, to: data.to, basis: data.basis,
        top: data.top.map((it, i) => ({ rank: i + 1, itemId: it.itemId, title: it.title, category: it.category, count: it.count })),
        highlights: data.highlights.map((h) => ({ category: h.category, count: h.count, itemId: h.item.itemId, title: h.item.title })),
        hasEditorNote: !!note, html, text
      });
    }
    if (format === "text") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(text);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  }

  // 받는 사람
  let recipients;
  const requested = Array.isArray(body.to) ? body.to : typeof body.to === "string" ? [body.to] : null;
  if (requested) {
    recipients = [...new Set(requested.map((e) => String(e || "").trim().toLowerCase()))];
    if (!recipients.length || recipients.length > MAX_TEST_RECIPIENTS || !recipients.every((e) => EMAIL_RE.test(e))) {
      return res.status(400).json({ error: `to는 올바른 이메일 1~${MAX_TEST_RECIPIENTS}개여야 합니다.` });
    }
  } else {
    if (!kvConfigured()) return res.status(503).json({ error: "구독자 저장소(KV) 설정이 아직 끝나지 않았습니다." });
    try {
      const list = await command("SMEMBERS", SUBSCRIBERS_KEY);
      recipients = [...new Set((Array.isArray(list) ? list : []).map((e) => String(e).trim().toLowerCase()))].filter((e) => EMAIL_RE.test(e));
    } catch (err) {
      console.error("[digest] 구독자 읽기 실패:", err.message);
      return res.status(502).json({ error: "구독자 목록을 읽지 못했습니다." });
    }
    if (!recipients.length) return res.status(200).json({ ok: true, sent: 0, recipients: 0, subject, note: "구독자가 없습니다." });
  }

  if (body.dryRun === true) return res.status(200).json({ ok: true, dryRun: true, recipients: recipients.length, subject });

  try {
    const result = await sendDigest({
      recipients,
      from: String(process.env.DIGEST_FROM || DEFAULT_FROM),
      subject, html, text, unsubscribeURL,
      // 테스트 발송은 매번 새로 보내고, 구독자 발송은 같은 날 같은 호를 한 번만 보낸다.
      idempotencyBase: requested ? `digest-test-${Date.now()}` : `digest-${period}-${data.to}-${kstDate()}`
    });
    const status = result.sent ? 200 : 502;
    return res.status(status).json({ ok: result.sent > 0, recipients: recipients.length, subject, ...result });
  } catch (err) {
    console.error("[digest] 발송 실패:", err.message);
    return res.status(err.status || 502).json({ error: err.status ? err.message : "메일을 보내지 못했습니다." });
  }
}
