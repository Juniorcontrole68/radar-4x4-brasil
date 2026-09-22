const CACHE="diario-bordo-v2-shell-4";
const CORE=[
  "/styles.css?v=20260922-2",
  "/app-core.js?v=20260922-2",
  "/app-actions.js?v=20260922-2",
  "/manifest.webmanifest",
  "/icons/icon.svg"
];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET" || e.request.url.includes("/api/")) return;

  const req=e.request;
  const url=new URL(req.url);
  const isNavigation=req.mode==="navigate";
  const isAppAsset=
    url.pathname==="/index.html" ||
    url.pathname==="/" ||
    url.pathname==="/styles.css" ||
    url.pathname==="/app-core.js" ||
    url.pathname==="/app-actions.js";

  if(isNavigation || isAppAsset){
    e.respondWith(
      fetch(req,{cache:"no-store"})
        .then(resp=>{
          const copy=resp.clone();
          caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
          return resp;
        })
        .catch(()=>caches.match(req).then(r=>r||caches.match("/")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
      return resp;
    }))
  );
});
