/* 사이트 항목 목록(data/archive.json + data/daily.json) — 좋아요·다이제스트·트렌드 리포트 공용.
   배포 번들에 data/가 있으면 그대로 읽고, 없으면 같은 사이트의 정적 파일을 받아 온다(api/rss.js와 같은 방식).
   항목 키는 app.js·api/rss.js의 itemKey와 같은 규칙이다(같은 원문 → 같은 키). */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { baseURL } from "./session.js";

const FETCH_TIMEOUT_MS = 8000;
const CACHE_MS = 5 * 60 * 1000; // 함수 인스턴스가 살아 있는 동안 5분 재사용
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ITEM_ID_RE = /^[\w-]{1,100}$/;

export function itemKey(it) {
  const m = /\/status(?:es)?\/(\d+)/.exec(String(it?.url || ""));
  if (m) return `x-${m[1]}`;
  // "th:DeIZu…", "gh:owner/repo"처럼 원문 번호가 없는 출처는 id의 기호를 "-"로 바꿔 키로 쓴다.
  const id = String(it?.id || "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return ITEM_ID_RE.test(id) ? id : "";
}

export function safeURL(value) {
  try {
    const u = new URL(String(value || "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

/* ───────── 날짜(한국 시간 기준 "YYYY-MM-DD") ───────── */
export function kstDate(d = new Date()) {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function isDay(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
}

// end를 포함해 거꾸로 days일: ["end", "end-1", ...]
export function daysBack(end, days) {
  return Array.from({ length: days }, (_, i) => addDays(end, -i));
}

// "2026-10-05" 또는 ISO 시각 → 한국 날짜
function toDay(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const v = value.trim();
  if (isDay(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? kstDate(new Date(t)) : "";
}

/* ───────── 데이터 읽기 ───────── */
let cached = null; // { at, catalog }

async function loadJSON(req, name) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", name), "utf8"));
  } catch {
    const res = await fetch(`${baseURL(req)}/data/${name}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${name} 응답 ${res.status}`);
    return res.json();
  }
}

function cleanTags(list) {
  return (Array.isArray(list) ? list : []).map((t) => String(t || "").trim()).filter(Boolean);
}

// 화면·메일에 필요한 필드만 남긴 항목
function slim(it, key, day) {
  return {
    itemId: key,
    title: String(it.title || "").trim(),
    summary: typeof it.summary === "string" ? it.summary.trim() : "",
    insight: typeof it.insight === "string" ? it.insight.trim() : "",
    url: safeURL(it.url),
    category: typeof it.category === "string" ? it.category.trim() : "",
    tags: cleanTags(it.tags),
    author: typeof it.author === "string" && it.author !== "@?" ? it.author : "",
    likes: Number.isFinite(Number(it.likes)) ? Math.max(0, Math.floor(Number(it.likes))) : 0,
    date: day
  };
}

/* { items: [...], byKey: Map, archiveUpdated, dailyDate }
   archive.json을 먼저 넣고 daily.json은 아카이브에 없는 원문만 더한다.
   (같은 원문이면 아카이브의 태그·보관일이 더 정확하다.) */
export function buildCatalog(archive, daily) {
  const byKey = new Map();
  const add = (it, fallbackDay) => {
    if (!it || typeof it !== "object" || !it.title) return;
    const key = itemKey(it);
    if (!key || byKey.has(key)) return;
    byKey.set(key, slim(it, key, toDay(it.archivedAt) || fallbackDay));
  };
  (Array.isArray(archive?.items) ? archive.items : []).forEach((it) => add(it, toDay(archive?.updated)));
  const dailyDay = toDay(daily?.date) || toDay(daily?.updatedAt);
  (Array.isArray(daily?.items) ? daily.items : []).forEach((it) => add(it, dailyDay));
  return {
    items: [...byKey.values()],
    byKey,
    archiveUpdated: typeof archive?.updated === "string" ? archive.updated : "",
    dailyDate: dailyDay
  };
}

// 둘 중 하나가 없어도 나머지로 만든다. 둘 다 없으면 오류.
export async function loadCatalog(req) {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;
  const [archive, daily] = await Promise.allSettled([loadJSON(req, "archive.json"), loadJSON(req, "daily.json")]);
  if (archive.status === "rejected" && daily.status === "rejected") {
    throw new Error(`데이터를 읽지 못했습니다: ${archive.reason?.message}`);
  }
  const catalog = buildCatalog(
    archive.status === "fulfilled" ? archive.value : null,
    daily.status === "fulfilled" ? daily.value : null
  );
  cached = { at: Date.now(), catalog };
  return catalog;
}

export function permalink(base, itemId) {
  return `${base}/#item=${encodeURIComponent(itemId)}`;
}
