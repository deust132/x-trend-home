/* 북마크 내보내기 — /api/export (로그인한 사용자만)
   GET ?format=md  → text/markdown  "# 내 북마크\n\n## [카테고리] 제목\n- 요약\n- 링크\n"
   GET ?format=csv → text/csv       머리글 "제목,카테고리,요약,URL,저장일" (엑셀 한글 깨짐 방지 BOM 포함)
   Content-Disposition: attachment 로 내려 브라우저가 파일로 저장한다.
   목록은 api/bookmarks.js와 같은 KV 해시(bm:v1:<sub>)에서 읽는다(최근 저장순).
   사용자가 바꾼 북마크 이름(customTitle)이 있으면 그걸 제목으로 쓴다. */

import { command, kvConfigured } from "./_lib/kv.js";
import { getSession, noStore } from "./_lib/session.js";
import { kstDate } from "./_lib/catalog.js";
import { keyFor, parseAll } from "./bookmarks.js";

const FORMATS = {
  md: { type: "text/markdown; charset=utf-8", ext: "md" },
  csv: { type: "text/csv; charset=utf-8", ext: "csv" }
};

const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// 바꾼 이름이 있으면 그걸, 없으면 원래 제목을 쓴다.
const displayTitle = (it) => {
  const c = typeof it.customTitle === "string" ? it.customTitle.trim() : "";
  return c || it.title;
};

function savedDay(it) {
  const t = Date.parse(it.savedAt);
  return Number.isFinite(t) ? kstDate(new Date(t)) : "";
}

// 제목 속 줄바꿈·마크다운 제목 기호가 구조를 깨지 않게 한 줄로
export function toMarkdown(items) {
  const out = ["# 내 북마크", ""];
  if (!items.length) out.push("저장한 북마크가 없습니다.", "");
  for (const it of items) {
    out.push(`## [${oneLine(it.category) || "기타"}] ${oneLine(displayTitle(it))}`);
    out.push(`- ${oneLine(it.summary) || "(요약 없음)"}`);
    out.push(`- ${it.url}`);
    out.push("");
  }
  return out.join("\n");
}

// RFC 4180 따옴표 처리 + 스프레드시트 수식 실행 방지(=,+,-,@로 시작하면 앞에 ')
function csvCell(value) {
  let v = oneLine(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCSV(items) {
  const rows = [["제목", "카테고리", "요약", "URL", "저장일"]]
    .concat(items.map((it) => [displayTitle(it), it.category || "기타", it.summary || "", it.url, savedDay(it)]));
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET 요청만 받습니다." });
  }
  let user;
  try {
    user = getSession(req);
  } catch (err) {
    console.error("[export] 세션 확인 오류:", err.message);
  }
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });

  const raw = req.query?.format;
  const format = String((Array.isArray(raw) ? raw[0] : raw) || "md").toLowerCase();
  const spec = FORMATS[format];
  if (!spec) return res.status(400).json({ error: "format은 md 또는 csv입니다." });

  if (!kvConfigured()) {
    console.error("[export] KV 환경변수 미설정");
    return res.status(503).json({ error: "북마크 저장소 설정이 아직 끝나지 않았습니다." });
  }
  let items;
  try {
    items = parseAll(await command("HGETALL", keyFor(user.sub)));
  } catch (err) {
    console.error("[export] 저장소 오류:", err.message);
    return res.status(502).json({ error: "북마크 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }

  // 파일 이름은 ASCII로만(한글 이름은 일부 브라우저가 "download"로 바꿔 저장한다)
  const name = `bookmarks-${kstDate()}.${spec.ext}`;
  res.setHeader("Content-Type", spec.type);
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(format === "csv" ? toCSV(items) : toMarkdown(items));
}
