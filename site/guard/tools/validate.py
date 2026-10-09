"""사이트 내보내기 형식 빌드 거부 검사기(초안 2). 표준 라이브러리만 쓴다.

사용: python3 validate.py <data/site 폴더> [--previous <직전 공개 data/site>] [--assets <빌드 루트>] [--schema013 <원본 package.schema.json>]
폴더 구성: site.json, index.json, issues/YYYY-MM-DD.json, weekly/YYYY-Www.json(선택).
종료 코드: 0 통과(경고만 있을 수 있음), 1 빌드 거부, 2 사용법 오류.
규칙 번호는 README.md '빌드 거부 규칙' 1~8과 같다.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qsl

HERE = Path(__file__).resolve().parent
SCHEMA_DIR = HERE.parent / 'schema'
DEFAULT_013 = Path(os.environ['SCHEMA013_PATH']) if os.environ.get('SCHEMA013_PATH') else None  # 원본 package.schema.json(있을 때만 비교)
DESK_ID = {'에이전트·자동화': 'agents', '이미지·영상·디자인': 'visual'}

# ── 1. 스키마 엔진 (이 계약이 쓰는 키워드만) ─────────────────────────────

def _type_ok(v, t):
    if isinstance(t, list):
        return any(_type_ok(v, x) for x in t)
    return {'null': v is None, 'object': isinstance(v, dict), 'array': isinstance(v, list),
            'string': isinstance(v, str), 'boolean': isinstance(v, bool),
            'integer': isinstance(v, int) and not isinstance(v, bool),
            'number': isinstance(v, (int, float)) and not isinstance(v, bool)}[t]


def _format_ok(v, fmt):
    if not isinstance(v, str):
        return True
    try:
        if fmt == 'date':
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
                return False
            dt.date.fromisoformat(v)
        elif fmt == 'date-time':
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})', v):
                return False
            dt.datetime.fromisoformat(v.replace('Z', '+00:00'))
            tz = re.search(r'([+-])(\d{2}):(\d{2})$', v)
            if tz and (int(tz.group(2)) > 23 or int(tz.group(3)) > 59):  # fromisoformat는 +09:99를 정규화해 받아들인다
                return False
    except ValueError:
        return False
    return True


def schema_check(v, s, path, root, out):
    """s를 v에 적용해 out에 (path, message)를 쌓는다. 키워드는 서로 독립으로 모두 평가한다."""
    if not isinstance(s, dict):
        return out
    if '$ref' in s:
        name = s['$ref'].rsplit('/', 1)[-1]
        schema_check(v, root['$defs'][name], path, root, out)
    if 'anyOf' in s and not any(not schema_check(v, a, path, root, []) for a in s['anyOf']):
        out.append((path, '허용된 형태 어느 것과도 맞지 않음'))
    for sub in s.get('allOf', []):
        schema_check(v, sub, path, root, out)
    if 'if' in s:
        branch = s.get('then') if not schema_check(v, s['if'], path, root, []) else s.get('else')
        if branch:
            schema_check(v, branch, path, root, out)
    if 'type' in s and not _type_ok(v, s['type']):
        out.append((path, f'{s["type"]} 형식이어야 함'))
        return out
    if 'const' in s and v != s['const']:
        out.append((path, f'{s["const"]!r} 이어야 함'))
    if 'enum' in s and v not in s['enum']:
        out.append((path, f'{" | ".join(map(str, s["enum"]))} 중 하나여야 함'))
    if 'format' in s and not _format_ok(v, s['format']):
        out.append((path, f'{s["format"]} 형식이 아님'))
    if isinstance(v, str):
        if len(v) < s.get('minLength', 0):
            out.append((path, f'{s["minLength"]}자 이상'))
        if 'maxLength' in s and len(v) > s['maxLength']:
            out.append((path, f'{s["maxLength"]}자 이하(지금 {len(v)}자)'))
        if 'pattern' in s and not re.search(s['pattern'], v):
            out.append((path, '정해진 형식 위반'))
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if 'minimum' in s and v < s['minimum']:
            out.append((path, f'{s["minimum"]} 이상'))
        if 'maximum' in s and v > s['maximum']:
            out.append((path, f'{s["maximum"]} 이하'))
    if isinstance(v, dict):
        for r in s.get('required', []):
            if r not in v:
                out.append((path, f'{r} 빠짐'))
        props = s.get('properties', {})
        for k, sub in props.items():
            if k in v:
                schema_check(v[k], sub, f'{path}.{k}', root, out)
        if s.get('additionalProperties') is False:
            for k in v:
                if k not in props:
                    out.append((path, f'계약에 없는 칸 {k}'))
    if isinstance(v, list):
        if len(v) < s.get('minItems', 0):
            out.append((path, f'{s["minItems"]}개 이상'))
        if 'maxItems' in s and len(v) > s['maxItems']:
            out.append((path, f'{s["maxItems"]}개 이하'))
        if 'items' in s:
            for i, x in enumerate(v):
                schema_check(x, s['items'], f'{path}[{i}]', root, out)
    return out


def load_schema(name):
    return json.loads((SCHEMA_DIR / f'{name}.schema.json').read_text(encoding='utf-8'))


# ── 2·3. 공개 문자열의 출처 흔적·내부 운영 문구 ──────────────────────────

SOCIAL = ('x.com', 'twitter.com', 't.co', 'threads.net', 'threads.com', 'instagram.com', 'facebook.com', 'fb.com',
          'bsky.app', 'reddit.com', 'redd.it', 'news.ycombinator.com', 'tiktok.com', 'linkedin.com', 'youtu.be', 'mastodon.social')
SOCIAL_RX = '|'.join(re.escape(d) for d in SOCIAL)
SRC_NAMES = r'X|트위터|Threads|스레드|HN|해커\s?뉴스|Hacker\s?News|레딧|Reddit|인스타그램|Instagram|틱톡|TikTok'
SRC_WORDS = r'게시물|게시글|글|답글|타래|화제|반응|1위|최대|트렌드|포스트|피드|타임라인|인기|바이럴'
TRACE = [
    ('URL', re.compile(r'https?://|\bwww\.[a-z0-9-]+\.', re.I)),
    ('SNS 주소', re.compile(rf'(?<![A-Za-z0-9.-])({SOCIAL_RX})(?![A-Za-z0-9-])', re.I)),
    ('이메일 주소', re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}')),
    ('@계정', re.compile(r'(?:^|[\s(\[{"\'“‘「『<,·:/])@(?!v?\d)[A-Za-z_][A-Za-z0-9_]{0,30}')),
    # 숫자는 반드시 숫자로 시작해야 한다('조회, 알림'의 쉼표를 수로 읽지 않게).
    ('원문 반응 수', re.compile(r'좋아요\s*\d[\d,.]*|\d[\d,.]*\s*(만\s*)?(개의\s*|개\s*)?좋아요|리트윗|리포스트|조회\s*수?\s*\d[\d,.]*|북마크\s*\d[\d,.]*'
                            r'|\b(likes?|retweets?|reposts?|views)\s*\d[\d,.]*|\d[\d,.]*\s*(likes?|retweets?|reposts?|views)\b', re.I)),
    ('원천 근거 표현', re.compile(rf'(?<![A-Za-z가-힣])({SRC_NAMES})\s*(에서|에|의|상)?\s*({SRC_WORDS})|(?<![A-Za-z가-힣])(X|Threads|스레드|레딧|Reddit)에서'
                              r'|(게시물|원\s*게시물|트윗|타래)\s*(의|에|에서)?\s*답글|답글에\s*(풀어|공유|정리|있|달)|트윗', re.I)),
    ('출처 표현', re.compile(r'(?<![가-힣])(출처|원문)')),
]
INTERNAL = [
    ('운영 식별자', re.compile(r'brand-scout|muse-board|opencodex|x-trend|claude-obsidian|project-wiki|data/[\w-]+\.json', re.I)),
    ('내부 운영 용어', re.compile(r'(검증|주장|내부)\s*장부|승인\s*카드|후보\s*큐|게시\s*관문')),
    ('운영자 1인칭 맥락', re.compile(r'사용자의\s*(Hermes|Gmail|워크|작업|환경|프로젝트|Mac|맥|볼트|Vault|위키|Wiki|자동화|에이전트|서버|계정|Oracle)'
                               r'|사용자\s*(환경|세팅|워크플로|볼트)|(?<![가-힣])(내|우리)\s*(워크플로|Hermes|에이전트\s*팀|볼트|Vault|서버|Oracle|맥북)')),
]
# 문자열 검사에서 빼는 칸(기계 값) — 마지막 칸 이름 기준
MACHINE_KEYS = {'schema', 'slug', 'slugs', 'lead', 'issue_date', 'latest', 'corrected_at', 'updated_at', 'published_at',
                'approved_on', 'status', 'desk', 'kind', 'format', 'week', 'src', 'poster', 'cover', 'handle'}
# 주소 칸(규칙 4·허용 주소) — 경로 정규식
URL_PATHS = re.compile(r'(\.official_link\.url|\.operator\.links\[\d+\]\.url|\.bot\.link)$')
# 사람이 확정한 사이트 안내 문구(편집 방침 등)는 '원문·출처'를 설명하는 낱말을 쓸 수 있다 — 그 한 규칙만 뺀다.
EDITORIAL_PATHS = re.compile(r'^site\.(pages\.\w+|bot\.label|notices\.\w+)$')


def walk_strings(obj, path):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in MACHINE_KEYS:
                continue
            yield from walk_strings(v, f'{path}.{k}')
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_strings(v, f'{path}[{i}]')
    elif isinstance(obj, str):
        yield path, obj


def text_findings(obj, path):
    for p, s in walk_strings(obj, path):
        if URL_PATHS.search(p):
            continue
        for why, rx in TRACE:
            if why == '출처 표현' and EDITORIAL_PATHS.match(p):
                continue
            if rx.search(s):
                yield p, 2, why
        for why, rx in INTERNAL:
            if rx.search(s):
                yield p, 3, why


# ── 4. 공식 링크 ─────────────────────────────────────────────────────

REDIRECT_KEYS = {'url', 'u', 'to', 'target', 'redirect', 'redirect_uri', 'redirect_url', 'link', 'dest', 'destination', 'q', 'next', 'goto'}


def norm_host(host):
    host = (host or '').lower().rstrip('.')
    for pre in ('www.', 'm.', 'mobile.'):
        if host.startswith(pre):
            host = host[len(pre):]
    return host


def is_social(host):
    return any(host == d or host.endswith('.' + d) for d in SOCIAL)


def link_problems(url, social_ok=False):
    # 브라우저는 역슬래시를 슬래시로, 호스트의 %xx를 글자로 읽는다(https://x.com\a → x.com). 이런 주소는 판정 전에 거부한다.
    if '\\' in url or re.search(r'[\x00-\x20\x7f]', url):
        return ['역슬래시·공백·제어문자가 든 주소']
    u = urlparse(url)
    if u.scheme != 'https' or not u.netloc:
        return ['https 주소가 아님']
    if '%' in u.netloc or not re.fullmatch(r'[A-Za-z0-9.-]+(:\d+)?', u.netloc):
        return ['호스트에 인코딩·허용 밖 글자가 있음']
    if u.username or u.password or '@' in u.netloc:
        return ['사용자 정보가 든 주소']
    probs = []
    if not social_ok and is_social(norm_host(u.hostname)):
        probs.append('소셜·토론 주소는 공식 링크가 아님')
    for k, v in parse_qsl(u.query, keep_blank_values=True):
        if k.lower() in REDIRECT_KEYS or re.search(r'https?:|%3a%2f%2f|//', unquote(unquote(v)), re.I):
            probs.append('다른 주소로 넘기는 우회 주소')
            break
    if re.search(r'%3a%2f%2f|https?%3a', url, re.I):
        probs.append('인코딩된 주소가 들어 있음')
    return sorted(set(probs))


# ── 메인 ──────────────────────────────────────────────────────────────

class Report:
    def __init__(self):
        self.errors, self.warnings, self.skipped = [], [], []

    def err(self, file, path, rule, msg):
        self.errors.append({'file': file, 'path': path, 'rule': rule, 'message': msg})

    def warn(self, file, path, msg):
        self.warnings.append({'file': file, 'path': path, 'message': msg})


def read_json(p, rep, rel):
    try:
        doc = json.loads(p.read_text(encoding='utf-8'))
        if not isinstance(doc, dict):
            rep.err(rel, '', 1, 'JSON 최상위가 객체가 아님')
            return None
        return doc
    except FileNotFoundError:
        rep.err(rel, '', 1, '파일 없음')
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        rep.err(rel, '', 1, f'JSON을 읽을 수 없음: {e}')
    return None


def check_schema(doc, name, rel, rep):
    root = load_schema(name)
    errs = schema_check(doc, root, name, root, [])
    for path, msg in errs:
        rep.err(rel, path, 1, msg)
    return not errs


def load_folder(folder, rep, label=''):
    """폴더를 읽어 (site, index, issues{date: doc}, weekly{week: doc}) — 형식 오류 파일은 None/제외."""
    tag = (label + ':') if label else ''
    site = read_json(folder / 'site.json', rep, tag + 'site.json')
    index = read_json(folder / 'index.json', rep, tag + 'index.json')
    issues, weekly, ok = {}, {}, {}
    for p in sorted((folder / 'issues').glob('*.json')) if (folder / 'issues').is_dir() else []:
        doc = read_json(p, rep, tag + f'issues/{p.name}')
        if doc is not None:
            issues[p.stem] = doc
    for p in sorted((folder / 'weekly').glob('*.json')) if (folder / 'weekly').is_dir() else []:
        doc = read_json(p, rep, tag + f'weekly/{p.name}')
        if doc is not None:
            weekly[p.stem] = doc
    return site, index, issues, weekly


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('--previous')
    ap.add_argument('--assets')
    ap.add_argument('--schema013')
    a = ap.parse_args(argv)
    folder = Path(a.folder)
    rep = Report()
    if not folder.is_dir():
        rep.err(str(folder), '', 1, '폴더 없음')
        return finish(rep)

    site, index, issues, weekly = load_folder(folder, rep)
    site_ok = site is not None and check_schema(site, 'site-config', 'site.json', rep)
    index_ok = index is not None and check_schema(index, 'site-index', 'index.json', rep)
    good_issues = {d: doc for d, doc in issues.items() if check_schema(doc, 'site-issue', f'issues/{d}.json', rep)}
    good_weekly = {w: doc for w, doc in weekly.items() if check_schema(doc, 'site-weekly', f'weekly/{w}.json', rep)}

    # 규칙 2·3: 공개 문자열 전부
    if site is not None:
        for p, rule, why in text_findings(site, 'site'):
            rep.err('site.json', p, rule, why)
    if site_ok:
        for i, l in enumerate((site.get('operator') or {}).get('links') or []):
            for prob in link_problems(l.get('url', ''), social_ok=True):
                rep.err('site.json', f'site.operator.links[{i}].url', 4, prob)
        if (site.get('bot') or {}).get('link'):
            for prob in link_problems(site['bot']['link'], social_ok=True):
                rep.err('site.json', 'site.bot.link', 4, prob)
    if index is not None:
        for p, rule, why in text_findings(index, 'index'):
            rep.err('index.json', p, rule, why)
    for d, doc in issues.items():
        for p, rule, why in text_findings(doc, 'issue'):
            rep.err(f'issues/{d}.json', p, rule, why)
    for w, doc in weekly.items():
        for p, rule, why in text_findings(doc, 'weekly'):
            rep.err(f'weekly/{w}.json', p, rule, why)

    # 규칙 4·5·6: 호 안
    all_slugs = {}
    for d, doc in good_issues.items():
        rel = f'issues/{d}.json'
        if doc['issue_date'] != d:
            rep.err(rel, 'issue.issue_date', 6, f'파일 이름 {d}와 호 날짜 {doc["issue_date"]}가 다름')
        slugs = []
        for i, art in enumerate(doc['articles']):
            ap_ = f'issue.articles[{i}]'
            if art['issue_date'] != doc['issue_date'] or art['issue_no'] != doc['issue_no']:
                rep.err(rel, ap_, 6, '기사의 호 날짜·호수가 호와 다름')
            if not art['subtopic'].strip():
                rep.err(rel, f'{ap_}.subtopic', 6, '하위 주제가 비어 있음')
            if art['dek'].strip() and art['dek'].strip() == art['body']['what'].strip():
                rep.err(rel, ap_, 6, 'dek와 body.what이 같음')
            for key in ('what', 'how', 'why', 'try'):
                if not art['body'][key].strip():
                    rep.warn(rel, f'{ap_}.body.{key}', '본문 단이 비어 있음(화면에서 생략)')
            link = art.get('official_link')
            if link:
                for prob in link_problems(link['url']):
                    rep.err(rel, f'{ap_}.official_link.url', 4, prob)
            for j, m in enumerate(art.get('media') or []):
                if m.get('made_with_ai') and site_ok and not site['notices']['ai_image']:
                    rep.warn(rel, f'{ap_}.media[{j}]', 'AI 이미지 표시 문구 미정(site.notices.ai_image) — 임시 문구로 표시')
                for key in ('src', 'poster'):
                    check_asset(m.get(key), rel, f'{ap_}.media[{j}].{key}', a.assets, rep)
            if site_ok and site.get('subtopic_order'):
                listed = {n for g in site['subtopic_order'] if g['desk'] == art['desk'] for n in g['names']}
                if art['subtopic'] not in listed:
                    rep.warn(rel, f'{ap_}.subtopic', f'subtopic_order에 없는 하위 주제 {art["subtopic"]}')
            slugs.append(art['slug'])
            if art['slug'] in all_slugs:
                rep.err(rel, f'{ap_}.slug', 6, f'slug 중복({all_slugs[art["slug"]]} 호와 겹침)')
            else:
                all_slugs[art['slug']] = d
        check_asset(doc.get('cover'), rel, 'issue.cover', a.assets, rep)
        own = set(slugs)
        if doc.get('lead') and doc['lead'] not in own:
            rep.err(rel, 'issue.lead', 6, '대표 글이 이 호에 없음')
        for i, line in enumerate(doc.get('three_lines') or []):
            if line.get('slug') and line['slug'] not in own:
                rep.err(rel, f'issue.three_lines[{i}].slug', 6, '세 줄이 가리키는 글이 이 호에 없음')

    # 규칙 6: 색인 ↔ 호 파일
    if index_ok:
        seen_dates, seen_nos = set(), set()
        for i, e in enumerate(index['issues']):
            p = f'index.issues[{i}]'
            if e['issue_date'] in seen_dates:
                rep.err('index.json', p, 6, '색인에 같은 날짜가 두 번')
            if e['issue_no'] in seen_nos:
                rep.err('index.json', p, 6, '색인에 같은 호수가 두 번')
            seen_dates.add(e['issue_date']); seen_nos.add(e['issue_no'])
            check_asset(e.get('cover'), 'index.json', f'{p}.cover', a.assets, rep)
            doc = good_issues.get(e['issue_date'])
            if e['issue_date'] not in issues:
                rep.err('index.json', p, 6, f'색인에 있는데 호 파일이 없음({e["issue_date"]})')
            elif doc:
                if e['issue_no'] != doc['issue_no'] or e['status'] != doc['status']:
                    rep.err('index.json', p, 6, '색인의 호수·상태가 호 파일과 다름')
                actual = [x['slug'] for x in doc['articles']]
                if e['count'] != len(actual) or list(e['slugs']) != actual:
                    rep.err('index.json', p, 6, '색인의 편수·slug 목록이 호 파일과 다름')
        for d in issues:
            if d not in seen_dates:
                rep.err(f'issues/{d}.json', '', 6, '호 파일이 색인에 없음')
        if index['issues'] and index['latest'] != max(seen_dates):
            rep.err('index.json', 'index.latest', 6, f'latest가 가장 늦은 호({max(seen_dates)})가 아님')
        if not index['issues'] and issues:
            rep.err('index.json', 'index.issues', 6, '호 파일이 있는데 색인이 비어 있음')

    for w, doc in good_weekly.items():
        if doc['week'] != w:
            rep.err(f'weekly/{w}.json', 'weekly.week', 6, '파일 이름과 주 표기가 다름')
        check_asset(doc.get('cover'), f'weekly/{w}.json', 'weekly.cover', a.assets, rep)
        for i, pick in enumerate(doc['picks']):
            if pick['slug'] not in all_slugs:
                rep.err(f'weekly/{w}.json', f'weekly.picks[{i}].slug', 6, '주간 호가 고른 글이 어느 호에도 없음')

    # 규칙 7: 직전 공개본과 비교
    if a.previous:
        prev_rep = Report()
        prev_dir = Path(a.previous)
        _, prev_index, prev_issues, _ = load_folder(prev_dir, prev_rep, 'previous') if prev_dir.is_dir() else (None, None, {}, {})
        if not prev_dir.is_dir():
            rep.err('previous', '', 7, f'직전 공개본 폴더 없음({prev_dir}) — 영구성 검사를 할 수 없음')
        for e in prev_rep.errors:
            if not e['file'].endswith('site.json'):
                rep.err(e['file'], e['path'], 7, f'직전 공개본을 읽을 수 없음: {e["message"]} — 영구성 검사를 할 수 없음')
        bad_prev = [d for d, doc in prev_issues.items() if not isinstance(doc, dict) or not isinstance(doc.get('articles'), list)]
        for d in bad_prev:
            rep.err(f'previous:issues/{d}.json', '', 7, '직전 공개본 호 파일 구조가 깨짐 — 영구성 검사를 할 수 없음')
        prev_issues = {d: doc for d, doc in prev_issues.items() if d not in bad_prev}
        # 직전 색인이 정본: 색인이 없거나 깨졌거나, 색인이 가리키는 호 파일이 없으면 비교할 수 없으므로 거부한다.
        prev_listed = {}
        if prev_dir.is_dir():
            if not isinstance(prev_index, dict) or schema_check(prev_index, load_schema('site-index'), 'index', load_schema('site-index'), []):
                rep.err('previous:index.json', '', 7, '직전 공개본 색인이 없거나 형식이 틀림 — 영구성 검사를 할 수 없음')
            else:
                for e in prev_index['issues']:
                    prev_listed[e['issue_date']] = e
                    if e['issue_date'] not in prev_issues:
                        rep.err(f'previous:issues/{e["issue_date"]}.json', '', 7, '직전 색인에 있는 호 파일이 없음 — 영구성 검사를 할 수 없음')
                    for s in e['slugs']:  # 색인에 올라간 글도 공개된 글로 본다
                        if s not in all_slugs:
                            rep.err(f'issues/{e["issue_date"]}.json', '', 7, f'공개됐던 글 {s}이 사라짐')
                        elif all_slugs[s] != e['issue_date']:
                            rep.err(f'issues/{all_slugs[s]}.json', '', 7, f'공개됐던 글 {s}의 날짜가 {e["issue_date"]} → {all_slugs[s]}로 바뀜')
        for d, doc in prev_issues.items():
            now = issues.get(d)
            if now is None:
                rep.err(f'issues/{d}.json', '', 7, '직전 공개본에 있던 호가 사라짐')
                continue
            if isinstance(now, dict) and now.get('issue_no') != doc.get('issue_no'):
                rep.err(f'issues/{d}.json', 'issue.issue_no', 7, f'호수가 바뀜({doc.get("issue_no")} → {now.get("issue_no")})')
            for art in doc.get('articles') or []:
                s = art.get('slug')
                if s not in all_slugs:
                    rep.err(f'issues/{d}.json', '', 7, f'공개됐던 글 {s}이 사라짐')
                elif all_slugs[s] != d:
                    rep.err(f'issues/{all_slugs[s]}.json', '', 7, f'공개됐던 글 {s}의 날짜가 {d} → {all_slugs[s]}로 바뀜')
    else:
        rep.skipped.append('규칙 7(영구성): --previous 없음 — 실행 안 함')
    if not a.assets:
        rep.skipped.append('규칙 5 일부(미디어 파일 존재): --assets 없음 — 실행 안 함')

    # 규칙 8: 경고
    if site_ok:
        def nulls(o, path):
            if o is None:
                yield path
            elif isinstance(o, dict):
                for k, v in o.items():
                    yield from nulls(v, f'{path}.{k}')
        for path in nulls(site, 'site'):
            rep.warn('site.json', path, '미정 — 사이트 기본값 또는 임시 자리로 표시')
    target013 = Path(a.schema013) if a.schema013 else DEFAULT_013
    if target013:
        check_013_drift(target013, rep)
    else:
        rep.skipped.append('원본 스키마 비교: --schema013·SCHEMA013_PATH 없음 — 실행 안 함')
    return finish(rep)


def check_asset(value, rel, path, assets, rep):
    if not value:
        return
    if '..' in value or '//' in value or '/./' in value:
        rep.err(rel, path, 5, '경로에 .. · // · /./ 가 있음')
    if assets and not (Path(assets) / value.lstrip('/')).is_file():
        rep.err(rel, path, 5, f'파일 없음({value})')


def check_013_drift(path, rep):
    pinned = json.loads((SCHEMA_DIR / '013-site-article.pinned.json').read_text(encoding='utf-8'))
    try:
        pkg = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        rep.skipped.append(f'원본 스키마 비교: {path} 읽기 불가 — 실행 안 함')
        return

    def find(o, k):
        if isinstance(o, dict):
            for a, b in o.items():
                if a == k:
                    return b
                r = find(b, k)
                if r is not None:
                    return r
        elif isinstance(o, list):
            for x in o:
                r = find(x, k)
                if r is not None:
                    return r
        return None
    sa = find(pkg, 'site_article') or {}
    obj = next((x for x in sa.get('anyOf', []) if isinstance(x, dict) and x.get('type') == 'object'), None)
    if obj != pinned['site_article']:
        rep.warn('schema/013-site-article.pinned.json', '', '원본 site_article이 고정 사본과 다름 — 계약 갱신 필요')


def finish(rep):
    out = {'ok': not rep.errors, 'errors': len(rep.errors), 'warnings': len(rep.warnings),
           'error_list': rep.errors[:500], 'warning_list': rep.warnings[:200], 'checks_skipped': rep.skipped}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0 if not rep.errors else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # 검사기 자체 결함도 빌드 거부로 보고한다
        print(json.dumps({'ok': False, 'errors': 1, 'error_list': [{'file': '', 'path': '', 'rule': 0, 'message': f'검사기 내부 오류: {e!r}'}]}, ensure_ascii=False))
        sys.exit(1)
