import { articles as allArticles, issues as allIssues, site, text, esc as rawEsc, byline, DESK, dateLabel, articleHref } from './data.mjs';
import { PLACEHOLDER } from './defaults.mjs';
const esc=text, pad=n=>String(n).padStart(2,'0'), md=d=>dateLabel(d), ymd=dateLabel, href=articleHref;
export function topline(issue){return `<div class="topline"><time>${dateLabel(issue.date || issue.issue_date)}</time><div class="tools"><span class="issue">제${issue.number || issue.issue_no}호 · ${issue.count ?? issue.articles.length}편</span><a href="/issues/">지난 호</a><a href="/search/">검색</a><a href="/rss.xml">RSS</a><button id="theme" type="button">어둡게</button></div></div>`;}
export function renderHome(raw,{current=true}={}){
 const articles=allArticles.filter(a=>a.issue_date===raw.issue_date).map(a=>({...a,desk:a.deskKey}));
 const issue={date:raw.issue_date,number:raw.issue_no,count:articles.length,weekday:new Date(raw.issue_date+'T00:00:00Z').toLocaleDateString('ko-KR',{weekday:'short',timeZone:'UTC'}),desks:{agents:articles.filter(a=>a.desk==='agents').length,visual:articles.filter(a=>a.desk==='visual').length}};
 const threeLines=raw.three_lines?.length?raw.three_lines:articles.slice(0,3).map(a=>({head:a.title,body:''}));
 const issues=allIssues.map(i=>({date:i.issue_date,number:i.issue_no,count:i.articles.length,titles:i.articles.map(a=>a.title)}));
 const leadA=articles.find(a=>a.slug===raw.lead)||articles[0],nextA=articles.filter(a=>a!==leadA).slice(0,5),onFront=new Set([leadA,...nextA]);
 const no=a=>pad(articles.indexOf(a)+1),kicker=a=>`<span class="kicker ${a.desk}">${text(a.kicker)}</span>`,mins=a=>`<span class="meta">읽는 데 ${a.minutes}분<span data-read="${a.slug}"></span></span>`;
  function cover() {
    // 칸 크기를 줄 수에 맞춰 계산해 괘선(y=48·320) 사이 높이 안에 들어가게 한다(최대 60칸).
    const cols = 6, n = Math.min(articles.length, 60), rows = Math.max(1, Math.ceil(n / cols));
    const gapPx = rows > 5 ? 4 : 6, top = 62, bottom = 306;
    const size = Math.min(30, Math.floor((bottom - top - (rows - 1) * gapPx) / rows));
    const x0 = 390, y0 = top + Math.round((bottom - top - (rows * size + (rows - 1) * gapPx)) / 2);
    const cells = articles.slice(0,60).map((a, i) => {
      const x = x0 + (i % cols) * (size + gapPx), y = y0 + Math.floor(i / cols) * (size + gapPx);
      const isLead = a === leadA;
      return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="var(--${a.desk})" opacity="0.92"/>` +
        (isLead ? `<rect x="${x - 4}" y="${y - 4}" width="${size + 8}" height="${size + 8}" fill="none" stroke="var(--ink)" stroke-width="2"/>` : '');
    }).join('');
    const desc = `제${issue.number}호, ${ymd(issue.date)}. 오늘 기사 ${issue.count}편을 칸으로 그렸다. 파란 칸은 에이전트·자동화 ${issue.desks.agents}편, 주황 칸은 이미지·영상·디자인 ${issue.desks.visual}편, 테두리 칸은 대표 기사.`;
    return `<figure class="cover"><svg viewBox="0 0 600 380" role="img" aria-labelledby="cv-t cv-d">
      <title id="cv-t">제${issue.number}호 표지</title><desc id="cv-d">${desc}</desc>
      <defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.10"/></feComponentTransfer></filter></defs>
      <rect width="600" height="380" fill="var(--paper)"/>
      <text x="0" y="30" class="t strong">${issue.date.replace(/-/g, '.')} ${issue.weekday}</text>
      <text x="600" y="30" text-anchor="end" class="t">제${issue.number}호 · ${issue.count}편</text>
      <line x1="0" y1="48" x2="600" y2="48" stroke="var(--rule)" stroke-width="1"/>
      <text x="-10" y="292" class="n">${pad(issue.number)}</text>
      ${cells}
      <line x1="0" y1="320" x2="600" y2="320" stroke="var(--rule)" stroke-width="1"/>
      <rect x="0" y="342" width="12" height="12" fill="var(--agents)"/><text x="20" y="353" class="t">에이전트·자동화 ${issue.desks.agents}</text>
      <rect x="196" y="342" width="12" height="12" fill="var(--visual)"/><text x="216" y="353" class="t">이미지·영상·디자인 ${issue.desks.visual}</text>
      <text x="600" y="353" text-anchor="end" class="t">□ 대표 기사</text>
      <rect width="600" height="380" filter="url(#grain)" style="mix-blend-mode:multiply" pointer-events="none"/>
    </svg><figcaption data-placeholder="cover-caption">오늘 호 기사 ${issue.count}편을 한 칸씩 그린 표지</figcaption></figure>`;
  }

  function homeMarkup() {
    const story = (a) => `<li><span class="no">${no(a)}</span><div>${kicker(a)}<h3><a href="${href(a)}">${esc(a.title)}</a></h3><p class="dek clamp-2">${esc(a.dek)}</p>${mins(a)}</div></li>`;
    const desk = (key) => {
      const rest = articles.filter((a) => a.desk === key && !onFront.has(a));
      return `<section class="desk" id="${key}"><div class="desk-head"><h2><span class="dot ${key}" aria-hidden="true"></span>${DESK[key]} 데스크</h2><span class="meta">${issue.desks[key]}편 중 1면 밖 ${rest.length}편</span></div><ol class="stories">${rest.map(story).join('')}</ol></section>`;
    };
    return `<header class="wrap">${topline(issue)}
      <div class="masthead">${current ? `<h1>${rawEsc(site.masthead.name)}</h1>` : `<p class="name" aria-hidden="false">${rawEsc(site.masthead.name)}</p>`}<p data-placeholder="tagline">${text(site.masthead.tagline || PLACEHOLDER.tagline)}</p><p class="byline">${rawEsc(byline())}</p></div>
      <div class="rules"></div>
      <nav class="desks" aria-label="데스크"><a href="/"${current ? ' aria-current="page"' : ''}>오늘 호</a><a href="/desk/agents/"><span class="dot agents" aria-hidden="true"></span>에이전트·자동화</a><a href="/desk/visual/"><span class="dot visual" aria-hidden="true"></span>이미지·영상·디자인</a><a href="/weekly/">주간 호</a><a href="/issues/"${current ? '' : ' aria-current="page"'}>지난 호</a></nav>
    </header>
    <main id="main" class="wrap">${current ? '' : `<h1 class="issue-title">지난 호 · 제${issue.number}호 · ${rawEsc(ymd(issue.date))}</h1>`}
      <section class="front" aria-label="오늘의 1면">
        <article class="lead">${kicker(leadA)}<h2><a href="${href(leadA)}">${esc(leadA.title)}</a></h2><p class="dek">${esc(leadA.dek)}</p>${mins(leadA)}${cover()}</article>
        <aside class="three" aria-labelledby="three-h"><h2 class="section-label" id="three-h">오늘의 세 줄</h2><ol>${threeLines.map((l, i) => `<li><span class="num" aria-hidden="true">${i + 1}</span><div><h3>${esc(l.head)}</h3><p>${esc(l.body)}</p></div></li>`).join('')}</ol></aside>
        <aside class="next" aria-labelledby="next-h"><h2 class="section-label" id="next-h">1면 이어서</h2><ol>${nextA.map((a) => `<li>${kicker(a)}<h3><a href="${href(a)}">${esc(a.title)}</a></h3><p class="dek clamp-2">${esc(a.dek)}</p></li>`).join('')}</ol></aside>
      </section>
      ${desk('agents')}${desk('visual')}
      <section class="weekly" id="weekly" aria-labelledby="weekly-h">
        <figure><img src="/covers/cover-weekly-1400.jpg" width="1400" height="930" alt="화면 조각과 필름 조각이 꽂힌 신문 배달 자전거 바구니를 파랑·주황 두 색 판화처럼 그린 그림"><figcaption data-placeholder="ai-image-note">${text(site.notices.ai_image || PLACEHOLDER.ai_image)}</figcaption></figure>
        <div class="copy"><span class="kicker agents">주간 호</span><h2 id="weekly-h">한 주의 흐름을 한 번 더 묶는 주간 정리 호</h2><p>그 주에 올라온 글을 데스크별로 다시 읽고, 무엇이 실제로 바뀌었는지 한 편으로 정리합니다.</p><span class="meta">첫 주간 호는 준비 중</span></div>
      </section>
      <section class="archive" id="archive" aria-labelledby="arch-h"><h2 class="section-label" id="arch-h">지난 호</h2>
        <ol class="issues">${issues.filter((i) => i.date !== issue.date).map((i) => `<li><a class="no" href="/issues/${i.date}/">제${i.number}호</a><span class="meta">${md(i.date)} · ${i.count}편</span><ul>${i.titles.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></li>`).join('')}</ol>
      </section>
    </main>`;
  }


return articles.length ? homeMarkup() : quietMarkup();
 // 조용한 날: 머리·메뉴·본문 바로가기 대상은 그대로, 1면 자리에 한 줄과 지난 호.
 function quietMarkup() {
  return `<header class="wrap">${topline(issue)}<div class="masthead">${current ? `<h1>${rawEsc(site.masthead.name)}</h1>` : `<p class="name">${rawEsc(site.masthead.name)}</p>`}<p data-placeholder="tagline">${text(site.masthead.tagline || PLACEHOLDER.tagline)}</p><p class="byline">${rawEsc(byline())}</p></div><div class="rules"></div>
   <nav class="desks" aria-label="데스크"><a href="/"${current ? ' aria-current="page"' : ''}>오늘 호</a><a href="/desk/agents/">에이전트·자동화</a><a href="/desk/visual/">이미지·영상·디자인</a><a href="/weekly/">주간 호</a><a href="/issues/"${current ? '' : ' aria-current="page"'}>지난 호</a></nav></header>
   <main id="main" class="wrap">${current ? '' : `<h1 class="issue-title">지난 호 · 제${issue.number}호 · ${rawEsc(ymd(issue.date))}</h1>`}<section class="quiet"><span class="kicker agents">제${issue.number}호 · 조용한 날</span><h2>${text(raw.quiet_note || '오늘은 실무에 바로 쓸 만한 변화가 없었습니다.')}</h2></section>
   <section class="archive" aria-labelledby="arch-h"><h2 class="section-label" id="arch-h">지난 호</h2><ol class="issues">${issues.filter((i) => i.date !== issue.date).slice(0, 4).map((i) => `<li><a class="no" href="/issues/${i.date}/">제${i.number}호</a><span class="meta">${md(i.date)} · ${i.count}편</span></li>`).join('')}</ol></section></main>`;
 }
}
