import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
const root=path.resolve(new URL('..',import.meta.url).pathname);process.chdir(root);
// 기본은 원본 저장소 배치(../data/site, ../data). 작업 폴더(../contract/examples가 있을 때)에서만 예시 데이터(../contract/examples)와 복제본 v1을 쓴다.
const workspace=fs.existsSync('../contract/examples/index.json');
process.env.SITE_DATA_DIR ||= workspace?'../contract/examples':'../data/site';process.env.SITE_V1_DIR ||= workspace?'../original-repo/data':'../data';
const mode=process.argv[2],transition=!fs.existsSync(path.resolve(process.env.SITE_DATA_DIR,'index.json'));
if(mode==='preview')process.env.SITE_PREVIEW='1';
if(mode==='build'&&!transition){const result=spawnSync('python3',['guard/tools/validate.py',process.env.SITE_DATA_DIR],{stdio:'inherit'});if(result.error){console.error('검사 실행 실패:',result.error.message);process.exit(1)}if(result.status!==0)process.exit(result.status||1)}
// 운영 빌드(build)에서 전환 모드는 SITE_ALLOW_TRANSITION=1을 줄 때만 허용한다(실수로 수집본을 그대로 내보내지 않게).
if(mode==='build'&&transition&&process.env.SITE_ALLOW_TRANSITION!=='1'){console.error('내보내기 데이터(index.json)가 없습니다. 전환 모드로 빌드하려면 SITE_ALLOW_TRANSITION=1');process.exit(1)}
if(transition)console.warn('전환 모드: 게시 승인 검사를 건너뜁니다');
if(mode==='dev'){const child=spawn('node',['node_modules/astro/bin/astro.mjs','dev','--host','127.0.0.1'],{stdio:'inherit'});child.on('exit',n=>process.exit(n||0));for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>child.kill(sig));}
else{const start=Date.now();for(const [cmd,args] of [['node',['node_modules/astro/bin/astro.mjs','build']],['node',['scripts/og.mjs']],['node',['node_modules/pagefind/lib/runner/bin.cjs','--site','dist']]]){const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.error||r.status)process.exit(r.status||1)}const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);const files=walk('dist');console.log(JSON.stringify({mode,transition,pages:files.filter(p=>p.endsWith('.html')).length,bytes:files.reduce((s,p)=>s+fs.statSync(p).size,0),seconds:(Date.now()-start)/1000}));}
