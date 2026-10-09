"""validate.py 시험(초안 2). 실행: python3 -m unittest test_validate -v  (임시 폴더만 쓴다)
거부 사례는 규칙 번호와 위치(파일·경로 일부)까지 확인해 엉뚱한 이유의 거부를 통과로 세지 않는다."""
import copy
import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import validate

T = '2026-10-09T07:41:00+09:00'
D = '2026-10-09'


def article(slug='claude-dashboards-motion', **kw):
    a = {'slug': slug, 'issue_date': D, 'issue_no': 5, 'desk': '에이전트·자동화', 'subtopic': '도구 출시',
         'kicker': '도구 출시', 'title': 'Claude가 대시보드와 설명 영상을 만든다',
         'dek': '데이터를 붙여 넣으면 대시보드가, 아이디어를 말하면 짧은 설명 영상이 나온다.',
         'body': {'what': 'Anthropic이 Claude에 두 가지 베타 기능을 더했다.', 'how': '대화 안에서 화면을 바로 그린다.',
                  'why': '보고서와 교육 영상 초안을 대화만으로 뽑는다.', 'try': '1) 정기 보고 숫자를 붙여 넣는다\n2) 수치만 검수한다'},
         'glossary': [{'term': '대시보드', 'definition': '여러 지표를 한 화면에 모은 보기'}],
         'mentioned_entities': ['Anthropic', 'Claude'], 'corrections': [],
         'official_link': {'url': 'https://www.anthropic.com/news', 'label': 'Anthropic 발표'}, 'media': [], 'approved_on': D}
    a.update(kw)
    return a


def base():
    arts = [article(), article('gemini-business-agent', title='구글, 상시 동작 업무 에이전트 공개', dek='도구와 데이터를 미리 아는 클라우드 에이전트다.')]
    issue = {'schema': 'ai-magazine.site-issue.v1', 'issue_date': D, 'issue_no': 5, 'status': 'published', 'quiet_note': None,
             'updated_at': T, 'cover': None, 'three_lines': [{'head': '대화가 화면을 만든다', 'body': '대시보드와 영상이 대화 안으로 들어왔다.', 'slug': arts[0]['slug']}],
             'lead': arts[0]['slug'], 'articles': arts}
    index = {'schema': 'ai-magazine.site-index.v1', 'updated_at': T, 'latest': D,
             'issues': [{'issue_date': D, 'issue_no': 5, 'status': 'published', 'count': 2, 'slugs': [a['slug'] for a in arts], 'lead_title': arts[0]['title'], 'cover': None}]}
    site = {'schema': 'ai-magazine.site-config.v1', 'updated_at': T, 'masthead': {'name': '줍줍 데일리', 'tagline': '매일 아침 AI 실무 소식'},
            'operator': {'nickname': '운영자', 'handle': '@operator', 'bio': None, 'links': [{'label': 'X', 'url': 'https://x.com/operator'}]},
            'bot': {'name': '줍줍봇', 'label': '수집·초안 보조 자동 계정', 'link': 'https://x.com/jupjupbot'},
            'notices': {'ai_image': 'AI로 만든 이미지입니다.', 'verification': None, 'newsletter': None},
            'pages': {'about': '소개', 'policy': '편집 방침', 'corrections_format': None}}
    return {'site': site, 'index': index, 'issues': {D: issue}, 'weekly': {}}


def write(root, data):
    root.mkdir(parents=True, exist_ok=True)
    (root / 'issues').mkdir(exist_ok=True)
    for name in ('site', 'index'):
        if data.get(name) is not None:
            (root / f'{name}.json').write_text(data[name] if isinstance(data[name], str) else json.dumps(data[name], ensure_ascii=False))
    for d, doc in data['issues'].items():
        (root / 'issues' / f'{d}.json').write_text(doc if isinstance(doc, str) else json.dumps(doc, ensure_ascii=False))
    if data['weekly']:
        (root / 'weekly').mkdir(exist_ok=True)
        for w, doc in data['weekly'].items():
            (root / 'weekly' / f'{w}.json').write_text(json.dumps(doc, ensure_ascii=False))


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_v(self, data, *extra, prev=None):
        run = Path(tempfile.mkdtemp(dir=self.tmp))  # 호출마다 새 폴더
        write(run / 'site', data)
        args = [str(run / 'site'), '--schema013', str(run / 'missing-013.json')]
        if prev is not None:
            write(run / 'prev', prev)
            args += ['--previous', str(run / 'prev')]
        args += list(extra)
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = validate.main(args)
        return rc, json.loads(buf.getvalue())

    def assertRejected(self, data, rule, where, **kw):
        rc, out = self.run_v(data, **kw)
        self.assertEqual(rc, 1, out)
        hits = [e for e in out['error_list'] if e['rule'] == rule and where in (e['file'] + ' ' + e['path'] + ' ' + e['message'])]
        self.assertTrue(hits, f'규칙 {rule} / {where!r} 오류가 없음: {out["error_list"]}')
        return out

    def assertPasses(self, data, **kw):
        rc, out = self.run_v(data, **kw)
        self.assertEqual(rc, 0, out['error_list'])
        return out


def mut(fn):
    d = base()
    fn(d, d['issues'][D], d['issues'][D]['articles'][0])
    return d


class Clean(Base):
    def test_clean_passes(self):
        out = self.assertPasses(base())
        self.assertIn('규칙 7(영구성): --previous 없음 — 실행 안 함', out['checks_skipped'])

    def test_quiet_day_passes(self):
        d = base()
        d['issues'][D] = {'schema': 'ai-magazine.site-issue.v1', 'issue_date': D, 'issue_no': 5, 'status': 'quiet',
                          'quiet_note': '오늘은 실무에 바로 쓸 만한 변화가 없었습니다.', 'updated_at': T, 'three_lines': [], 'lead': None, 'articles': []}
        d['index']['issues'][0].update(status='quiet', count=0, slugs=[], lead_title=None)
        self.assertPasses(d)

    def test_allowed_sentences(self):
        texts = ['신규 사용자의 진입 장벽을 낮춘다', '지원문서에 설치 절차가 있다', '매출처가 넓어졌다', '에이전트의 심장부는 계획기다',
                 '태그는 @v1 형식이다', '이미지 @2x 해상도', '리포트 생성, 데이터 조회, 알림 등', '좋아요, 싫어요 버튼을 없앴다', 'Gmail 정리 자동화를 Hermes 에이전트로 만든다', 'Muse 앱의 새 기능']
        for t in texts:
            with self.subTest(t=t):
                self.assertPasses(mut(lambda d, i, a: a['body'].update(how=t)))
        self.assertPasses(mut(lambda d, i, a: a.update(title='Hermes로 비디오 시리즈 만들기')))

    def test_status_page_official_link_allowed(self):
        self.assertPasses(mut(lambda d, i, a: a.update(official_link={'url': 'https://www.cloudflare.com/status/', 'label': '상태 페이지'})))

    def test_operator_social_profile_allowed(self):
        self.assertPasses(base())  # base의 operator.links·bot.link는 x.com 프로필


class Rule1Schema(Base):
    def test_missing_field(self):
        self.assertRejected(mut(lambda d, i, a: a.pop('dek')), 1, 'dek 빠짐')

    def test_bad_desk(self):
        self.assertRejected(mut(lambda d, i, a: a.update(desk='영상')), 1, 'desk')

    def test_source_field_not_in_contract(self):
        self.assertRejected(mut(lambda d, i, a: a.update(url='https://x.com/a/status/1')), 1, '계약에 없는 칸 url')

    def test_invalid_calendar_date(self):
        self.assertRejected(mut(lambda d, i, a: a.update(issue_date='2026-02-30')), 1, 'date 형식')

    def test_broken_json_reported(self):
        d = base(); d['issues'][D] = '{not json'
        self.assertRejected(d, 1, 'JSON을 읽을 수 없음')

    def test_missing_site_file(self):
        d = base(); d['site'] = None
        self.assertRejected(d, 1, '파일 없음')

    def test_quiet_without_note(self):
        d = base()
        d['issues'][D].update(status='quiet', articles=[], three_lines=[], lead=None)
        d['index']['issues'][0].update(status='quiet', count=0, slugs=[])
        self.assertRejected(d, 1, 'quiet_note')


class Rule2Trace(Base):
    cases = {
        'tag_domain': lambda d, i, a: a.update(subtopic='x.com 화제'),
        'caption': lambda d, i, a: a.update(media=[{'src': '/media/2026/10/09/a.webp', 'alt': '그림', 'kind': 'image', 'made_with_ai': False, 'caption': '출처 캡처'}]),
        'url_in_body': lambda d, i, a: a['body'].update(how='자세한 건 https://example.com 참고'),
        'www_in_body': lambda d, i, a: a['body'].update(how='www.example.com 에서 받는다'),
        'handle': lambda d, i, a: a['body'].update(why='(@someone 이 공개했다)'),
        'email': lambda d, i, a: a['body'].update(why='문의 hello@example.com'),
        'likes_ko': lambda d, i, a: a.update(dek='좋아요 15,786을 받은 단편 영상'),
        'likes_en': lambda d, i, a: a['body'].update(why='HF likes 6,937'),
        'source_post': lambda d, i, a: a['body'].update(why='X 게시물에 따르면 출시가 빠르다'),
        'source_threads': lambda d, i, a: a['body'].update(why='Threads에서 퍼진 영상'),
        'hn_rank': lambda d, i, a: a['body'].update(why='HN 1위에 올랐다'),
        'reply_ref': lambda d, i, a: a['body'].update(why='답글에 풀어서 공유한 방법'),
        'source_word': lambda d, i, a: a['body'].__setitem__('try', '원문을 확인한다'),
        'correction_url': lambda d, i, a: a.update(corrections=[{'corrected_at': T, 'text': 'https://x.com/a 참고해 고침'}]),
        'three_lines': lambda d, i, a: i['three_lines'][0].update(body='당일 X 최대 화제였다'),
        'glossary': lambda d, i, a: a.update(glossary=[{'term': '타래', 'definition': '트윗을 이어 쓴 글'}]),
        'entity_handle': lambda d, i, a: a.update(mentioned_entities=['@claudeai']),
    }

    def test_each_trace_rejected(self):
        for name, fn in self.cases.items():
            with self.subTest(case=name):
                self.assertRejected(mut(fn), 2, 'issues/')

    def test_index_lead_title_url(self):
        d = base(); d['index']['issues'][0]['lead_title'] = '자세히는 https://x.com/a'
        self.assertRejected(d, 2, 'index.issues[0].lead_title')

    def test_site_text(self):
        d = base(); d['site']['pages']['about'] = '원문은 @someone 계정에서 가져온다'
        self.assertRejected(d, 2, 'site.pages.about')

    def test_policy_may_mention_wonmun(self):
        d = base(); d['site']['pages']['policy'] = '원문은 옮기지 않고 우리 말로 다시 씁니다. 출처는 내부 기록에만 남깁니다.'
        self.assertPasses(d)

    def test_policy_still_rejects_url(self):
        d = base(); d['site']['pages']['policy'] = '자세한 방침은 https://example.com 참고'
        self.assertRejected(d, 2, 'site.pages.policy')

    def test_article_still_rejects_wonmun(self):
        self.assertRejected(mut(lambda d, i, a: a['body'].update(why='원문은 옮기지 않았다')), 2, 'body.why')

    def test_weekly_text(self):
        d = base(); d['weekly']['2026-W41'] = {'schema': 'ai-magazine.site-weekly.v1', 'week': '2026-W41', 'title': '이번 주 정리',
             'intro': '조회수 120만을 찍은 영상부터', 'published_at': T, 'picks': [{'slug': 'claude-dashboards-motion', 'note': '대화로 화면 만들기'}]}
        self.assertRejected(d, 2, 'weekly.intro')


class Rule3Internal(Base):
    def test_internal(self):
        for text in ['brand-scout가 고른 글', '검증 장부에 남겼다', '승인 카드에서 눌렀다', '사용자의 Hermes 환경에 바로 붙인다', '우리 워크플로에 넣는다', 'data/daily.json 갱신']:
            with self.subTest(text=text):
                self.assertRejected(mut(lambda d, i, a: a['body'].update(how=text)), 3, 'body.how')


class Rule4Link(Base):
    def test_bad_links(self):
        for url in ['https://x.com/claudeai/status/1', 'https://m.x.com/claudeai', 'https://mobile.twitter.com/claudeai',
                    'https://www.instagram.com/share/p/ABC/', 'https://bsky.app/profile/u/post/1', 'https://www.reddit.com/r/a/',
                    'https://example.com/r?to=https%3A%2F%2Fx.com%2Fa', 'https://example.com/go?url=abc', 'https://user@example.com/',
                    'http://example.com/', 'https://news.ycombinator.com/item?id=1']:
            with self.subTest(url=url):
                d = mut(lambda d, i, a: a.update(official_link={'url': url, 'label': '링크'}))
                rc, out = self.run_v(d)
                self.assertEqual(rc, 1)
                self.assertTrue(any(e['rule'] in (1, 4) and 'official_link' in e['path'] for e in out['error_list']), out['error_list'])

    def test_lookalike_host_not_social(self):
        self.assertPasses(mut(lambda d, i, a: a.update(official_link={'url': 'https://notx.com/tool', 'label': '도구'})))


class Rule5Assets(Base):
    def test_bad_paths(self):
        for src in ['/media/x.com/a.webp', '/media/../a.webp', 'https://x.com/a.png', '/media//a.webp', '/other/a.webp']:
            with self.subTest(src=src):
                d = mut(lambda d, i, a: a.update(media=[{'src': src, 'alt': '그림', 'kind': 'image', 'made_with_ai': False}]))
                rc, out = self.run_v(d)
                self.assertEqual(rc, 1)
                self.assertTrue(any(e['rule'] in (1, 5) and 'media[0].src' in e['path'] for e in out['error_list']), out['error_list'])

    def test_external_poster(self):
        d = mut(lambda d, i, a: a.update(media=[{'src': '/media/2026/a.mp4', 'alt': '영상', 'kind': 'video', 'made_with_ai': False, 'poster': 'https://x.com/user/status/1'}]))
        self.assertRejected(d, 1, 'media[0].poster')

    def test_missing_asset_file(self):
        d = mut(lambda d, i, a: a.update(media=[{'src': '/media/2026/a.webp', 'alt': '그림', 'kind': 'image', 'made_with_ai': False}]))
        (self.tmp / 'build').mkdir()
        rc, out = self.run_v(d, '--assets', str(self.tmp / 'build'))
        self.assertEqual(rc, 1)
        self.assertTrue(any(e['rule'] == 5 and '파일 없음' in e['message'] for e in out['error_list']), out)


class Rule6Consistency(Base):
    def test_index_without_file(self):
        d = base(); d['index']['issues'].append({'issue_date': '2026-10-08', 'issue_no': 4, 'status': 'published', 'count': 0, 'slugs': [], 'lead_title': None, 'cover': None})
        self.assertRejected(d, 6, '호 파일이 없음')

    def test_file_without_index(self):
        d = base(); extra = copy.deepcopy(d['issues'][D]); extra.update(issue_date='2026-10-08', issue_no=4)
        for a in extra['articles']:
            a.update(issue_date='2026-10-08', issue_no=4, slug=a['slug'] + '-old')
        extra['lead'] = extra['articles'][0]['slug']; extra['three_lines'][0]['slug'] = extra['lead']
        d['issues']['2026-10-08'] = extra
        self.assertRejected(d, 6, '색인에 없음')

    def test_count_mismatch(self):
        d = base(); d['index']['issues'][0]['count'] = 3
        self.assertRejected(d, 6, '편수')

    def test_duplicate_slug(self):
        d = mut(lambda d, i, a: i['articles'][1].update(slug=a['slug']))
        d['index']['issues'][0]['slugs'] = [a['slug'] for a in d['issues'][D]['articles']]
        self.assertRejected(d, 6, 'slug 중복')

    def test_lead_missing(self):
        self.assertRejected(mut(lambda d, i, a: i.update(lead='none-here')), 6, '대표 글')

    def test_article_issue_mismatch(self):
        self.assertRejected(mut(lambda d, i, a: a.update(issue_no=4)), 6, '호 날짜·호수')

    def test_dek_equals_what(self):
        self.assertRejected(mut(lambda d, i, a: a['body'].update(what=a['dek'])), 6, 'dek와 body.what')

    def test_empty_subtopic(self):
        self.assertRejected(mut(lambda d, i, a: a.update(subtopic='  ')), 6, '하위 주제')

    def test_weekly_pick_missing(self):
        d = base(); d['weekly']['2026-W41'] = {'schema': 'ai-magazine.site-weekly.v1', 'week': '2026-W41', 'title': '이번 주 정리',
             'intro': '한 주를 묶었다', 'published_at': T, 'picks': [{'slug': 'nothing', 'note': '없는 글'}]}
        self.assertRejected(d, 6, '주간 호가 고른 글')


class Rule7Permanence(Base):
    def test_slug_removed(self):
        prev = base(); now = base()
        now['issues'][D]['articles'] = now['issues'][D]['articles'][:1]
        now['index']['issues'][0].update(count=1, slugs=[now['issues'][D]['articles'][0]['slug']])
        self.assertRejected(now, 7, '사라짐', prev=prev)

    def test_slug_moved_date(self):
        prev = base(); now = base()
        moved = now['issues'][D]['articles'].pop(1)
        now['index']['issues'][0].update(count=1, slugs=[now['issues'][D]['articles'][0]['slug']])
        other = {'schema': 'ai-magazine.site-issue.v1', 'issue_date': '2026-10-10', 'issue_no': 6, 'status': 'published', 'quiet_note': None,
                 'updated_at': T, 'three_lines': [], 'lead': moved['slug'], 'articles': [dict(moved, issue_date='2026-10-10', issue_no=6)]}
        now['issues']['2026-10-10'] = other
        now['index']['issues'].append({'issue_date': '2026-10-10', 'issue_no': 6, 'status': 'published', 'count': 1, 'slugs': [moved['slug']], 'lead_title': None, 'cover': None})
        now['index']['latest'] = '2026-10-10'
        self.assertRejected(now, 7, '날짜가', prev=prev)

    def test_issue_number_changed(self):
        prev = base(); now = base()
        now['issues'][D]['issue_no'] = 6
        for a in now['issues'][D]['articles']:
            a['issue_no'] = 6
        now['index']['issues'][0]['issue_no'] = 6
        self.assertRejected(now, 7, '호수가 바뀜', prev=prev)


class Rule8Warnings(Base):
    def test_null_site_fields_warn(self):
        d = base(); d['site']['bot']['label'] = None; d['site']['notices']['ai_image'] = None
        d['issues'][D]['articles'][0]['media'] = [{'src': '/media/2026/a.webp', 'alt': '그림', 'kind': 'image', 'made_with_ai': True}]
        d['issues'][D]['articles'][0]['body']['how'] = ''
        out = self.assertPasses(d)
        msgs = ' '.join(w['path'] + w['message'] for w in out['warning_list'])
        for want in ('site.bot.label', 'AI 이미지 표시 문구', 'body.how'):
            self.assertIn(want, msgs)


class ReviewRound2(Base):
    """2차 검토 지적 회귀 시험."""
    def test_browser_normalized_social_links(self):
        for url in ['https://x.com\\anything/status/1', 'https://%78.com/anything/status/1', 'https://x.com /a']:
            with self.subTest(url=url):
                d = mut(lambda d, i, a: a.update(official_link={'url': url, 'label': '링크'}))
                rc, out = self.run_v(d)
                self.assertEqual(rc, 1)
                self.assertTrue(any(e['rule'] in (1, 4) and 'official_link' in e['path'] for e in out['error_list']), out['error_list'])

    def test_previous_missing_folder_rejected(self):
        write(self.tmp / 'site', base())
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = validate.main([str(self.tmp / 'site'), '--previous', str(self.tmp / 'nope'), '--schema013', str(self.tmp / 'x.json')])
        out = json.loads(buf.getvalue())
        self.assertEqual(rc, 1)
        self.assertTrue(any(e['rule'] == 7 and '폴더 없음' in e['message'] for e in out['error_list']), out)

    def test_previous_broken_issue_rejected(self):
        prev = base(); prev['issues'][D] = 'null'
        rc, out = self.run_v(base(), prev=prev)
        self.assertEqual(rc, 1)
        self.assertTrue(any(e['rule'] == 7 for e in out['error_list']), out['error_list'])

    def test_single_letter_handle(self):
        self.assertRejected(mut(lambda d, i, a: a['body'].update(how='@a가 공개했다')), 2, 'body.how')

    def test_bad_site_structure_reported_not_crash(self):
        for bad in ([], {'operator': {'links': ['bad']}}):
            with self.subTest(bad=bad):
                d = base()
                d['site'] = bad if isinstance(bad, list) else dict(base()['site'], operator=dict(base()['site']['operator'], links=['bad']))
                rc, out = self.run_v(d)
                self.assertEqual(rc, 1)
                self.assertTrue(any(e['rule'] == 1 and e['file'] == 'site.json' for e in out['error_list']), out['error_list'])
                self.assertFalse(any(e['rule'] == 0 for e in out['error_list']), out['error_list'])

    def test_datetime_requires_seconds(self):
        self.assertRejected(mut(lambda d, i, a: a.update(corrections=[{'corrected_at': '2026-10-09T07:41+09:00', 'text': '제품 이름을 바로잡았습니다.'}])), 1, 'date-time')
        self.assertPasses(mut(lambda d, i, a: a.update(corrections=[{'corrected_at': '2026-10-09T07:41:00+09:00', 'text': '제품 이름을 바로잡았습니다.'}])))

    def test_all_site_nulls_warn(self):
        d = base(); d['site']['bot']['name'] = None
        out = self.assertPasses(d)
        paths = {w['path'] for w in out['warning_list']}
        for want in ('site.bot.name', 'site.operator.bio', 'site.notices.verification', 'site.pages.corrections_format'):
            self.assertIn(want, paths)


class ReviewRound3(Base):
    """3차 검토 지적 회귀 시험."""
    def test_previous_index_points_to_missing_issue(self):
        prev = base(); prev['issues'] = {}
        now = base(); now['issues'][D]['articles'] = now['issues'][D]['articles'][:1]
        now['index']['issues'][0].update(count=1, slugs=[now['issues'][D]['articles'][0]['slug']])
        rc, out = self.run_v(now, prev=prev)
        self.assertEqual(rc, 1)
        self.assertTrue(any(e['rule'] == 7 and ('호 파일이 없음' in e['message'] or '사라짐' in e['message']) for e in out['error_list']), out['error_list'])

    def test_previous_empty_index_rejected(self):
        prev = base(); prev['index'] = {}; prev['issues'] = {}
        rc, out = self.run_v(base(), prev=prev)
        self.assertEqual(rc, 1)
        self.assertTrue(any(e['rule'] == 7 and '색인' in e['message'] for e in out['error_list']), out['error_list'])

    def test_previous_ok_passes(self):
        self.assertPasses(base(), prev=base())

    def test_timezone_minutes(self):
        self.assertRejected(mut(lambda d, i, a: a.update(corrections=[{'corrected_at': '2026-10-09T07:41:00+09:99', 'text': '이름을 바로잡았습니다.'}])), 1, 'date-time')
        self.assertRejected(mut(lambda d, i, a: a.update(corrections=[{'corrected_at': '2026-10-09T07:41:00+24:00', 'text': '이름을 바로잡았습니다.'}])), 1, 'date-time')
        self.assertPasses(mut(lambda d, i, a: a.update(corrections=[{'corrected_at': '2026-10-09T07:41:00+09:59', 'text': '이름을 바로잡았습니다.'}])))

    def test_handle_in_parentheses(self):
        self.assertRejected(mut(lambda d, i, a: a.update(dek='Thariq(@trq212)가 만든 스킬')), 2, 'dek')


class Engine(unittest.TestCase):
    def test_top_level_if_then(self):
        s = {'type': 'object', 'if': {'properties': {'a': {'const': 1}}}, 'then': {'required': ['b']}}
        self.assertTrue(validate.schema_check({'a': 1}, s, 'x', s, []))
        self.assertFalse(validate.schema_check({'a': 2}, s, 'x', s, []))

    def test_anyof_with_sibling(self):
        s = {'anyOf': [{'type': 'string'}, {'type': 'null'}], 'maxLength': 3}
        self.assertTrue(validate.schema_check('abcd', s, 'x', s, []))
        self.assertFalse(validate.schema_check(None, s, 'x', s, []))


if __name__ == '__main__':
    unittest.main()
