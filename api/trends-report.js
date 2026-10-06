/* 주간·월간 트렌드 리포트 — /api/trends-report
   GET  ?period=week|month[&date=YYYY-MM-DD]  → 리포트 JSON (집계 규칙은 api/_lib/report.js)
        화면(app.js "주간 베스트" 보기)이 호출한다. 매번 새로 집계하고 CDN에 5분 캐시한다.
   GET·POST + "Authorization: Bearer <CRON_SECRET>"  → 집계 후 KV에 스냅숏 저장
        report:<period>:<기준일>, report:<period>:latest (90일 보관). Vercel Cron은 이 헤더를 자동으로 붙인다.
        수동 실행 예: curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<사이트>/api/trends-report?period=week"
   KV가 없어도 집계는 된다(가장 많이 저장된 글만 최근 보관순으로 대체). */

import { command, kvConfigured } from "./_lib/kv.js";
import { bearerMatches, noStore } from "./_lib/session.js";
import { isDay, loadCatalog } from "./_lib/catalog.js";
import { periodOf } from "./_lib/ranking.js";
import { buildReport } from "./_lib/report.js";

const SNAPSHOT_TTL_SECONDS = 90 * 24 * 60 * 60;

function query(req, name) {
  const v = req.query?.[name];
  return String((Array.isArray(v) ? v[0] : v) || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GET·POST 요청만 받습니다." });
  }
  const trigger = bearerMatches(req, process.env.CRON_SECRET);
  if (req.method === "POST" && !trigger) {
    noStore(res);
    return res.status(process.env.CRON_SECRET ? 401 : 503).json({
      error: process.env.CRON_SECRET ? "인증이 필요합니다." : "CRON_SECRET 환경변수를 설정해야 수동 실행할 수 있습니다."
    });
  }

  const period = periodOf(query(req, "period") || "week");
  const date = query(req, "date");
  if (date && !isDay(date)) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });

  let report;
  try {
    report = await buildReport(await loadCatalog(req), { period, anchor: date });
  } catch (err) {
    console.error("[trends-report] 집계 실패:", err.message);
    noStore(res);
    return res.status(502).json({ error: "리포트를 만들지 못했습니다." });
  }

  if (!trigger) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json(report);
  }

  noStore(res);
  if (!kvConfigured()) return res.status(200).json({ ...report, saved: false, saveError: "KV 미설정" });
  try {
    const body = JSON.stringify(report);
    await command("SET", `report:${period}:${report.to}`, body, "EX", String(SNAPSHOT_TTL_SECONDS));
    await command("SET", `report:${period}:latest`, body, "EX", String(SNAPSHOT_TTL_SECONDS));
    return res.status(200).json({ ...report, saved: true });
  } catch (err) {
    console.error("[trends-report] 스냅숏 저장 실패:", err.message);
    return res.status(200).json({ ...report, saved: false, saveError: "KV 저장 실패" });
  }
}
