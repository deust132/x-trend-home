/* 주간 다이제스트 이메일 — 내용 집계·HTML/텍스트 생성·Resend 발송. api/digest.js 전용.
   메일 클라이언트 호환을 위해 표(table) 배치 + 인라인 스타일만 쓴다(외부 CSS·스크립트·웹폰트 없음).
   Resend: https://resend.com/docs/api-reference/emails/send-batch-emails
   키는 RESEND_API_KEY 환경변수에서만 읽고 응답·로그에 싣지 않는다. */

import { permalink } from "./catalog.js";
import { BASIS_LABELS, PERIODS, rankItems, windowOf } from "./ranking.js";
import { buildReport } from "./report.js";

export const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
export const SUBSCRIBERS_KEY = "digest:subscribers"; // KV 집합 — 구독자 이메일(나중에 구독 폼에서 SADD)
export const EDITOR_NOTE_KEY = "digest:note"; // KV 문자열 — 이번 호 에디터 코멘트(선택)
const BATCH_SIZE = 100; // Resend 배치 최대 개수
const RESEND_TIMEOUT_MS = 20000;
const TOP_LIMIT = 10;
const SUMMARY_CHARS = 140;
const SITE_NAME = "리서치 데스크";

const C = {
  paper: "#F6F1E7", card: "#FFFDF8", ink: "#1B1813", graphite: "#5F5B52", rule: "#E2DCCF",
  stamp: "#2E4A7A", stampSoft: "#E7EEF8", pencil: "#A83A2E", insightBg: "#E9F3EC", insightInk: "#1F3D2C"
};
const FONT = "'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";
const SERIF = "'Noto Serif KR','Nanum Myeongjo',Georgia,serif";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clip(text, n) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function dot(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : day;
}

export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;

/* ───────── 내용 집계 ───────── */
// 카테고리별 하이라이트: 기간 안 순위(좋아요·저장) 1위 글, 없으면 그 분류의 최근 글
function highlights(catalog, win, ranked) {
  const inWin = catalog.items.filter((it) => it.date >= win.from && it.date <= win.to);
  const pool = inWin.length ? inWin : catalog.items;
  const counts = new Map();
  pool.forEach((it) => { if (it.category) counts.set(it.category, (counts.get(it.category) || 0) + 1); });
  const rankOf = new Map(ranked.map((it, i) => [it.itemId, i]));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([category, count]) => {
      const inCat = pool.filter((it) => it.category === category);
      const best = inCat.filter((it) => rankOf.has(it.itemId)).sort((a, b) => rankOf.get(a.itemId) - rankOf.get(b.itemId))[0] || inCat[0];
      return { category, count, item: best };
    });
}

export async function buildDigestData(catalog, { period = "week", anchor = "" } = {}) {
  const report = await buildReport(catalog, { period, anchor });
  const win = windowOf(period, report.to); // 리포트가 최근 보관일로 옮겼으면 그 기간을 그대로 쓴다
  const top = await rankItems(catalog, win, { order: ["likes", "saves"], limit: TOP_LIMIT });
  return {
    period, label: PERIODS[period].label, from: win.from, to: win.to,
    top: top.items, basis: top.basis, basisLabel: BASIS_LABELS[top.basis],
    highlights: highlights(catalog, win, top.items),
    report
  };
}

/* ───────── HTML ───────── */
function section(title, inner) {
  return `<tr><td style="padding:24px 24px 0;">
<h2 style="margin:0 0 12px;font-family:${SERIF};font-size:19px;line-height:1.35;color:${C.ink};border-bottom:2px solid ${C.ink};padding-bottom:6px;">${esc(title)}</h2>
${inner}
</td></tr>`;
}

function topRow(it, i, base) {
  const link = permalink(base, it.itemId);
  const meta = [it.category, it.count && it.metric ? `${it.metric}${it.count.toLocaleString("ko-KR")}` : ""].filter(Boolean).map(esc).join(" · ");
  return `<tr>
<td valign="top" width="36" style="padding:10px 0;border-bottom:1px solid ${C.rule};font-family:${SERIF};font-size:20px;font-weight:900;color:${i < 3 ? C.pencil : C.graphite};">${i + 1}</td>
<td valign="top" style="padding:10px 0;border-bottom:1px solid ${C.rule};font-family:${FONT};">
<a href="${esc(link)}" style="color:${C.ink};font-size:15px;font-weight:700;line-height:1.45;text-decoration:none;">${esc(it.title)}</a>
${meta ? `<div style="margin-top:3px;font-size:12px;color:${C.graphite};">${meta}</div>` : ""}
${it.summary ? `<div style="margin-top:4px;font-size:13px;line-height:1.55;color:${C.graphite};">${esc(clip(it.summary, SUMMARY_CHARS))}</div>` : ""}
</td></tr>`;
}

const METRIC = { likes: "좋아요 ", saves: "저장 ", "source-likes": "X 좋아요 ", latest: "" };

export function renderDigestHTML(data, { base, note = "", unsubscribeURL = "" } = {}) {
  const site = `${base}/`;
  const range = `${dot(data.from)} ~ ${dot(data.to)}`;
  const preheader = `${data.label} 인기 TOP ${data.top.length} · ${range}`;
  const metric = METRIC[data.basis] || "";

  const noteHTML = note
    ? `<div style="font-family:${FONT};font-size:14px;line-height:1.7;color:${C.insightInk};white-space:pre-line;">${esc(note)}</div>`
    : `<div style="font-family:${FONT};font-size:14px;line-height:1.7;color:${C.graphite};font-style:italic;">(에디터 코멘트 자리 — 발송 전에 이번 주 한 줄 평을 넣어 주세요.)</div>`;

  const topHTML = data.top.length
    ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${C.graphite};">기준: ${esc(data.basisLabel)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${data.top.map((it, i) => topRow({ ...it, metric }, i, base)).join("")}</table>`
    : `<p style="margin:0;font-family:${FONT};font-size:14px;color:${C.graphite};">이번 기간에 집계된 글이 없습니다.</p>`;

  const hlHTML = data.highlights.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${data.highlights.map((h) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.rule};font-family:${FONT};">
<div style="font-size:12px;font-weight:700;color:${C.stamp};">${esc(h.category)} <span style="font-weight:400;color:${C.graphite};">· ${h.count}건</span></div>
<a href="${esc(permalink(base, h.item.itemId))}" style="display:block;margin-top:2px;color:${C.ink};font-size:14px;line-height:1.45;text-decoration:none;">${esc(h.item.title)}</a>
</td></tr>`).join("")}</table>`
    : `<p style="margin:0;font-family:${FONT};font-size:14px;color:${C.graphite};">하이라이트가 없습니다.</p>`;

  const r = data.report;
  const chips = (list) => list.map((t) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border:1px solid ${C.rule};border-radius:999px;background:${C.card};font-size:12px;color:${C.ink};">${esc(t)}</span>`).join("");
  const trendBits = [];
  if (r.risingCategories.length) {
    trendBits.push(`<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${C.ink};">급상승 분류</p><div>${chips(r.risingCategories.map((c) => `${c.category} +${c.delta}`))}</div>`);
  }
  if (r.newTags.length) {
    trendBits.push(`<p style="margin:8px 0 6px;font-size:13px;font-weight:700;color:${C.ink};">새로 등장한 태그</p><div>${chips(r.newTags.map((t) => `#${t.tag}`))}</div>`);
  }
  const trendHTML = trendBits.length ? section("트렌드 한눈에", `<div style="font-family:${FONT};">${trendBits.join("")}</div>`) : "";

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(`${SITE_NAME} ${data.label} 다이제스트`)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.card};border:1px solid ${C.rule};border-radius:12px;">
<tr><td style="padding:24px 24px 0;">
<div style="font-family:${FONT};font-size:12px;letter-spacing:0.08em;color:${C.graphite};">${esc(`${data.label} DIGEST · ${range}`)}</div>
<h1 style="margin:6px 0 0;font-family:${SERIF};font-size:26px;font-weight:900;line-height:1.25;color:${C.ink};">${esc(SITE_NAME)} ${esc(data.label)} 다이제스트</h1>
<p style="margin:6px 0 0;font-family:${FONT};font-size:14px;color:${C.graphite};">AI 트렌드 — 애널리스트의 책상에서 한 주를 정리했습니다.</p>
</td></tr>
${section("에디터 코멘트", `<div style="padding:14px 16px;border-left:4px solid ${C.insightInk};background:${C.insightBg};border-radius:6px;">${noteHTML}</div>`)}
${section(`${data.label} 인기 TOP ${data.top.length || TOP_LIMIT}`, topHTML)}
${section("카테고리별 하이라이트", hlHTML)}
${trendHTML}
<tr><td style="padding:24px;">
<a href="${esc(site)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${C.ink};color:${C.paper};font-family:${FONT};font-size:14px;font-weight:700;text-decoration:none;">사이트에서 전체 보기</a>
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${C.rule};font-family:${FONT};font-size:12px;line-height:1.6;color:${C.graphite};">
${esc(SITE_NAME)}을 구독해 주셔서 감사합니다. <a href="${esc(`${base}/api/rss`)}" style="color:${C.stamp};">RSS</a>로도 받아 볼 수 있습니다.
${unsubscribeURL ? `<br><a href="${esc(unsubscribeURL)}" style="color:${C.graphite};">수신 거부</a>` : ""}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// HTML을 못 여는 메일 앱용 텍스트 본문
export function renderDigestText(data, { base, note = "", unsubscribeURL = "" } = {}) {
  const lines = [`${SITE_NAME} ${data.label} 다이제스트 (${dot(data.from)} ~ ${dot(data.to)})`, ""];
  lines.push("■ 에디터 코멘트", note || "(에디터 코멘트 자리)", "");
  lines.push(`■ ${data.label} 인기 TOP ${data.top.length || TOP_LIMIT} — 기준: ${data.basisLabel}`);
  data.top.forEach((it, i) => lines.push(`${i + 1}. ${it.title}${it.category ? ` [${it.category}]` : ""}`, `   ${permalink(base, it.itemId)}`));
  lines.push("", "■ 카테고리별 하이라이트");
  data.highlights.forEach((h) => lines.push(`- ${h.category} (${h.count}건): ${h.item.title}`, `  ${permalink(base, h.item.itemId)}`));
  if (data.report.risingCategories.length) lines.push("", `■ 급상승 분류: ${data.report.risingCategories.map((c) => `${c.category} +${c.delta}`).join(", ")}`);
  if (data.report.newTags.length) lines.push(`■ 새 태그: ${data.report.newTags.map((t) => `#${t.tag}`).join(" ")}`);
  lines.push("", `${base}/`);
  if (unsubscribeURL) lines.push(`수신 거부: ${unsubscribeURL}`);
  return lines.join("\n");
}

export function digestSubject(data) {
  return `[${SITE_NAME}] ${data.label} 다이제스트 — ${dot(data.from)}~${dot(data.to)} 인기 TOP ${data.top.length}`;
}

/* ───────── 발송(Resend 배치) ─────────
   받는 사람마다 메일을 따로 만든다(다른 구독자 주소가 보이지 않게).
   Idempotency-Key로 같은 호·같은 묶음을 24시간 안에 다시 보내도 중복 발송되지 않는다. */
export async function sendDigest({ recipients, from, subject, html, text, unsubscribeURL = "", idempotencyBase }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw Object.assign(new Error("RESEND_API_KEY 설정이 필요합니다."), { status: 503 });
  const results = { sent: 0, failed: 0, ids: [], errors: [] };
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((to) => ({
      from, to: [to], subject, html, text,
      ...(unsubscribeURL ? { headers: { "List-Unsubscribe": `<${unsubscribeURL}>` } } : {})
    }));
    try {
      const res = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${idempotencyBase}-${i / BATCH_SIZE}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        results.failed += chunk.length;
        results.errors.push(`HTTP ${res.status}: ${String(data?.message || data?.name || "").slice(0, 200)}`);
        continue;
      }
      const ids = Array.isArray(data?.data) ? data.data.map((d) => d?.id).filter(Boolean) : [];
      results.sent += chunk.length;
      results.ids.push(...ids);
    } catch (err) {
      results.failed += chunk.length;
      results.errors.push(err.name === "TimeoutError" ? "Resend 응답 시간 초과" : err.message);
    }
  }
  return results;
}
