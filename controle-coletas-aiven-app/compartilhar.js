'use strict';
// "Torre Docs": app instalável (Android) que aparece no Compartilhar do celular. No WhatsApp,
// abrir o PDF › Compartilhar › Torre Docs, e escolher onde salvar: documento da coleta
// (motorista, cavalo ou carreta) ou conta pessoal do Financeiro (boleto ou comprovante).
// O service worker recebe o arquivo do Compartilhar e a tela envia pelas rotas que já existem
// (/api/painel/coletas-documentos e /api/bills/:id/document), com a sessão do painel.
// Testado em tests/compartilhar.js.

const fs=require('fs');
const path=require('path');

const BASE='/compartilhar/';
const ICONES={
  '/compartilhar/icone-192.png':fs.readFileSync(path.join(__dirname,'compartilhar-icone-192.png')),
  '/compartilhar/icone-512.png':fs.readFileSync(path.join(__dirname,'compartilhar-icone-512.png'))
};
const PAGINA=fs.readFileSync(path.join(__dirname,'compartilhar.html'));

const MANIFESTO=JSON.stringify({
  name:'Torre Docs • Construlog',short_name:'Torre Docs',id:BASE,start_url:BASE,scope:BASE,
  display:'standalone',background_color:'#ffffff',theme_color:'#39586d',
  description:'Salva PDFs recebidos no WhatsApp na coleta ou nas contas pessoais.',
  icons:[{src:BASE+'icone-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
    {src:BASE+'icone-512.png',sizes:'512x512',type:'image/png',purpose:'any'}],
  share_target:{action:BASE+'receber',method:'POST',enctype:'multipart/form-data',
    params:{title:'titulo',text:'texto',files:[{name:'arquivo',accept:['application/pdf','.pdf','image/jpeg','image/png','image/webp']}]}}
});

// O arquivo compartilhado fica no Cache Storage até a tela salvar (ou descartar).
const SW=`const C='torre-docs-v1',ARQ='${BASE}arquivo-recebido';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['${BASE}'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method==='POST'&&u.pathname==='${BASE}receber'){
    e.respondWith((async()=>{
      try{
        const f=await e.request.formData(),a=f.get('arquivo');
        if(a&&typeof a!=='string'){
          const c=await caches.open(C);
          await c.put(ARQ,new Response(a,{headers:{'Content-Type':a.type||'application/octet-stream','X-Nome':encodeURIComponent(a.name||'documento')}}));
          return Response.redirect('${BASE}?recebido=1',303)
        }
      }catch(_){}
      return Response.redirect('${BASE}?sem_arquivo=1',303)
    })());
    return
  }
  if(e.request.method==='GET'&&u.origin===location.origin&&u.pathname==='${BASE}'){
    e.respondWith(fetch(e.request).catch(()=>caches.match('${BASE}')))
  }
});`;

async function handle(req,res,u){
  const p=u.pathname;
  if(p!=='/compartilhar'&&!p.startsWith(BASE))return false;
  if(req.method==='GET'&&(p==='/compartilhar'||p===BASE)){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(PAGINA);return true
  }
  if(req.method==='GET'&&p===BASE+'manifest.json'){
    res.writeHead(200,{'Content-Type':'application/manifest+json','Cache-Control':'no-cache'});res.end(MANIFESTO);return true
  }
  if(req.method==='GET'&&p===BASE+'sw.js'){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':BASE});res.end(SW);return true
  }
  if(req.method==='GET'&&ICONES[p]){
    res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});res.end(ICONES[p]);return true
  }
  // Sem o service worker (app recém-instalado e ainda não aberto) o arquivo chega aqui: a tela explica.
  if(req.method==='POST'&&p===BASE+'receber'){
    req.resume();
    res.writeHead(303,{Location:BASE+'?sem_sw=1','Cache-Control':'no-store'});res.end();return true
  }
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Não encontrado');return true
}

module.exports={handle,MANIFESTO};
