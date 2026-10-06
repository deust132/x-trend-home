/* Vercel KV(= Vercel Marketplace의 Upstash Redis) REST 클라이언트. 패키지 없이 fetch만 쓴다.
   연결 정보는 환경변수에서만 읽는다:
   KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV 이름) 또는
   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash 이름) */

const KV_TIMEOUT_MS = 5000;

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV 연결 환경변수 미설정");
  return { url: url.replace(/\/+$/, ""), token };
}

export function kvConfigured() {
  return !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
}

// 명령 여러 개를 한 번에 보낸다. 결과 배열(명령 순서대로)을 돌려준다.
export async function pipeline(commands) {
  const { url, token } = config();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(KV_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`KV HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("KV 응답 형식 오류");
  return data.map((r) => {
    if (r && r.error) throw new Error(`KV 오류: ${r.error}`);
    return r ? r.result : null;
  });
}

export async function command(...args) {
  return (await pipeline([args]))[0];
}
