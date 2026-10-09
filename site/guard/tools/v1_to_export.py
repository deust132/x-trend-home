"""v1(data/*.json) → 사이트 내보내기 형식(data/site) 변환기(시험·예시용 초안 2). 표준 라이브러리만 쓴다.

사용: python3 v1_to_export.py <v1 data 폴더> <출력 data/site 폴더>
- 기사는 원본 site_article 필드 + official_link·media(빈 배열). 출처 칸(id·url·author·likes·source)은 옮기지 않는다.
- 대상 자체가 GitHub 저장소·Hugging Face 페이지인 글만 그 주소를 공식 링크 후보로 옮긴다.
- 문장 재작성·언급 대상 추출·공식성 판정·approved_on(승인 기록 없음)은 하지 않는다(편집 단계 몫).
- 오늘 호 하나만 만들고 색인에도 그 호만 넣는다.
"""
import json
import re
import sys
from pathlib import Path

VISUAL = {'AI 미디어 생성', '디자인·크리에이티브'}
VISUAL_TAGS = {'이미지생성', '영상생성', '디자인'}
SECTION = {'쉬운 설명': 'what', '시사하는 바': 'why', '활용 팁': 'try'}


def desk(it):
    if it.get('category') in VISUAL or (it.get('category') in ('기타', 'Jev') and set(it.get('tags') or []) & VISUAL_TAGS):
        return '이미지·영상·디자인'
    return '에이전트·자동화'


def slug(date, n, title, used):
    words = re.findall(r'[a-z0-9]+', title.lower())[:5]
    s = '-'.join([date.replace('-', '')[2:], f'{n:02d}'] + words)[:80].strip('-')
    while s in used:
        s += '-x'
    used.add(s)
    return s


def body(it):
    out = {'what': '', 'how': '', 'why': '', 'try': ''}
    for head, text in re.findall(r'^## (.+?)\n(.*?)(?=^## |\Z)', it.get('detail') or '', re.M | re.S):
        key = SECTION.get(head.strip())
        if key:
            out[key] = text.strip()
    if not out['what']:
        out['what'] = (it.get('summary') or '').strip()  # 상세가 없는 글: dek와 같아져 검사기가 잡는다
    return out


def official(url):
    if re.match(r'^https://github\.com/[^/?#]+/[^/?#]+/?$', url or ''):
        return {'url': url.rstrip('/'), 'label': 'GitHub 저장소'}
    if re.match(r'^https://huggingface\.co/[^/?#]+/[^/?#]+/?$', url or ''):
        return {'url': url.rstrip('/'), 'label': 'Hugging Face 페이지'}
    return None


def main(src, dst):
    src, dst = Path(src), Path(dst)
    load = lambda n: json.loads((src / n).read_text(encoding='utf-8'))
    daily, archive, insights = load('daily.json'), load('archive.json'), load('insights.json')
    date = daily['date']
    stamp = daily['updatedAt'].replace('+00:00', 'Z')
    dates = sorted({i['archivedAt'][:10] for i in archive['items'] if i.get('archivedAt')} | {date})
    no = dates.index(date) + 1
    used = set()
    arts = []
    for n, it in enumerate(daily['items'], 1):
        arts.append({'slug': slug(date, n, it['title'], used), 'issue_date': date, 'issue_no': no, 'desk': desk(it),
                     'subtopic': it.get('category') or '기타', 'kicker': it.get('category') or '기타',
                     'title': it['title'].strip(), 'dek': (it.get('summary') or '').strip()[:160], 'body': body(it),
                     'glossary': [], 'mentioned_entities': [], 'corrections': [],
                     'official_link': official(it.get('url')), 'media': []})
    lead = next((a for a in arts if a['body']['why']), arts[0])
    lines = []
    for p in insights['daily']['points'][:3]:
        head, _, rest = p.partition(' — ')
        lines.append({'head': head.strip()[:40], 'body': rest.strip()[:240]})
    issue = {'schema': 'ai-magazine.site-issue.v1', 'issue_date': date, 'issue_no': no, 'status': 'published', 'quiet_note': None,
             'updated_at': stamp, 'cover': None, 'three_lines': lines, 'lead': lead['slug'], 'articles': arts}
    index = {'schema': 'ai-magazine.site-index.v1', 'updated_at': stamp, 'latest': date,
             'issues': [{'issue_date': date, 'issue_no': no, 'status': 'published', 'count': len(arts),
                         'slugs': [a['slug'] for a in arts], 'lead_title': lead['title'][:120], 'cover': None}]}
    # 확정 문구(2026-10-09). '@운영자'는 사이트가 핸들(없으면 닉네임)로 바꿔 보여 준다.
    # 핸들 후보 @labjang_ai는 계정 생성 전이라 미확정 — 비워 두고 링크를 걸지 않는다.
    site = {'schema': 'ai-magazine.site-config.v1', 'updated_at': stamp,
            'masthead': {'name': '줍줍 데일리', 'tagline': None},
            'operator': {'nickname': '랩장', 'handle': None, 'bio': None, 'links': []},
            'bot': {'name': '줍줍봇', 'label': '이 매체의 소식 수집과 초안 작성은 자동 계정 줍줍봇이 돕습니다. 게시 전 검증을 거치며, 편집자 @운영자가 운영합니다.', 'link': None},
            'notices': {'ai_image': 'AI로 만든 이미지입니다.', 'verification': None, 'newsletter': None},
            'pages': {'about': None,
                      'policy': '줍줍 데일리는 편집자 @운영자가 운영합니다. 자동 계정 줍줍봇이 소식을 모으고 초안을 씁니다. 실린 사실은 1차 자료로 확인한 것만 싣고, 원문은 옮기지 않고 우리 말로 다시 씁니다. 모든 글은 게시 전 검증을 거치며, 틀린 내용은 정정 기록에 남깁니다.',
                      'corrections_format': '정정(YYYY-MM-DD): ○○를 ○○로 바로잡습니다. 처음 글은 ○○라고 적었습니다.'}}
    (dst / 'issues').mkdir(parents=True, exist_ok=True)
    dump = lambda o, p: p.write_text(json.dumps(o, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    dump(site, dst / 'site.json')
    dump(index, dst / 'index.json')
    dump(issue, dst / 'issues' / f'{date}.json')
    print(json.dumps({'issue_date': date, 'issue_no': no, 'articles': len(arts),
                      'official_links': sum(1 for a in arts if a['official_link'])}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
