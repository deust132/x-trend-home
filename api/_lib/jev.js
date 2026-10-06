/* Jev(OpenRouter) 공용 호출 — api/jev/*.js 전용.
   키는 OPENROUTER_API_KEY 환경변수에서만 읽고 응답·로그에 싣지 않는다.
   모델 ID는 OpenRouter 모델 목록의 "TypeSafe: Jev Router"(2026-10-05 확인). JEV_MODEL로 덮어쓸 수 있다. */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const JEV_MODEL = process.env.JEV_MODEL || "typesafe/jev-router";
export const CATEGORIES = ["Jev", "Grok Bot", "AI 코딩", "AI 에이전트·자동화", "AI 미디어 생성", "디자인·크리에이티브", "AI 학습·인사이트", "기타"];

const JEV_TIMEOUT_MS = 45000;
const TEMPERATURE = 0.1; // 분류·점수·중복 판정은 결정 작업
export const MAX_FIELD_CHARS = 2000;

export class JevError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// POST 확인 + JSON 본문 파싱. 실패하면 응답을 보내고 null.
export function readBody(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "POST 요청만 받습니다." });
    return null;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not object");
    return body;
  } catch {
    res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
    return null;
  }
}

export const text = (v, n = MAX_FIELD_CHARS) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// 모델이 코드 블록이나 앞뒤 설명을 붙여도 첫 JSON 객체를 꺼낸다.
export function parseJSON(raw) {
  const s = String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(s); } catch { /* 아래에서 재시도 */ }
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* 아래에서 실패 처리 */ }
  }
  throw new JevError(502, "Jev 응답을 해석하지 못했습니다.");
}

export const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n * 100) / 100)) : 0;
};

// system·user 프롬프트를 보내고 JSON 객체를 돌려받는다.
export async function askJev(system, user, { maxTokens = 400 } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[jev] OPENROUTER_API_KEY 미설정");
    throw new JevError(500, "Jev 설정이 필요합니다");
  }
  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "AI Trend Research Desk"
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: TEMPERATURE,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        stream: false
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS)
    });
  } catch (err) {
    console.error("[jev] 호출 실패:", err.message);
    throw new JevError(502, "Jev 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!res.ok) {
    console.error("[jev] HTTP", res.status);
    throw new JevError(502, "Jev 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const data = await res.json().catch(() => null);
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== "string" || !content.trim()) throw new JevError(502, "Jev가 빈 응답을 보냈습니다.");
  return parseJSON(content);
}

// 엔드포인트 공통 실행: JevError는 상태 코드 그대로, 그 밖은 500.
export async function handleJev(res, run) {
  try {
    return res.status(200).json(await run());
  } catch (err) {
    if (err instanceof JevError) return res.status(err.status).json({ error: err.message });
    console.error("[jev] 처리 실패:", err.message);
    return res.status(500).json({ error: "Jev 처리 중 오류가 발생했습니다." });
  }
}
