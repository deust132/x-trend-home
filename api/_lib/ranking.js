/* 좋아요·저장 집계(Upstash KV) — api/likes.js, api/bookmarks.js, api/digest.js, api/trends-report.js 공용.
   키 구조:
     likes:<itemId>          문자열 카운터 — 누적 좋아요 수(INCR)
     likes:day:<YYYY-MM-DD>  정렬 집합 — 그날(한국 시간) 받은 좋아요 수, 40일 뒤 만료
     likes:all               정렬 집합 — 누적 좋아요 순위
     saves:day:<YYYY-MM-DD>  정렬 집합 — 그날 새로 저장(북마크)된 횟수, 40일 뒤 만료
     saves:all               정렬 집합 — 현재 저장 수(해제하면 -1)
   주간·월간 순위는 최근 7·30일의 일별 집합을 합산한다(어느 요일에 봐도 "최근 7일"). */

import { command, kvConfigured, pipeline } from "./kv.js";
import { daysBack, kstDate } from "./catalog.js";

export const PERIODS = { week: { days: 7, label: "주간" }, month: { days: 30, label: "월간" } };
export const DAY_TTL_SECONDS = 40 * 24 * 60 * 60;

export const likeCountKey = (id) => `likes:${id}`;
export const likeDayKey = (day) => `likes:day:${day}`;
export const saveDayKey = (day) => `saves:day:${day}`;
export const LIKES_ALL = "likes:all";
export const SAVES_ALL = "saves:all";

export function periodOf(value) {
  return Object.prototype.hasOwnProperty.call(PERIODS, value) ? value : "week";
}

// 기간 [from, to] (to 포함). to 기본값은 오늘(한국 시간).
export function windowOf(period, to = kstDate()) {
  const days = daysBack(to, PERIODS[period].days);
  return { period, from: days[days.length - 1], to, days };
}

// 일별 정렬 집합들을 합산해 [{ itemId, count }] (많은 순, 동점은 키 순)
export async function sumDays(keyFor, days) {
  if (!kvConfigured() || !days.length) return [];
  const rows = await pipeline(days.map((d) => ["ZRANGE", keyFor(d), "0", "-1", "WITHSCORES"]));
  const total = new Map();
  rows.forEach((flat) => {
    for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) {
      const n = Number(flat[i + 1]);
      if (Number.isFinite(n)) total.set(flat[i], (total.get(flat[i]) || 0) + n);
    }
  });
  return [...total.entries()]
    .filter(([, n]) => n > 0)
    .map(([itemId, count]) => ({ itemId, count }))
    .sort((a, b) => b.count - a.count || (a.itemId < b.itemId ? -1 : 1));
}

// 누적 좋아요 수 여러 개 → { itemId: n }
export async function likeCounts(ids) {
  if (!ids.length) return {};
  const values = await command("MGET", ...ids.map(likeCountKey));
  const out = {};
  ids.forEach((id, i) => { out[id] = Math.max(0, Number(values?.[i]) || 0); });
  return out;
}

/* 기간 순위 + 대체 순서. 기록이 없으면 다음 기준으로 넘어간다.
   order 예: ["likes", "saves"] → 좋아요 → 저장 → (아카이브 좋아요 필드) → 최근 보관순
   반환: { basis, items: [{ ...항목, count }] } — 목록에 없는 키(지워진 글)는 뺀다. */
export async function rankItems(catalog, win, { order = ["likes", "saves"], limit = 10 } = {}) {
  const sources = { likes: likeDayKey, saves: saveDayKey };
  for (const basis of order) {
    let rows = [];
    try {
      rows = await sumDays(sources[basis], win.days);
    } catch (err) {
      console.error(`[ranking] ${basis} 집계 실패:`, err.message);
    }
    const items = rows
      .filter((r) => catalog.byKey.has(r.itemId))
      .slice(0, limit)
      .map((r) => ({ ...catalog.byKey.get(r.itemId), count: r.count }));
    if (items.length) return { basis, items };
  }
  const inWindow = catalog.items.filter((it) => it.date >= win.from && it.date <= win.to);
  const pool = inWindow.length ? inWindow : catalog.items;
  const liked = pool.filter((it) => it.likes > 0).sort((a, b) => b.likes - a.likes);
  if (liked.length) return { basis: "source-likes", items: liked.slice(0, limit).map((it) => ({ ...it, count: it.likes })) };
  const latest = [...pool].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  return { basis: "latest", items: latest.slice(0, limit).map((it) => ({ ...it, count: 0 })) };
}

export const BASIS_LABELS = {
  likes: "좋아요 수",
  saves: "저장 수",
  "source-likes": "원문(X) 좋아요 수",
  latest: "최근 보관순(아직 집계 기록 없음)"
};
