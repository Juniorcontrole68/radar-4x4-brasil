const CACHE='conversa-de-bar-carol-v3';
const CORE=['/','/styles.css?v=carol2','/app.js?v=carol2','/manifest.json','/avatar-clara.svg?v=2'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x))))])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request)))})