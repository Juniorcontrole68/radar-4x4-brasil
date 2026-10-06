const CACHE='convites-20261005-2';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 event.respondWith((async()=>{
  try{return await fetch(event.request,{cache:'no-store'})}
  catch(e){const cached=await caches.match(event.request);if(cached)return cached;throw e}
 })());
});