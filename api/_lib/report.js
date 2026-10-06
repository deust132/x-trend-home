/* 주간·월간 트렌드 리포트 집계 — api/trends-report.js, api/digest.js 공용.
   기간은 기준일(to)을 포함한 최근 7·30일, 비교 대상은 바로 앞 같은 길이의 기간이다.
   - mostSaved: 기간 안에 새로 저장(북마크)된 횟수 TOP 5 → 기록이 없으면 좋아요 → 원문 좋아요 → 최근 보관순
   - risingCategories: 기간 안 보관 글 수가 앞 기간보다 늘어난 분류(증가 폭 순)
   - newTags: 기간 안에 처음 등장한 태그(글 수 순) / topTags: 기간 안 많이 쓰인 태그 */

import { isDay, kstDate } from "./catalog.js";
import { BASIS_LABELS, PERIODS, rankItems, windowOf } from "./ranking.js";

const MOST_SAVED = 5;
const RISING = 5;
const TAGS = 10;

function countBy(items, keysOf) {
  const out = new Map();
  items.forEach((it) => keysOf(it).forEach((k) => { if (k) out.set(k, (out.get(k) || 0) + 1); }));
  return out;
}

const byCount = (a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/* anchor: 기준일 "YYYY-MM-DD"(없으면 오늘). 기준일 기간에 보관 글이 하나도 없고 기준일을 따로 주지 않았으면
   가장 최근 보관일로 옮겨 집계한다(데이터 갱신이 멈춰도 빈 리포트 대신 마지막 주를 보여 준다). */
export async function buildReport(catalog, { period = "week", anchor = "" } = {}) {
  let win = windowOf(period, isDay(anchor) ? anchor : kstDate());
  const inWin = (w) => catalog.items.filter((it) => it.date >= w.from && it.date <= w.to);
  let current = inWin(win);
  let anchoredToLatest = false;
  if (!current.length && !isDay(anchor)) {
    const latest = catalog.items.reduce((m, it) => (it.date > m ? it.date : m), "");
    if (latest) {
      win = windowOf(period, latest);
      current = inWin(win);
      anchoredToLatest = true;
    }
  }
  const prevWin = windowOf(period, windowOf(period, win.from).days[1]);
  const previous = inWin(prevWin);

  // 급상승 분류
  const now = countBy(current, (it) => [it.category]);
  const before = countBy(previous, (it) => [it.category]);
  const risingCategories = [...now.entries()]
    .map(([name, count]) => {
      const prev = before.get(name) || 0;
      return { name, count, previous: prev, delta: count - prev, growth: prev ? Math.round(((count - prev) / prev) * 100) : null };
    })
    .filter((c) => c.delta > 0)
    .sort((a, b) => b.delta - a.delta || byCount(a, b))
    .slice(0, RISING)
    .map(({ name, ...rest }) => ({ category: name, ...rest }));

  // 태그: 처음 등장한 날이 기간 안이면 "새 태그"
  const firstSeen = new Map();
  catalog.items.forEach((it) => it.tags.forEach((t) => {
    if (it.date && (!firstSeen.has(t) || it.date < firstSeen.get(t))) firstSeen.set(t, it.date);
  }));
  const tagCounts = [...countBy(current, (it) => it.tags).entries()].map(([name, count]) => ({ name, count }));
  const newTags = tagCounts
    .filter((t) => firstSeen.get(t.name) >= win.from)
    .sort(byCount)
    .slice(0, TAGS)
    .map((t) => ({ tag: t.name, count: t.count, firstSeen: firstSeen.get(t.name) }));
  const topTags = [...tagCounts].sort(byCount).slice(0, TAGS).map((t) => ({ tag: t.name, count: t.count }));

  const saved = await rankItems(catalog, win, { order: ["saves", "likes"], limit: MOST_SAVED });

  return {
    period,
    label: PERIODS[period].label,
    from: win.from,
    to: win.to,
    anchoredToLatest,
    generatedAt: new Date().toISOString(),
    totals: { items: current.length, previousItems: previous.length, previousFrom: prevWin.from, previousTo: prevWin.to },
    mostSaved: {
      basis: saved.basis,
      basisLabel: BASIS_LABELS[saved.basis],
      items: saved.items.map((it, i) => ({
        rank: i + 1, itemId: it.itemId, title: it.title, url: it.url, category: it.category, count: it.count
      }))
    },
    risingCategories,
    newTags,
    topTags
  };
}
