// 시안 검사: node check.mjs <시안폴더 a|b|c> [페이지...]
// 세 폭(1440·1024·390)에서 가로 넘침·금지 표시·콘솔 오류·허용 밖 외부 요청을 재고, 첫 화면·전체 캡처를 남긴다.
import { spawn } from "node:child_process";
import os from 'node:os';
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const base=process.argv[2] || 'http://127.0.0.1:8769';
const index=JSON.parse(fs.readFileSync(path.join(ROOT,'../contract/examples/index.json'),'utf8'));
const slugs=index.issues[0].slugs;
const pages=['/','/a/'+slugs[0]+'/','/a/'+slugs[11]+'/','/issues/'+index.latest+'/','/desk/agents/','/search/','/corrections/','/about/','/policy/','/404.html'];
const dir='site';
const OUT=path.join(ROOT,'qa/out');fs.mkdirSync(OUT,{recursive:true});
const ALLOW=[new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/'),/^data:/,/^https:\/\/fonts\.googleapis\.com\//,/^https:\/\/fonts\.gstatic\.com\//,/^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/];
const FORBID = [/(^|[\s(\[{"'“‘「『<,·:/])@(?!v?\d)[A-Za-z_][A-Za-z0-9_]*/, /좋아요/, /원문/, /출처/, /x\.com/i, /\p{Extended_Pictographic}/u];
const C = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9350 + Math.floor(Math.random() * 40);
const ch = spawn(C, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(),"jupjup-check-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = setTimeout(() => { ch.kill(); console.error("timeout"); process.exit(3); }, 240000);
let ver; for (let k = 0; k < 50 && !ver; k++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(300); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; const bySession = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; return; }
  const log = bySession[m.sessionId]; if (!log) return;
  if (m.method === "Runtime.exceptionThrown") log.errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200) || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") log.errors.push("console: " + JSON.stringify(m.params.args.map((a) => a.value || a.description)).slice(0, 200));
  if (m.method === "Network.requestWillBeSent") { const u = m.params.request.url; if (!ALLOW.some((r) => r.test(u))) log.external.push(u.slice(0, 160)); }
  if (m.method === "Network.loadingFailed" && !/net::ERR_ABORTED/.test(m.params.errorText)) log.errors.push("net: " + m.params.errorText);
};
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const MEASURE = `(() => {
  const iw = innerWidth, sw = document.documentElement.scrollWidth;
  const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > iw + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 30));
  const textEls = [...document.querySelectorAll('body *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const small = textEls.filter(e => parseFloat(getComputedStyle(e).fontSize) < 13).slice(0, 5).map(e => e.innerText.slice(0, 20) + '@' + getComputedStyle(e).fontSize);
  const taps = [...document.querySelectorAll('a,button,input,select,[role=button]')].filter(e => e.offsetParent).filter(e => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).slice(0, 5).map(e => (e.innerText || e.tagName).slice(0, 16));
  return { iw, sw, overflow: sw > iw, wide, small, taps, H: document.documentElement.scrollHeight, h1: document.querySelectorAll('h1').length, text: document.body.innerText, head: [document.title, ...[...document.querySelectorAll('meta[name=description],meta[property^="og:"]')].filter(m => !/og:(url|image)/.test(m.getAttribute('property') || '')).map(m => m.content)].join(' | ') };
})()`;
const report = [];
const interactions=[];
for (const pg of pages) {
  for (const [w, h, mob] of [[1440, 900, false], [1024, 768, false], [390, 844, true]]) {
    const t = await send("Target.createTarget", { url: "about:blank" });
    const a = await send("Target.attachToTarget", { targetId: t.result.targetId, flatten: true });
    const sid = a.result.sessionId; bySession[sid] = { errors: [], external: [] };
    await send("Runtime.enable", {}, sid); await send("Network.enable", {}, sid); await send("Page.enable", {}, sid);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mob ? 2 : 1, mobile: mob }, sid);
    await send("Page.navigate", { url: base + pg }, sid);
    await sleep(1500);
    await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise:true }, sid);
    if(pg==='/search/' && w===390){
      const result=await send('Runtime.evaluate',{expression:`(async()=>{const pf=await import('/pagefind/pagefind.js');const found={};for(const q of ['Claude','영상','qzx987nomatch'])found[q]=(await pf.search(q)).results.length;return found})()`,awaitPromise:true,returnByValue:true},sid);
      const found=result.result?.result?.value;
      interactions.push({search:found,ok:!!found && found.Claude>0 && found['영상']>0 && found.qzx987nomatch===0});
      await send('Runtime.evaluate',{expression:`document.getElementById('query').value='qzx987nomatch';document.getElementById('query').dispatchEvent(new Event('input',{bubbles:true}))`},sid);
      let status='';for(let k=0;k<40;k++){await sleep(200);status=(await send('Runtime.evaluate',{expression:`document.getElementById('search-status').textContent`,returnByValue:true},sid)).result?.result?.value;if(status?.includes('결과가 없습니다'))break;}
      interactions.push({emptyStatus:status,ok:status?.includes('결과가 없습니다')});
      await send('Runtime.evaluate',{expression:`document.getElementById('query').value='';document.getElementById('query').dispatchEvent(new Event('input',{bubbles:true}))`},sid);await sleep(250);
    }
    if(pg==='/' && w===390){
      const toggles=(await send('Runtime.evaluate',{expression:`(()=>{const b=document.getElementById('theme');b.click();const first=document.documentElement.dataset.theme;b.click();return [first,document.documentElement.dataset.theme]})()`,returnByValue:true},sid)).result?.result?.value;
      interactions.push({themes:toggles,ok:toggles?.[0]!==toggles?.[1]});
    }
    const m = (await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true }, sid)).result?.result?.value || {};
    // 편집 방침 페이지는 확정 문구("원문은 옮기지 않고")에 '원문'이 들어간다 — 그 페이지 본문에서만 이 낱말을 허용한다.
    const rules = pg === '/policy/' ? FORBID.filter((r) => String(r) !== '/원문/') : FORBID;
    const forbidden = [...rules.filter((r) => r.test(m.text || "")).map(String), ...FORBID.filter((r) => r.test(m.head || "")).map((r) => 'head:' + r)];
    const tag = pg.replace(/[^a-z0-9]+/gi, "_") + "-" + w;
    const s1 = await send("Page.captureScreenshot", { format: "png" }, sid);
    if (s1.result?.data) fs.writeFileSync(path.join(OUT, `${tag}-first.png`), Buffer.from(s1.result.data, "base64"));
    const s2 = await send("Page.captureScreenshot", { format: "jpeg", quality: 70, captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(m.H || h, 9000), scale: mob ? 1 : 0.6 } }, sid);
    if (s2.result?.data) fs.writeFileSync(path.join(OUT, `${tag}-full.jpg`), Buffer.from(s2.result.data, "base64"));
    const row = { page: pg, w, overflow: m.overflow, wide: m.wide, small: m.small, taps: m.taps, h1: m.h1, H: m.H, forbidden, errors: bySession[sid].errors, external: [...new Set(bySession[sid].external)] };
    report.push(row);
    await send("Target.closeTarget", { targetId: t.result.targetId });
  }
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT,"interactions.json"),JSON.stringify(interactions,null,2));
const bad = report.filter((r) => r.overflow || r.forbidden.length || r.errors.length || r.external.length || r.h1 !== 1 || r.small.length || r.taps.length);
console.log(JSON.stringify({ pages: report.length, bad: bad.length+interactions.filter(r=>!r.ok).length, interactions, rows: report.map((r) => ({ p: r.page, w: r.w, overflow: r.overflow, forbidden: r.forbidden, errors: r.errors.length, external: r.external.length, h1: r.h1, small: r.small.length, taps: r.taps.length })) }));
clearTimeout(kill); ch.kill(); process.exit(bad.length || interactions.some(r=>!r.ok) ? 1 : 0);
