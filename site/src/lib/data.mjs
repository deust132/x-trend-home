import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS } from './defaults.mjs';
const dir = path.resolve(process.env.SITE_DATA_DIR || '../data/site');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const transition = !fs.existsSync(path.join(dir, 'index.json'));
export const clean = v => String(v || '').replace(/HuggingFace에서 [\d,]+개의 좋아요를 받은 점은 오픈 커뮤니티의 높은 관심을 보여주며, /g, '').replace(/원문/g, '세부 내용').replace(/출처/g, '관련 자료').replace(/좋아요(?:\s*[\d,]+)?/g, '').replace(/(^|[\s(\[{"'“‘「『<,·:/])@(?!v?\d)[A-Za-z_][A-Za-z0-9_]*/g, '$1').replace(/\(\s*\)/g, '').replace(/https?:\/\/\S+/g, '').replace(/\bx\.com\b/gi, '').replace(/(?<![A-Za-z0-9])X(?![A-Za-z0-9])\s*/g, '').replace(/\p{Extended_Pictographic}/gu, '');
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tidy = transition || !!process.env.SITE_PREVIEW;
// show: 정리만 한 일반 문자열(Astro가 이스케이프하는 자리용) / text: 정리+이스케이프한 HTML 조각용
export const show = v => (tidy ? clean(v) : String(v ?? ''));
export const text = v => esc(show(v));
export const DESK = {agents:'에이전트·자동화',visual:'이미지·영상·디자인'};
let config, rawIssues, weekly=[];
if (!transition) {
 config=read(path.join(dir,'site.json'));
 const idx=read(path.join(dir,'index.json'));
 rawIssues=idx.issues.map(i=>read(path.join(dir,'issues',i.issue_date+'.json')));
 if(fs.existsSync(path.join(dir,'weekly'))) weekly=fs.readdirSync(path.join(dir,'weekly')).filter(n=>n.endsWith('.json')).map(n=>read(path.join(dir,'weekly',n)));
} else {
 console.warn('전환 모드: v1 수집본을 표시용으로 변환합니다. 게시 승인 검사는 적용되지 않습니다.');
 const v1=path.resolve(process.env.SITE_V1_DIR || '../data');
 const daily=read(path.join(v1,'daily.json')), archive=read(path.join(v1,'archive.json')), insights=read(path.join(v1,'insights.json'));
 const dates=[...new Set([...archive.items.filter(i=>i.archivedAt).map(i=>i.archivedAt.slice(0,10)),daily.date])].sort();
 const used=new Set(), dropped=[];
 rawIssues=dates.map((date,idx)=>{
  const items=date===daily.date?daily.items:archive.items.filter(i=>i.archivedAt?.slice(0,10)===date);
  const arts=items.map((it,n)=>{
   let slug=[date.replaceAll('-','').slice(2),String(n+1).padStart(2,'0'),...(it.title.toLowerCase().match(/[a-z0-9]+/g)||[]).slice(0,5)].join('-').slice(0,80).replace(/-$/,'');
   while(used.has(slug))slug+='-x';used.add(slug);
   const body={what:'',how:'',why:'',try:''};
   for(const m of (it.detail||'').matchAll(/^## (.+?)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)){const key={'쉬운 설명':'what','시사하는 바':'why','활용 팁':'try'}[m[1].trim()];if(key)body[key]=m[2].trim();}
   // 상세 설명이 없는 수집본(제목·한 줄 요약뿐)은 싣지 않는다. 주소는 위에서 먼저 매겨 다른 글의 주소가 밀리지 않게 한다.
   if(!Object.values(body).some(Boolean)){dropped.push(slug);return null;}
   if(!body.what)body.what=(it.summary||'').trim();
   const visual=['AI 미디어 생성','디자인·크리에이티브'].includes(it.category)||(['기타','Jev'].includes(it.category)&&(it.tags||[]).some(t=>['이미지생성','영상생성','디자인'].includes(t)));
   const official=/^https:\/\/(github\.com|huggingface\.co)\/[^/?#]+\/[^/?#]+\/?$/.test(it.url||'')?{url:it.url.replace(/\/$/,''),label:it.url.includes('github.com')?'GitHub 저장소':'Hugging Face 페이지'}:null;
   return {slug,issue_date:date,issue_no:idx+1,desk:visual?DESK.visual:DESK.agents,subtopic:it.category||'기타',kicker:it.category||'기타',title:it.title.trim(),dek:(it.summary||'').trim().slice(0,160),body,glossary:[],corrections:[],official_link:official,media:[]};
  }).filter(Boolean);
  return {issue_date:date,issue_no:idx+1,articles:arts,lead:(arts.find(a=>a.body.why)||arts[0])?.slug,three_lines:date===daily.date?insights.daily.points.slice(0,3).map(p=>{const [head,...rest]=p.split(' — ');return {head:head.trim().slice(0,40),body:rest.join(' — ').trim().slice(0,240)};}):[]};
 });
 if(dropped.length)console.warn(`전환 모드: 상세 설명이 없는 수집본 ${dropped.length}편은 싣지 않습니다(${dropped.join(', ')})`);
 config={};
}
// site.json 값이 null이면 확정 기본값을 쓴다(기본값도 null이면 화면이 임시 자리를 보여 준다).
const merge=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k])?merge(a[k],(b||{})[k]||{}):((b||{})[k]??a[k])]));
export const site=merge(DEFAULTS,config);
// 확정 문구 속 '@운영자'를 핸들(없으면 닉네임)로 바꾼다.
export const operatorName=()=>site.operator.handle||site.operator.nickname||'@운영자';
// 이름 끝 글자 받침에 맞춰 뒤따르는 조사를 고른다(한글 이름일 때만, 영문 핸들은 문장 그대로).
const JOSA={'가':['가','이'],'이':['가','이'],'는':['는','은'],'은':['는','은'],'를':['를','을'],'을':['를','을'],'와':['와','과'],'과':['와','과']};
const hasFinal=w=>{const c=w.charCodeAt(w.length-1);return c>=0xAC00&&c<=0xD7A3?(c-0xAC00)%28!==0:null;};
export const fill=v=>String(v??'').replace(/@운영자([가이는은를을와과])?/g,(_,j)=>{const name=operatorName(),f=hasFinal(name);return name+(j?(f===null?j:JOSA[j][f?1:0]):'');});
export const issues=rawIssues.sort((a,b)=>b.issue_date.localeCompare(a.issue_date));
export const articles=issues.flatMap(i=>i.articles.map((a,n)=>({...a,deskKey:a.desk===DESK.visual?'visual':'agents',number:n+1,minutes:Math.max(1,Math.ceil((a.dek+Object.values(a.body).join('')).length/500))})));
export const latest=issues[0];
export const weeklies=weekly.sort((a,b)=>b.week.localeCompare(a.week));
export const articleHref=a=>'/a/'+a.slug+'/';
export const topicHref=t=>'/topic/'+encodeURIComponent(t)+'/';
export const dateLabel=d=>new Date(d+'T00:00:00Z').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:'UTC'});
// 편집 표시는 한 줄로 짧게. 봇 안내 문장(bot.label)은 소개·편집 방침 페이지에만 쓴다.
export const byline=()=>`편집 ${operatorName()} · 수집·초안 보조 ${site.bot.name||'줍줍봇'}(자동 계정)`;
export function bodyHTML(value){
 let html='',items=[];const flush=()=>{if(items.length){html+='<ol>'+items.map(i=>'<li>'+text(i)+'</li>').join('')+'</ol>';items=[];}};
 for(const block of String(value||'').split(/\n\s*\n/)){for(const line of block.split('\n')){const m=line.trim().match(/^\d+[.)]\s+(.*)$/);if(m)items.push(m[1]);else{flush();if(line.trim())html+='<p>'+text(line.trim())+'</p>';}}flush();}return html;
}
