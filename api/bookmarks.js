/* 내 북마크 — /api/bookmarks (로그인한 사용자만)
   GET              → { items: [...] }  저장한 목록(최근 저장순)
   POST   { item }  → { ok, item }      저장(같은 원문 URL이면 덮어씀)
   DELETE { url }   → { ok }            해제
   저장소: Vercel KV(Upstash Redis) 해시 하나에 사용자별로 담는다.
   키 bm:v1:<Google sub>, 필드 = 원문 URL의 SHA-256 앞 32자, 값 = 항목 스냅숏 JSON.
   스냅숏을 같이 저장해 두므로 원본 리포트가 아카이브에서 빠져도 북마크 페이지에 남는다.
   새로 저장·해제할 때 전체 저장 집계(saves:day:<날짜>, saves:all — api/_lib/ranking.js)도 함께 고친다.
   집계는 트렌드 리포트의 "가장 많이 저장된 글"에 쓰이며, 실패해도 북마크 자체는 성공으로 둔다. */

import crypto from "node:crypto";
import { command, kvConfigured, pipeline } from "./_lib/kv.js";
import { getSession, noStore, sameOrigin } from "./_lib/session.js";
import { itemKey, kstDate } from "./_lib/catalog.js";
import { DAY_TTL_SECONDS, SAVES_ALL, saveDayKey } from "./_lib/ranking.js";

const MAX_BOOKMARKS = 500;
const MAX_BODY_CHARS = 20000;
// 저장할 필드와 최대 길이
const TEXT_FIELDS = { id: 100, title: 300, summary: 2000, insight: 2000, author: 100, category: 50, source: 50, archivedAt: 40 };

export const keyFor = (sub) => `bm:v1:${sub}`;
const fieldFor = (url) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);

function cleanURL(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

function cleanItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = cleanURL(raw.url);
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!url || !title) return null;
  const item = { url };
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    if (raw[k] == null) continue;
    const v = String(raw[k]).trim().slice(0, max);
    if (v) item[k] = v;
  }
  const likes = Number(raw.likes);
  if (Number.isFinite(likes) && likes >= 0) item.likes = Math.floor(likes);
  return item;
}

// 저장 집계 갱신(delta: +1 새 저장, -1 해제). 주간 집계는 "새로 저장된 횟수"라 해제 때는 누적만 뺀다.
async function countSave(item, delta) {
  const id = itemKey(item);
  if (!id) return;
  const ops = [["ZINCRBY", SAVES_ALL, String(delta), id]];
  if (delta > 0) {
    const day = saveDayKey(kstDate());
    ops.push(["ZINCRBY", day, "1", id], ["EXPIRE", day, String(DAY_TTL_SECONDS)]);
  }
  try {
    await pipeline(ops);
  } catch (err) {
    console.error("[bookmarks] 저장 집계 실패:", err.message);
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const text = typeof req.body === "string" ? req.body : "";
  if (text.length > MAX_BODY_CHARS) throw new Error("too large");
  return JSON.parse(text || "{}");
}

// HGETALL 결과 [field, value, field, value, ...] → 항목 배열(최근 저장순)
export function parseAll(flat) {
  const items = [];
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) {
    try {
      const it = JSON.parse(flat[i + 1]);
      if (it && it.url) items.push(it);
    } catch {
      /* 깨진 값은 건너뛴다 */
    }
  }
  return items.sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0));
}

export default async function handler(req, res) {
  noStore(res);
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "GET·POST·DELETE 요청만 받습니다." });
  }

  let user;
  try {
    user = getSession(req);
  } catch (err) {
    console.error("[bookmarks] 세션 확인 오류:", err.message);
  }
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });

  if (req.method !== "GET" && !sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });

  if (!kvConfigured()) {
    console.error("[bookmarks] KV 환경변수 미설정");
    return res.status(500).json({ error: "북마크 저장소 설정이 아직 끝나지 않았습니다." });
  }

  const key = keyFor(user.sub);
  try {
    if (req.method === "GET") {
      return res.status(200).json({ items: parseAll(await command("HGETALL", key)) });
    }

    let body;
    try {
      body = readBody(req);
    } catch {
      return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
    }

    if (req.method === "POST") {
      const item = cleanItem(body.item);
      if (!item) return res.status(400).json({ error: "item에 제목과 http(s) 원문 URL이 필요합니다." });
      const field = fieldFor(item.url);
      const [exists, count] = await pipeline([["HEXISTS", key, field], ["HLEN", key]]);
      if (!exists && count >= MAX_BOOKMARKS) {
        return res.status(409).json({ error: `북마크는 최대 ${MAX_BOOKMARKS}개까지 저장할 수 있습니다.` });
      }
      item.savedAt = new Date().toISOString();
      await command("HSET", key, field, JSON.stringify(item));
      if (!exists) await countSave(item, 1);
      return res.status(200).json({ ok: true, item });
    }

    // DELETE: 본문 { url } 또는 ?url=
    const url = cleanURL(body.url || (req.query && req.query.url));
    if (!url) return res.status(400).json({ error: "해제할 원문 url이 필요합니다." });
    const field = fieldFor(url);
    const [prev, removed] = await pipeline([["HGET", key, field], ["HDEL", key, field]]);
    if (Number(removed) === 1) {
      let saved = { url };
      try { saved = JSON.parse(prev) || saved; } catch { /* 깨진 값이면 URL로만 키를 만든다 */ }
      await countSave(saved, -1);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[bookmarks] 저장소 오류:", err.message);
    return res.status(502).json({ error: "북마크 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}
