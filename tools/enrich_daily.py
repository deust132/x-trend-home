#!/usr/bin/env python3
"""일일 리포트 항목에 아카이브 수준의 상세 분석을 추가한다.

사용법:
  DEEPSEEK_API_KEY=... python3 tools/enrich_daily.py [--project-dir DIR] [--limit N]

동작:
  1. data/daily.json을 읽는다.
  2. detail 필드가 없는 항목마다 DeepSeek API로 상세 분석을 생성한다.
     - insight: 1~2문장 핵심 인사이트
     - detail: "## 쉬운 설명 / ## 시사하는 바 / ## 활용 팁" 마크다운
     - tags: 2~5개 태그
  3. data/daily.json을 업데이트한다.
  4. 신규 항목을 data/archive.json에 추가한다 (ID 중복 제거, archivedAt 기록).

멱등성: 이미 detail이 있는 항목은 건너뛴다.
"""

import argparse
import json
import os
import sys
import time
import urllib.request

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"
TIMEOUT = 60
RETRY = 2
PAUSE_SEC = 1.0

SYSTEM_PROMPT = """당신은 AI 트렌드 큐레이터입니다. 주어진 AI 관련 게시물/기사에 대해 한국어로 상세 분석을 작성합니다.

출력은 반드시 아래 JSON 형식으로만 합니다 (다른 텍스트 없이):
{"insight": "...", "detail": "...", "tags": [...]}

필드 규칙:
- insight: 1~2문장으로 핵심 시사점. "~할 수 있다", "~을 시사한다" 체. 200자 이내.
- detail: 아래 3개 섹션의 마크다운. 각 섹션 2~4문장.
  ## 쉬운 설명
  중·고등학생도 이해할 수 있게 전문용어를 풀어서 설명. 비유 활용.
  ## 시사하는 바
  이 소식이 AI 업계·실무에 주는 의미와 파급 효과.
  ## 활용 팁
  독자가 당장 써먹을 수 있는 구체적인 활용 방법 1~2개.
- tags: 2~5개. 명사형, 공백 없이(복합어는 /나 · 사용 금지, 붙여쓰기). 예: ["이미지생성", "프롬프트", "도구소개"]
  기존 태그 체계와 맞추기 위해 아래 목록에 있는 것을 우선 사용하되, 없으면 새로 만들어도 됩니다:
  이미지생성, 영상생성, 프롬프트, 도구소개, 오픈소스, 자동화, 튜토리얼, 마케팅/SEO, LLM, MCP, API, 워크플로우, 생산성, 리소스모음, 비교분석, 모델비교, 코딩, 에이전트, 디자인, 인사이트

금지:
- 사실이 아닌 내용을 지어내지 마라. 요약에 없는 세부 수치·일정·인용은 "원문 확인 필요" 수준으로만 언급하거나 쓰지 마라.
- 과장된 마케팅 표현 금지.
"""


def build_user_prompt(item):
    parts = [
        f"제목: {item.get('title', '')}",
        f"요약: {item.get('summary', '')}",
        f"작성자: {item.get('author', '')}",
        f"카테고리: {item.get('category', '')}",
        f"출처: {item.get('source', '')}",
        f"링크: {item.get('url', '')}",
    ]
    return "\n".join(parts)


def call_deepseek(api_key, item):
    body = json.dumps({
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(item)},
        ],
        "temperature": 0.7,
        "max_tokens": 1500,
    }).encode("utf-8")
    last_err = None
    for attempt in range(RETRY + 1):
        try:
            req = urllib.request.Request(
                DEEPSEEK_URL,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"].strip()
            # 코드펜스 제거
            if content.startswith("```"):
                content = content.split("\n", 1)[1] if "\n" in content else content[3:]
                if content.rstrip().endswith("```"):
                    content = content.rstrip()[:-3]
            result = json.loads(content)
            return validate_result(result)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2)
    raise RuntimeError(f"DeepSeek 호출 실패 ({item.get('id')}): {last_err}")


def validate_result(result):
    insight = str(result.get("insight", "")).strip()[:500]
    detail = str(result.get("detail", "")).strip()[:4000]
    tags = result.get("tags", [])
    if not isinstance(tags, list):
        tags = []
    tags = [str(t).strip().replace(" ", "") for t in tags if str(t).strip()]
    tags = tags[:5]
    if not insight or not detail:
        raise ValueError("insight/detail 누락")
    # detail에 3개 섹션이 있는지 확인
    for section in ("쉬운 설명", "시사하는 바", "활용 팁"):
        if section not in detail:
            raise ValueError(f"detail에 '{section}' 섹션 누락")
    if len(tags) < 2:
        raise ValueError("tags 2개 미만")
    return {"insight": insight, "detail": detail, "tags": tags}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", default=os.path.expanduser("~/workspace/projects/x-trend-b"))
    parser.add_argument("--limit", type=int, default=0, help="0이면 전체")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        print("DEEPSEEK_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return 1

    data_dir = os.path.join(args.project_dir, "data")
    daily_path = os.path.join(data_dir, "daily.json")
    archive_path = os.path.join(data_dir, "archive.json")

    with open(daily_path, encoding="utf-8") as f:
        daily = json.load(f)
    items = daily.get("items", [])

    targets = [it for it in items if not (isinstance(it.get("detail"), str) and it["detail"].strip())]
    if args.limit > 0:
        targets = targets[:args.limit]
    print(f"전체 {len(items)}건 중 상세 분석 필요: {len(targets)}건")

    enriched = 0
    failed = []
    for i, item in enumerate(targets):
        try:
            result = call_deepseek(api_key, item)
            if not args.dry_run:
                item["insight"] = result["insight"]
                item["detail"] = result["detail"]
                item["tags"] = result["tags"]
            enriched += 1
            print(f"[{i+1}/{len(targets)}] OK: {item.get('title','')[:40]}")
        except Exception as e:  # noqa: BLE001
            failed.append(item.get("id"))
            print(f"[{i+1}/{len(targets)}] FAIL: {item.get('id')} - {e}", file=sys.stderr)
        time.sleep(PAUSE_SEC)

    if args.dry_run:
        print(f"dry-run: {enriched}건 생성 성공, {len(failed)}건 실패")
        return 0 if not failed else 2

    # daily.json 저장
    with open(daily_path, "w", encoding="utf-8") as f:
        json.dump(daily, f, ensure_ascii=False, indent=2)
    print(f"daily.json 저장: {enriched}건 상세 분석 추가")

    # archive.json에 신규 항목 병합
    if os.path.exists(archive_path):
        with open(archive_path, encoding="utf-8") as f:
            archive = json.load(f)
    else:
        archive = {"updated": "", "items": []}
    existing_ids = {it.get("id") for it in archive.get("items", [])}
    today = daily.get("date", "")
    added = 0
    for item in items:
        if item.get("id") and item["id"] not in existing_ids:
            archived = dict(item)
            archived["archivedAt"] = today
            # media가 없으면 빈 배열로 명시
            archived.setdefault("media", [])
            archive.setdefault("items", []).append(archived)
            existing_ids.add(item["id"])
            added += 1
    from datetime import datetime, timezone, timedelta
    kst = timezone(timedelta(hours=9))
    archive["updated"] = datetime.now(kst).isoformat()
    with open(archive_path, "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=2)
    print(f"archive.json 병합: {added}건 추가 (전체 {len(archive.get('items', []))}건)")

    if failed:
        print(f"실패 {len(failed)}건: {failed}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
