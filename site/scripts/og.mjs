// 기사·호 공유 이미지(1200×630 PNG). 화면 디자인(A+C 조합안)의 제호·이중 괘선·데스크 색 키커를 옮긴다.
// 출처·계정·반응 수는 넣지 않는다. 글꼴은 npm pretendard 패키지의 OTF만 쓴다(외부 내려받기 없음).
import fs from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { articles, issues, site, show, DESK } from '../src/lib/data.mjs';

const dir = 'node_modules/pretendard/dist/public/static/';
const fonts = [['Regular', 400], ['SemiBold', 600], ['ExtraBold', 800]].map(([w, weight]) => ({
  name: 'Pretendard', data: fs.readFileSync(dir + `Pretendard-${w}.otf`), weight, style: 'normal',
}));
const INK = '#141413', INK2 = '#45453F', INK3 = '#6B6B65', PAPER = '#FBFBF9', RULE_SOFT = '#DCDCD6';
const DESK_COLOR = { agents: '#1E4FD6', visual: '#D2461A' };
const WEEK = '일월화수목금토';
const el = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });

// 한 줄에 들어갈 폭을 글자 종류로 어림해 3줄 안에서 자른다(한글·전각 1.0, 영문·숫자 0.56, 공백·기호 0.32 em).
function fitTitle(title, fontPx, widthPx, lines) {
  const unit = (ch) => (/[ㄱ-힝　-〿＀-￯]/.test(ch) ? 1 : /[A-Za-z0-9]/.test(ch) ? 0.56 : 0.32);
  const max = (widthPx / fontPx) * lines * 0.94;  // 줄바꿈 손실 6% 여유
  let used = 0, out = '';
  for (const ch of title) {
    if (used + unit(ch) > max) return out.trimEnd().replace(/[\s,.·:;—-]+$/, '') + '…';
    used += unit(ch); out += ch;
  }
  return out;
}

function card({ kicker, title, deskKey, date, no, label }) {
  const c = DESK_COLOR[deskKey] || DESK_COLOR.agents;
  const d = new Date(date + 'T00:00:00Z');
  const when = `${date.replaceAll('-', '.')} ${WEEK[d.getUTCDay()]}`;
  const t = fitTitle(show(title), 70, 1056, 3);
  return el('div', { flexDirection: 'column', width: 1200, height: 630, background: PAPER, color: INK, fontFamily: 'Pretendard', boxSizing: 'border-box' }, [
    el('div', { height: 12, background: c, width: 1200 }, []),
    el('div', { flexDirection: 'column', padding: '34px 72px 0 72px', width: 1200, boxSizing: 'border-box', flexGrow: 1 }, [
      el('div', { justifyContent: 'space-between', alignItems: 'baseline', width: 1056 }, [
        el('div', { fontSize: 40, fontWeight: 800, letterSpacing: -1.2 }, site.masthead.name),
        el('div', { fontSize: 24, fontWeight: 400, color: INK2 }, `제${no}호 · ${when}`),
      ]),
      el('div', { flexDirection: 'column', marginTop: 20, width: 1056 }, [
        el('div', { height: 4, background: INK, width: 1056 }, []),
        el('div', { height: 3, width: 1056 }, []),
        el('div', { height: 1, background: INK, width: 1056 }, []),
      ]),
      el('div', { alignItems: 'center', marginTop: 46 }, [
        el('div', { width: 16, height: 16, background: c, marginRight: 12 }, []),
        el('div', { fontSize: 26, fontWeight: 600, color: c }, show(kicker)),
      ]),
      el('div', { marginTop: 18, width: 1056, fontSize: 70, fontWeight: 800, lineHeight: 1.2, letterSpacing: -1.8, wordBreak: 'keep-all', maxHeight: 70 * 1.2 * 3, overflow: 'hidden' }, t),
    ]),
    el('div', { justifyContent: 'space-between', alignItems: 'center', margin: '0 72px 34px 72px', paddingTop: 18, borderTop: `1px solid ${RULE_SOFT}`, width: 1056 }, [
      el('div', { fontSize: 22, fontWeight: 600, color: INK2 }, label),
      el('div', { fontSize: 22, fontWeight: 400, color: INK3 }, '매일 아침 AI 실무 정리'),
    ]),
  ]);
}

fs.mkdirSync('dist/og', { recursive: true });
const rows = [
  ...articles.map((a) => ({ file: a.slug, kicker: a.kicker, title: a.title, deskKey: a.deskKey, date: a.issue_date, no: a.issue_no, label: `${DESK[a.deskKey]} 데스크` })),
  ...issues.map((i) => {
    const lead = i.articles.find((a) => a.slug === i.lead) || i.articles[0];
    const deskKey = lead && lead.desk === DESK.visual ? 'visual' : 'agents';
    return { file: 'issue-' + i.issue_date, kicker: '오늘의 1면', title: lead ? lead.title : (i.quiet_note || '오늘 호'), deskKey, date: i.issue_date, no: i.issue_no, label: `오늘 호 ${i.articles.length}편` };
  }),
];
for (const row of rows) {
  const svg = await satori(card(row), { width: 1200, height: 630, fonts });
  fs.writeFileSync(`dist/og/${row.file}.png`, new Resvg(svg).render().asPng());
}
console.log('공유 이미지 생성:', rows.length);
