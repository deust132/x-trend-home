(()=>{const store={get(k,f){try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const root=document.documentElement,btn=document.getElementById('theme'),dark=()=>root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;
const label=()=>{if(btn){btn.textContent=dark()?'밝게':'어둡게';btn.setAttribute('aria-label',`화면을 ${dark()?'밝게':'어둡게'} 바꾸기`)}};label();btn?.addEventListener('click',()=>{root.dataset.theme=dark()?'light':'dark';store.set('ac_theme',root.dataset.theme);label()});
const read=new Set(store.get('ac_read',[])),slug=document.querySelector('[data-slug]')?.dataset.slug;if(slug){read.add(slug);store.set('ac_read',[...read])}document.querySelectorAll('[data-read]').forEach(el=>{if(read.has(el.dataset.read))el.textContent=' · 읽음'});
if(location.hash.startsWith('#item='))history.replaceState(null,'',location.pathname+location.search);
const status=document.getElementById('share-status');document.getElementById('copy')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);status.textContent='링크를 복사했습니다'}catch{status.textContent='주소 표시줄에서 링크를 복사해 주세요'}});
const share=document.getElementById('share');if(share&&navigator.share){share.hidden=false;share.addEventListener('click',async()=>{try{await navigator.share({title:document.title,url:location.href})}catch(e){if(e.name!=='AbortError')status.textContent='공유하지 못했습니다'}})}
})();
