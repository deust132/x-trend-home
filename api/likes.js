/* 좋아요 — /api/likes
   GET  ?itemId=<키>            → { itemId, likes, liked }   누적 좋아요 수
   GET  ?ids=<키>,<키>,...      → { likes: { 키: n }, liked: [키...] }  카드 여러 장 한 번에(최대 200개)
   GET  /api/likes/top?period=week|month  → { period, from, to, basis, items: [...] }  기간 TOP 10
        (옛 주소 /api/likes/top은 vercel.json rewrite가 /api/likes?route=top으로 넘긴다)
   POST { itemId }               → { ok, itemId, likes, already }  좋아요 +1
   중복 방지: 로그인 사용자는 계정당 1회(likes:users:<키> 집합),
   비로그인은 IP·브라우저 지문 해시당 1회(30일) — 화면에서는 localStorage로 한 번 더 막는다.
   사이트 목록(archive.json·daily.json)에 있는 키만 받는다(아무 키나 올려 순위를 오염시키는 것 방지).
   집계 키 구조는 api/_lib/ranking.js 참고. */

import crypto from "node:crypto";
import { kvConfigured, pipeline } from "./_lib/kv.js";
import { getSession, noStore, sameOrigin } from "./_lib/session.js";
import { ITEM_ID_RE, kstDate, loadCatalog } from "./_lib/catalog.js";
import {
  DAY_TTL_SECONDS, LIKES_ALL, likeCountKey, likeCounts, likeDayKey, periodOf, rankItems, windowOf
} from "./_lib/ranking.js";

const MAX_IDS = 200;
const TOP_LIMIT = 10;
const ANON_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_BODY_CHARS = 2000;

const userSetKey = (id) => `likes:users:${id}`;
const anonKey = (voter, id) => `likes:anon:${voter}:${id}`;

function session(req) {
  try {
    return getSession(req);
  } catch (err) {
    console.error("[likes] 세션 확인 오류:", err.message);
    return null;
  }
}

// 비로그인 투표자: IP + User-Agent 해시(원래 값은 저장하지 않는다)
function anonVoter(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const ua = String(req.headers["user-agent"] || "").slice(0, 300);
  const salt = process.env.LIKES_SALT || process.env.SESSION_SECRET || "research-desk-likes";
  return crypto.createHmac("sha256", salt).update(`${ip}\n${ua}`).digest("hex").slice(0, 32);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const text = typeof req.body === "string" ? req.body : "";
  if (text.length > MAX_BODY_CHARS) throw new Error("too large");
  return JSON.parse(text || "{}");
}

function isTopRoute(req) {
  if (req.query?.route === "top") return true;
  const pathname = String(req.url || "").split("?")[0].replace(/\/+$/, "");
  return pathname.endsWith("/likes/top");
}

function query(req, name) {
  const v = req.query?.[name];
  return typeof (Array.isArray(v) ? v[0] : v) === "string" ? String(Array.isArray(v) ? v[0] : v).trim() : "";
}

async function handleTop(req, res) {
  const period = periodOf(query(req, "period") || "week");
  const win = windowOf(period);
  const catalog = await loadCatalog(req);
  // 순위는 좋아요만 쓴다(기록이 없으면 빈 목록 — 화면이 "아직 좋아요가 없습니다"를 띄운다).
  const ranked = kvConfigured() ? await rankItems(catalog, win, { order: ["likes"], limit: TOP_LIMIT }) : { basis: "latest", items: [] };
  const items = ranked.basis === "likes" ? ranked.items : [];
  const totals = items.length ? await likeCounts(items.map((it) => it.itemId)) : {};
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({
    period, from: win.from, to: win.to,
    items: items.map((it, i) => ({
      rank: i + 1, itemId: it.itemId, likes: it.count, total: totals[it.itemId] || it.count,
      title: it.title, url: it.url, category: it.category, date: it.date
    }))
  });
}

async function handleGet(req, res, user) {
  noStore(res);
  const many = query(req, "ids");
  if (many) {
    const ids = [...new Set(many.split(",").map((s) => s.trim()).filter((s) => ITEM_ID_RE.test(s)))].slice(0, MAX_IDS);
    if (!ids.length) return res.status(400).json({ error: "ids에 올바른 항목 키가 없습니다." });
    const likes = await likeCounts(ids);
    let liked = [];
    if (user) {
      const flags = await pipeline(ids.map((id) => ["SISMEMBER", userSetKey(id), user.sub]));
      liked = ids.filter((_, i) => Number(flags[i]) === 1);
    }
    return res.status(200).json({ likes, liked });
  }
  const itemId = query(req, "itemId");
  if (!ITEM_ID_RE.test(itemId)) return res.status(400).json({ error: "itemId가 필요합니다." });
  const ops = [["GET", likeCountKey(itemId)]];
  if (user) ops.push(["SISMEMBER", userSetKey(itemId), user.sub]);
  const [count, member] = await pipeline(ops);
  return res.status(200).json({ itemId, likes: Math.max(0, Number(count) || 0), liked: Number(member) === 1 });
}

async function handlePost(req, res, user) {
  noStore(res);
  if (!sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
  }
  const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
  if (!ITEM_ID_RE.test(itemId)) return res.status(400).json({ error: "itemId가 필요합니다." });
  const catalog = await loadCatalog(req);
  if (!catalog.byKey.has(itemId)) return res.status(404).json({ error: "목록에 없는 항목입니다." });

  // 1회 제한: 먼저 표식을 남기고, 새로 남겼을 때만 센다.
  const [mark] = await pipeline([user
    ? ["SADD", userSetKey(itemId), user.sub]
    : ["SET", anonKey(anonVoter(req), itemId), "1", "NX", "EX", String(ANON_TTL_SECONDS)]]);
  const fresh = user ? Number(mark) === 1 : mark === "OK";
  if (!fresh) {
    const [count] = await pipeline([["GET", likeCountKey(itemId)]]);
    return res.status(200).json({ ok: true, itemId, likes: Math.max(0, Number(count) || 0), already: true });
  }
  const day = likeDayKey(kstDate());
  const [count] = await pipeline([
    ["INCR", likeCountKey(itemId)],
    ["ZINCRBY", day, "1", itemId],
    ["EXPIRE", day, String(DAY_TTL_SECONDS)],
    ["ZINCRBY", LIKES_ALL, "1", itemId]
  ]);
  return res.status(200).json({ ok: true, itemId, likes: Number(count) || 0, already: false });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GET·POST 요청만 받습니다." });
  }
  if (!kvConfigured()) {
    console.error("[likes] KV 환경변수 미설정");
    noStore(res);
    return res.status(503).json({ error: "좋아요 저장소 설정이 아직 끝나지 않았습니다." });
  }
  try {
    if (req.method === "GET" && isTopRoute(req)) return await handleTop(req, res);
    const user = session(req);
    if (req.method === "GET") return await handleGet(req, res, user);
    return await handlePost(req, res, user);
  } catch (err) {
    console.error("[likes] 오류:", err.message);
    return res.status(502).json({ error: "좋아요 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}
