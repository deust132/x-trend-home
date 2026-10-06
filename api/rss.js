/* GET /api/rss — 아카이브(data/archive.json) 최신 30건의 RSS 2.0 피드.
   항목 링크는 사이트의 카드 고정 주소(/#item=<키>)이고, 원문(X) 주소는 본문 끝에 붙인다.
   키 규칙은 app.js의 itemKey와 같아야 한다(같은 원문 → 같은 공유 링크·댓글 스레드). */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { baseURL } from "./_lib/session.js";

const MAX_ITEMS = 30;
const FETCH_TIMEOUT_MS = 8000;
const SITE_TITLE = "리서치 데스크 — AI 트렌드 아카이브";
const SITE_DESCRIPTION = "AI 트렌드 일일 리포트 — 애널리스트의 책상에서";

// XML에 쓸 수 없는 제어 문자는 지우고 특수 문자는 이스케이프한다.
function xml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function itemKey(it) {
  const m = /\/status(?:es)?\/(\d+)/.exec(String(it?.url || ""));
  if (m) return `x-${m[1]}`;
  // "th:DeIZu…", "gh:owner/repo"처럼 원문 번호가 없는 출처는 id의 기호를 "-"로 바꿔 키로 쓴다.
  const id = String(it?.id || "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[\w-]{1,100}$/.test(id) ? id : "";
}

// "2026-10-05"처럼 날짜만 있으면 한국 시간 0시로 본다.
function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+09:00` : v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function safeURL(value) {
  try {
    const u = new URL(String(value || "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

// 배포 번들에 data/가 있으면 그대로 읽고, 없으면 같은 사이트의 정적 파일을 받아 온다.
async function loadArchive(req) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", "archive.json"), "utf8"));
  } catch {
    const res = await fetch(`${baseURL(req)}/data/archive.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`archive.json 응답 ${res.status}`);
    return res.json();
  }
}

export function latestItems(archive, limit = MAX_ITEMS) {
  const seen = new Set();
  const items = (Array.isArray(archive?.items) ? archive.items : []).filter((it) => {
    if (!it || typeof it !== "object" || !it.title) return false;
    const key = itemKey(it) || safeURL(it.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 최근 보관순(같은 날짜는 파일 순서 유지 — sort는 안정 정렬)
  items.sort((a, b) => (parseDate(b.archivedAt)?.getTime() || 0) - (parseDate(a.archivedAt)?.getTime() || 0));
  return items.slice(0, limit);
}

export function buildRSS(archive, base) {
  const site = `${base}/`;
  const updated = parseDate(archive?.updated) || new Date();
  const entries = latestItems(archive).map((it) => {
    const key = itemKey(it);
    const link = key ? `${site}#item=${encodeURIComponent(key)}` : safeURL(it.url) || site;
    const source = safeURL(it.url);
    const parts = [it.summary, it.insight ? `💡 ${it.insight}` : "", source ? `원문: ${source}` : ""].filter(Boolean);
    const date = parseDate(it.archivedAt);
    const tags = (Array.isArray(it.tags) ? it.tags : []).map((t) => String(t || "").trim()).filter(Boolean);
    return [
      "    <item>",
      `      <title>${xml(it.title)}</title>`,
      `      <link>${xml(link)}</link>`,
      `      <guid isPermaLink="false">${xml(key || link)}</guid>`,
      `      <description>${xml(parts.join("\n\n"))}</description>`,
      date ? `      <pubDate>${date.toUTCString()}</pubDate>` : "",
      it.category ? `      <category>${xml(it.category)}</category>` : "",
      ...tags.map((t) => `      <category>${xml(t)}</category>`),
      key ? `      <comments>${xml(link)}</comments>` : "",
      "    </item>"
    ].filter(Boolean).join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xml(SITE_TITLE)}</title>`,
    `    <link>${xml(site)}</link>`,
    `    <description>${xml(SITE_DESCRIPTION)}</description>`,
    "    <language>ko</language>",
    `    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${xml(`${base}/api/rss`)}" rel="self" type="application/rss+xml"/>`,
    ...entries,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "GET 요청만 받습니다." });
  }
  let archive;
  try {
    archive = await loadArchive(req);
  } catch (err) {
    console.error("[rss] 아카이브를 읽지 못했습니다:", err.message);
    return res.status(502).json({ error: "아카이브를 읽지 못했습니다." });
  }
  const body = buildRSS(archive, baseURL(req).replace(/\/+$/, ""));
  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
  return res.status(200).send(req.method === "HEAD" ? "" : body);
}
