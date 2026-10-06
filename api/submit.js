/* 독자 링크 추천 — /api/submit
   POST { url, title, description, category }  (로그인 필요) → { ok, submission }  상태 pending으로 접수
   GET  ?status=approved   → { items: [...] }  승인된 추천(공개, 최근 50건, 추천자 정보 없음)
   GET  ?mine=1            (로그인 필요) → { items: [...] }  내가 추천한 링크와 상태
   GET  [?status=pending]  (관리자) → { items: [...] }  심사 대기 목록(오래된 순)
   POST /api/submit/approve { id, action?: "approve"|"reject" }  (관리자) → 승인·반려
        (옛 주소 /api/submit/approve는 vercel.json rewrite가 /api/submit?route=approve로 넘긴다)
        승인하면 상태 approved + 승인 목록에 넣고, data/pending.json(아카이브 병합 대기 파일)에 덧붙인다.
        Vercel 배포본은 파일 시스템이 읽기 전용이라 파일 쓰기는 건너뛰고(file: null) KV 승인 목록만 남는다.
        승인 후 관심 분류가 맞는 알림 구독자에게 메일(api/_lib/notify.js, RESEND_API_KEY 있을 때).
   관리자: 로그인 이메일이 ADMIN_EMAILS(쉼표 구분)에 있거나 "Authorization: Bearer <SUBMIT_ADMIN_SECRET 또는 DIGEST_SECRET>".
   KV 키: submissions:<타임스탬프ms>(추천 JSON), submissions:index:pending|approved|rejected(정렬 집합, 점수 = 타임스탬프),
          submissions:user:<sub>(내 추천), submissions:url:<URL 해시>(중복 방지), submissions:rate:<sub>:<날짜>(하루 한도). */

import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { command, kvConfigured, pipeline } from "./_lib/kv.js";
import { baseURL, bearerMatches, getSession, noStore, sameOrigin } from "./_lib/session.js";
import { kstDate, loadCatalog, safeURL } from "./_lib/catalog.js";
import { idempotencyFor, notifySubscribers } from "./_lib/notify.js";

const MAX_BODY_CHARS = 6000;
const DAILY_LIMIT = 10;
const LIST_LIMIT = 50;
const PENDING_LIMIT = 200;
const LIMITS = { title: 200, description: 1000, category: 50 };
const STATUSES = ["pending", "approved", "rejected"];
const PENDING_FILE = path.join(process.cwd(), "data", "pending.json");

export const recordKey = (id) => `submissions:${id}`;
const indexKey = (status) => `submissions:index:${status}`;
const userKey = (sub) => `submissions:user:${sub}`;
const urlKey = (url) => `submissions:url:${crypto.createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
const ID_RE = /^\d{10,16}$/;

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
    console.error("[submit] 세션 확인 오류:", err.message);
    return null;
  }
}

function isAdmin(req, user) {
  if (bearerMatches(req, process.env.SUBMIT_ADMIN_SECRET) || bearerMatches(req, process.env.DIGEST_SECRET)) return true;
  const admins = String(process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!user?.email && admins.includes(user.email.toLowerCase());
}

const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");

function parseRecord(raw) {
  try {
    const r = JSON.parse(raw);
    return r && r.id ? r : null;
  } catch {
    return null;
  }
}

// 공개 응답에서는 추천자 정보를 뺀다.
function publicView(r) {
  const { submittedBy, ...rest } = r;
  return rest;
}

// 아카이브(archive.json) 항목 모양 — 승인 목록·pending.json 공용
export function archiveShape(r) {
  return {
    id: `sub-${r.id}`, title: r.title, summary: r.description || "", insight: "", author: "독자 추천",
    likes: 0, url: r.url, category: r.category || "기타", source: "submission",
    archivedAt: r.approvedAt || r.submittedAt, tags: ["독자추천"]
  };
}

async function listByIndex(status, { rev = true, limit = LIST_LIMIT } = {}) {
  const ids = await command(rev ? "ZREVRANGE" : "ZRANGE", indexKey(status), "0", String(limit - 1));
  if (!Array.isArray(ids) || !ids.length) return [];
  const raws = await command("MGET", ...ids.map(recordKey));
  return (raws || []).map(parseRecord).filter((r) => r && r.status === status);
}

/* ───────── 접수 ───────── */
async function handleCreate(req, res, user) {
  if (!sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
  }
  const url = safeURL(typeof body.url === "string" && body.url.length <= 2000 ? body.url : "");
  const title = text(body.title, LIMITS.title);
  const description = text(body.description, LIMITS.description);
  const category = text(body.category, LIMITS.category) || "기타";
  if (!url) return res.status(400).json({ error: "http(s)로 시작하는 링크 주소가 필요합니다." });
  if (!title) return res.status(400).json({ error: "제목을 입력해 주세요." });

  // 이미 사이트에 있는 원문이면 받지 않는다(목록을 못 읽으면 이 검사만 건너뛴다).
  try {
    const catalog = await loadCatalog(req);
    if (catalog.items.some((it) => it.url === url)) return res.status(409).json({ error: "이미 아카이브에 있는 글입니다." });
  } catch (err) {
    console.error("[submit] 목록 확인 생략:", err.message);
  }

  const rateKey = `submissions:rate:${user.sub}:${kstDate()}`;
  const [count] = await pipeline([["INCR", rateKey], ["EXPIRE", rateKey, String(2 * 24 * 60 * 60)]]);
  if (Number(count) > DAILY_LIMIT) return res.status(429).json({ error: `추천은 하루 ${DAILY_LIMIT}건까지 받을 수 있습니다.` });

  // 같은 링크는 한 번만(반려된 링크도 다시 받지 않는다)
  let id = Date.now();
  const [dupe] = await pipeline([["SET", urlKey(url), String(id), "NX"]]);
  if (dupe !== "OK") return res.status(409).json({ error: "이미 누군가 추천한 링크입니다." });

  const record = {
    id: "", url, title, description, category, status: "pending",
    submittedAt: new Date().toISOString(),
    submittedBy: { sub: user.sub, email: user.email, name: user.name }
  };
  // 키는 submissions:<타임스탬프>. 같은 밀리초에 겹치면 1씩 올린다.
  for (let tries = 0; tries < 5; tries++, id++) {
    record.id = String(id);
    const [ok] = await pipeline([["SET", recordKey(record.id), JSON.stringify(record), "NX"]]);
    if (ok === "OK") {
      await pipeline([
        ["ZADD", indexKey("pending"), String(id), record.id],
        ["ZADD", userKey(user.sub), String(id), record.id],
        ["SET", urlKey(url), record.id]
      ]);
      return res.status(201).json({ ok: true, submission: publicView(record) });
    }
  }
  await command("DEL", urlKey(url));
  return res.status(503).json({ error: "접수가 몰려 있습니다. 잠시 후 다시 시도해 주세요." });
}

/* ───────── 승인·반려 ───────── */
// 로컬·자체 서버처럼 파일을 쓸 수 있을 때만 data/pending.json에 덧붙인다.
async function appendPendingFile(item) {
  let doc = { updated: "", items: [] };
  try {
    doc = JSON.parse(await readFile(PENDING_FILE, "utf8"));
    if (!Array.isArray(doc.items)) doc.items = [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!doc.items.some((it) => it.id === item.id)) doc.items.push(item);
  doc.updated = new Date().toISOString();
  await writeFile(PENDING_FILE, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

async function handleApprove(req, res, user) {
  if (!isAdmin(req, user)) return user || req.headers.authorization
    ? res.status(403).json({ error: "관리자만 승인할 수 있습니다." })
    : res.status(401).json({ error: "로그인이 필요합니다." });
  if (!req.headers.authorization && !sameOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
  }
  const id = typeof body.id === "string" || typeof body.id === "number" ? String(body.id).replace(/^submissions:/, "").trim() : "";
  const action = body.action == null ? "approve" : String(body.action);
  if (!ID_RE.test(id)) return res.status(400).json({ error: "id가 필요합니다." });
  if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "action은 approve 또는 reject입니다." });

  const record = parseRecord(await command("GET", recordKey(id)));
  if (!record) return res.status(404).json({ error: "추천을 찾지 못했습니다." });
  if (record.status !== "pending") return res.status(409).json({ error: `이미 처리된 추천입니다(${record.status}).` });

  const status = action === "approve" ? "approved" : "rejected";
  const next = { ...record, status, [`${status}At`]: new Date().toISOString(), reviewedBy: user?.email || "token" };
  await pipeline([
    ["SET", recordKey(id), JSON.stringify(next)],
    ["ZREM", indexKey("pending"), id],
    ["ZADD", indexKey(status), id, id]
  ]);
  if (status === "rejected") return res.status(200).json({ ok: true, submission: publicView(next) });

  const item = archiveShape(next);
  let file = null;
  try {
    await appendPendingFile(item);
    file = "data/pending.json";
  } catch (err) {
    console.info("[submit] pending.json 쓰기 생략(읽기 전용 배포):", err.code || err.message);
  }
  let notify = null;
  try {
    notify = await notifySubscribers(
      [{ itemId: item.id, title: item.title, summary: item.summary, url: item.url, category: item.category, siteLink: false }],
      { base: baseURL(req), idempotencyBase: idempotencyFor("notify-sub", [item.id]) }
    );
  } catch (err) {
    console.error("[submit] 알림 발송 실패:", err.message);
    notify = { error: "알림 발송에 실패했습니다." };
  }
  return res.status(200).json({ ok: true, submission: publicView(next), item, file, notify });
}

/* ───────── 조회 ───────── */
async function handleList(req, res, user) {
  const q = req.query || {};
  if (pick(q.mine) === "1") {
    if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
    const ids = await command("ZREVRANGE", userKey(user.sub), "0", String(LIST_LIMIT - 1));
    const raws = Array.isArray(ids) && ids.length ? await command("MGET", ...ids.map(recordKey)) : [];
    return res.status(200).json({ items: (raws || []).map(parseRecord).filter(Boolean).map(publicView) });
  }
  const status = pick(q.status) || "pending";
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "status는 pending·approved·rejected 중 하나입니다." });
  if (status === "approved") {
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ items: (await listByIndex("approved")).map(archiveShape) });
  }
  if (!isAdmin(req, user)) return user || req.headers.authorization
    ? res.status(403).json({ error: "관리자만 볼 수 있습니다." })
    : res.status(401).json({ error: "로그인이 필요합니다." });
  const items = await listByIndex(status, { rev: status !== "pending", limit: status === "pending" ? PENDING_LIMIT : LIST_LIMIT });
  return res.status(200).json({ status, items });
}

function isApproveRoute(req) {
  if (req.query?.route === "approve") return true;
  return String(req.url || "").split("?")[0].replace(/\/+$/, "").endsWith("/submit/approve");
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GET·POST 요청만 받습니다." });
  }
  const user = session(req);
  const approve = isApproveRoute(req);
  if (approve && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST 요청만 받습니다." });
  }
  // 로그인 필요 기능은 저장소 상태와 무관하게 먼저 401
  if (req.method === "POST" && !approve && !user) return res.status(401).json({ error: "로그인한 사용자만 추천할 수 있습니다." });
  if (!kvConfigured()) {
    console.error("[submit] KV 환경변수 미설정");
    return res.status(503).json({ error: "추천 저장소 설정이 아직 끝나지 않았습니다." });
  }
  try {
    if (approve) return await handleApprove(req, res, user);
    if (req.method === "POST") return await handleCreate(req, res, user);
    return await handleList(req, res, user);
  } catch (err) {
    console.error("[submit] 저장소 오류:", err.message);
    return res.status(502).json({ error: "추천 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}
