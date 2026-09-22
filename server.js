const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),net=require('net'),dns=require('dns').promises,{spawn}=require('child_process'),crypto=require('crypto');
const {URL}=require('url');
const PORT=process.env.PORT||3000;
const ID=process.env.SPREADSHEET_ID||'1miU5AW514LbRk5UsXYsVgXL1JTj_ZJgafRmBDF-tzWU';
const GIDS={lancamentos:824972758,agendamentos:1232883750,ajudantes:438556395};
const PUB=path.join(__dirname,'public');
const COLETAS_PORTAL_URL=process.env.COLETAS_PORTAL_URL||'https://controle-coletas-jr.onrender.com';
const SSW_TOKEN_URL=process.env.SSW_TOKEN_URL||'https://ssw.inf.br/api/generateToken';
let SSW_CACHE={token:'',expires:0};
let BI2_STATE={configured:false,connected:false,fileCount:0,lastCheck:null,message:'BI2 aguardando verificação'};
let BI2_API_STATE={connected:false,lastCheck:null,reports:[],message:'WebAPI BI2 aguardando verificação'};
const BI2_DAY_CACHE=new Map();
const BI2_DAY_INFLIGHT=new Map();
const SSW_DRIVER_CACHE=new Map();
const SSW_TRACK_CACHE=new Map();
async function fetchMotoristasVeiculos(){
  const u=new URL('/api/painel/motoristas-veiculos',COLETAS_PORTAL_URL);
  const r=await fetch(u,{headers:{'User-Agent':'CONSTRULOG-Dashboard/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
  return j.rows||[];
}
async function fetchColetasStatus(from='',to=''){
  const u=new URL('/api/painel/coletas-status-resumo',COLETAS_PORTAL_URL);
  if(from)u.searchParams.set('from',from);
  if(to)u.searchParams.set('to',to);
  const r=await fetch(u,{headers:{'User-Agent':'CONSTRULOG-Dashboard/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
  return j;
}
function internalSswConfigured(){return !!(process.env.SSW_INTERNAL_DOMINIO&&process.env.SSW_INTERNAL_CPF&&process.env.SSW_INTERNAL_USUARIO&&process.env.SSW_INTERNAL_SENHA)}
async function testInternalSswLogin(){
  const jar=new Map();
  const apply=(headers)=>{
    const list=typeof headers.getSetCookie==='function'?headers.getSetCookie():(headers.get('set-cookie')?[headers.get('set-cookie')]:[]);
    for(const raw of list){const pair=String(raw).split(';')[0],i=pair.indexOf('=');if(i>0)jar.set(pair.slice(0,i).trim(),pair.slice(i+1).trim())}
  };
  const cookie=()=>[...jar.entries()].map(([k,v])=>k+'='+v).join('; ');
  const init=await fetch('https://sistema.ssw.inf.br/bin/ssw0422',{
    headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36'},
    redirect:'manual',signal:AbortSignal.timeout(15000)
  });
  apply(init.headers);
  const body=new URLSearchParams({
    act:'L',
    f1:process.env.SSW_INTERNAL_DOMINIO||'',
    f2:String(process.env.SSW_INTERNAL_CPF||'').replace(/\D/g,''),
    f3:process.env.SSW_INTERNAL_USUARIO||'',
    f4:process.env.SSW_INTERNAL_SENHA||''
  });
  const r=await fetch('https://sistema.ssw.inf.br/bin/ssw0422',{
    method:'POST',
    headers:{
      'Content-Type':'application/x-www-form-urlencoded',
      'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36',
      'Referer':'https://sistema.ssw.inf.br/bin/ssw0422',
      'Cookie':cookie()
    },
    body:body.toString(),
    redirect:'manual',
    signal:AbortSignal.timeout(15000)
  });
  apply(r.headers);
  const txt=await r.text();
  const names=[...jar.keys()];
  const ok=jar.has('token');
  let menu={status:0,hints:[]};
  if(ok){
    const mr=await fetch('https://sistema.ssw.inf.br/bin/menu01',{
      headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Cookie':cookie(),'Referer':'https://sistema.ssw.inf.br/bin/ssw0422'},
      redirect:'manual',signal:AbortSignal.timeout(15000)
    });
    apply(mr.headers);
    const html=await mr.text();
    const hints=[];
    const re=/(href|onclick)=["']([^"']*(?:f3=0*38|op(?:cao)?=0*38|\b38\b)[^"']*)["']/ig;
    let m;while((m=re.exec(html))&&hints.length<10)hints.push(m[2].replace(/\s+/g,' ').slice(0,220));
    const textHit=html.match(/.{0,120}(?:38\s*[-–:]?\s*BAIXA DE ENTREGAS|BAIXA DE ENTREGAS).{0,220}/i);
    if(textHit)hints.push(textHit[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,320));
    const option38={};
    for(const unidade of ['AMR','MTZ']){
      try{
        const rr=await fetch('https://sistema.ssw.inf.br/bin/menu01?act=TRO&f2='+unidade+'&f3=38',{
          headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Cookie':cookie(),'Referer':'https://sistema.ssw.inf.br/bin/menu01'},
          redirect:'manual',signal:AbortSignal.timeout(15000)
        });
        apply(rr.headers);
        const ot=await rr.text();
        let page=null;
        const pm=(ot.match(/ssw\d+/i)||[])[0]||'';
        if(pm){
          const pr=await fetch('https://sistema.ssw.inf.br/bin/'+pm,{
            headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Cookie':cookie(),'Referer':'https://sistema.ssw.inf.br/bin/menu01'},
            redirect:'manual',signal:AbortSignal.timeout(15000)
          });
          apply(pr.headers);
          const pt=await pr.text();
          page={status:pr.status,bytes:Buffer.byteLength(pt),baixa:/baixa/i.test(pt),entrega:/entrega/i.test(pt),romaneio:/romaneio/i.test(pt),linhas:Math.max(0,pt.toLowerCase().split('<tr').length-1),celulas:Math.max(0,pt.toLowerCase().split('<td').length-1)};
        }
        option38[unidade]={status:rr.status,bytes:Buffer.byteLength(ot),page};
      }catch(e){option38[unidade]={error:String(e.message||e)}}
    }
    menu={status:mr.status,hints:[...new Set(hints)],option38};
  }
  return{
    ok,status:r.status,cookieNames:names,
    loginForm:/ssw0422|name=["']f4["']/i.test(txt),
    credError:/senha.{0,20}(inv[aá]lid|incorret)|usu[aá]rio.{0,20}(inv[aá]lid|incorret)|acesso.{0,20}negad/i.test(txt),
    menu
  }
}

function htmlText38(s){
  let x=String(s||'').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&#39;/gi,"'");
  x=x.replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&');
  return x.replace(/\s+/g,' ').trim();
}
function norm38(s){return htmlText38(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function parseSsw38Xml(xml){
  const rows=[];
  for(const rm of String(xml||'').matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/gi)){
    const raw=rm[1],fields={};
    for(const fm of raw.matchAll(/<f(\d+)\b[^>]*>([\s\S]*?)<\/f\1>/gi))fields[fm[1]]=htmlText38(fm[2]);
    const get=n=>fields[String(n)]||'';
    const rawAll=[...raw.matchAll(/<f\d+\b[^>]*>([\s\S]*?)<\/f\d+>/gi)].map(m=>String(m[1]||'').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&')).join(' ');
    let seqRomaneio='';
    const pats=[
      /seq_romaneio(?:\.value)?\s*=\s*["']?(\d+)/i,
      /[?&]seq_romaneio=(\d+)/i,
      /getElementById\(["']seq_romaneio["']\)\.value\s*=\s*["']?(\d+)/i
    ];
    for(const re of pats){const m=rawAll.match(re);if(m){seqRomaneio=m[1];break}}
    const romaneio=get(0),veiculo=get(1),carreta=get(2),inclusao=get(3),modelo=get(4),motorista=get(5),qtde=Number(get(6).replace(/\D/g,''))||0,falta=Number(get(7).replace(/\D/g,''))||0;
    if(romaneio&&motorista&&qtde)rows.push({romaneio,veiculo,carreta,inclusao,modelo,motorista,qtdeCtrcs:qtde,faltaOcorr:falta,seqRomaneio});
  }
  return{rows};
}
function parseSsw38Table(html){
  const trs=[...String(html||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1]);
  const parsed=trs.map(row=>[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>htmlText38(m[1])));
  let hi=parsed.findIndex(cells=>cells.some(x=>norm38(x)==='ROMANEIO')&&cells.some(x=>norm38(x).includes('MOTORISTA')));
  if(hi<0)hi=parsed.findIndex(cells=>cells.some(x=>norm38(x).includes('QTDE CTRC')));
  if(hi<0)return{rows:[],headers:[]};
  const h=parsed[hi],idx=(re)=>h.findIndex(x=>re.test(norm38(x)));
  const ir=idx(/^ROMANEIO$/),iv=idx(/^VEICULO$/),ii=idx(/^INCLUSAO$/),im=idx(/MOTORISTA/),iq=idx(/QTDE.*CTRC/),ifalta=idx(/FALTA.*OCOR/);
  const rows=[];
  for(const cells of parsed.slice(hi+1)){
    const rom=ir>=0?cells[ir]:'',mot=im>=0?cells[im]:'',qraw=iq>=0?cells[iq]:'';
    if(!rom||!/^AMR/i.test(rom)||!mot)continue;
    const q=Number(String(qraw).replace(/\D/g,''))||0;
    rows.push({romaneio:rom,veiculo:iv>=0?cells[iv]:'',inclusao:ii>=0?cells[ii]:'',motorista:mot,qtdeCtrcs:q,faltaOcorr:ifalta>=0?(Number(String(cells[ifalta]||'').replace(/\D/g,''))||0):0});
  }
  return{rows,headers:h};
}
async function fetchSsw38Rows(){
  if(!internalSswConfigured())throw new Error('Credenciais internas SSW não configuradas');
  const jar=new Map(),apply=headers=>{const list=typeof headers.getSetCookie==='function'?headers.getSetCookie():(headers.get('set-cookie')?[headers.get('set-cookie')]:[]);for(const raw of list){const pair=String(raw).split(';')[0],i=pair.indexOf('=');if(i>0)jar.set(pair.slice(0,i).trim(),pair.slice(i+1).trim())}},cookie=()=>[...jar.entries()].map(([k,v])=>k+'='+v).join('; ');
  let r=await fetch('https://sistema.ssw.inf.br/bin/ssw0422',{headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36'},redirect:'manual',signal:AbortSignal.timeout(15000)});apply(r.headers);
  const body=new URLSearchParams({act:'L',f1:process.env.SSW_INTERNAL_DOMINIO||'',f2:String(process.env.SSW_INTERNAL_CPF||'').replace(/\D/g,''),f3:process.env.SSW_INTERNAL_USUARIO||'',f4:process.env.SSW_INTERNAL_SENHA||''});
  r=await fetch('https://sistema.ssw.inf.br/bin/ssw0422',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Referer':'https://sistema.ssw.inf.br/bin/ssw0422','Cookie':cookie()},body:body.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});apply(r.headers);await r.text();if(!jar.has('token'))throw new Error('Login interno SSW não aceito');
  r=await fetch('https://sistema.ssw.inf.br/bin/menu01?act=TRO&f2=AMR&f3=38',{headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Cookie':cookie(),'Referer':'https://sistema.ssw.inf.br/bin/menu01'},redirect:'manual',signal:AbortSignal.timeout(15000)});apply(r.headers);const nav=await r.text();const prog=(nav.match(/ssw\d+/i)||[])[0]||'ssw0198';
  r=await fetch('https://sistema.ssw.inf.br/bin/'+prog,{headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Cookie':cookie(),'Referer':'https://sistema.ssw.inf.br/bin/menu01'},redirect:'manual',signal:AbortSignal.timeout(15000)});apply(r.headers);const html=await r.text();
  const inputDefs=[...html.matchAll(/<input\b([^>]*)>/gi)].map(m=>{const a=m[1]||'';return{name:(a.match(/\bname=["']?([^"'\s>]+)/i)||[])[1]||'',id:(a.match(/\bid=["']?([^"'\s>]+)/i)||[])[1]||'',type:(a.match(/\btype=["']?([^"'\s>]+)/i)||[])[1]||'',max:(a.match(/\bmaxlength=["']?([^"'\s>]+)/i)||[])[1]||''}}).filter(x=>x.name||x.id);
  console.log('SSW38 inputs: '+JSON.stringify(inputDefs));
  const ax=html.search(/function\s+ajaxEnvia\s*\(/i);
  if(ax>=0)console.log('SSW38 ajaxEnvia fn: '+html.slice(ax,ax+5200).replace(/\s+/g,' '));

  let p=parseSsw38Table(html);
  if(!p.rows.length){
    try{
      const params=new URLSearchParams();
      const inputs=[...html.matchAll(/<input\b([^>]*)>/gi)];
      for(const m of inputs){
        const a=m[1]||'',nm=(a.match(/\bname=["']?([^"'\s>]+)/i)||[])[1],val=(a.match(/\bvalue=["']([^"']*)["']/i)||a.match(/\bvalue=([^\s>]+)/i)||[])[1]||'';
        if(nm&&!/^(?:button|submit)$/i.test((a.match(/\btype=["']?([^"'\s>]+)/i)||[])[1]||''))params.set(nm,htmlText38(val));
      }
      params.set('act','ROM_ALL');
      const rr=await fetch('https://sistema.ssw.inf.br/bin/'+prog,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Referer':'https://sistema.ssw.inf.br/bin/'+prog,'Cookie':cookie()},body:params.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});
      apply(rr.headers);const body38=await rr.text();
      p=parseSsw38Table(body38);
      if(!p.rows.length)p=parseSsw38Xml(body38);
      if(p.rows.length){
        try{
          const fr=(body38.match(/<r\b[^>]*>([\s\S]*?)<\/r>/i)||[])[1]||'',attrs={};
          for(const fm of fr.matchAll(/<f(\d+)\b([^>]*)>([\s\S]*?)<\/f\1>/gi)){
            const n=Number(fm[1]);if(n<0||n>17)continue;
            const a=fm[2]||'',inner=String(fm[3]||'').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
            const names=[...a.matchAll(/\b([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=/g)].map(x=>x[1]);
            const programs=[...new Set([...a.matchAll(/ssw\d{3,6}/gi),...inner.matchAll(/ssw\d{3,6}/gi)].map(x=>x[0]))];
            const params=[...new Set([...a.matchAll(/\b(nro_romaneio|seq_romaneio|nro_ctrc|seq_ctrc|placa|act|origem)\b/gi),...inner.matchAll(/\b(nro_romaneio|seq_romaneio|nro_ctrc|seq_ctrc|placa|act|origem)\b/gi)].map(x=>x[1]))];
            const funcs=[...new Set([...a.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g),...inner.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(x=>x[1]).filter(x=>!['Number','String'].includes(x)))];
            const ajaxActs=[...new Set([...a.matchAll(/ajaxEnvia\(\s*["']([^"']+)/gi),...inner.matchAll(/ajaxEnvia\(\s*["']([^"']+)/gi)].map(x=>x[1]))];
            const actAssignments=[...new Set([...a.matchAll(/(?:\.act|\bact)\s*(?:\.value)?\s*=\s*["']([A-Za-z0-9_:-]+)["']/gi),...inner.matchAll(/(?:\.act|\bact)\s*(?:\.value)?\s*=\s*["']([A-Za-z0-9_:-]+)["']/gi)].map(x=>x[1]))];
            const actionPrograms=[...new Set([...a.matchAll(/(?:\.action|action)\s*=\s*["'][^"']*(ssw\d{3,6})/gi),...inner.matchAll(/(?:\.action|action)\s*=\s*["'][^"']*(ssw\d{3,6})/gi)].map(x=>x[1]))];
            const openPrograms=[...new Set([...a.matchAll(/(?:window\.open|open)\s*\(\s*["'][^"']*(ssw\d{3,6})/gi),...inner.matchAll(/(?:window\.open|open)\s*\(\s*["'][^"']*(ssw\d{3,6})/gi)].map(x=>x[1]))];
            attrs['f'+n]={attrNames:[...new Set(names)],programs,params,funcs:funcs.slice(0,12),ajaxActs,actAssignments,actionPrograms,openPrograms,textLen:htmlText38(inner).length};
          }
          console.log('SSW38 controles romaneio: '+JSON.stringify(attrs));
          try{
            const f0m=(fr.match(/<f0\b[^>]*>([\s\S]*?)<\/f0>/i)||[])[1]||'';
            const d0=String(f0m).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
            const href0=(d0.match(/href=["']([^"']+)["']/i)||[])[1]||'';
            const quoted=[...new Set([...d0.matchAll(/["']([A-Z][A-Z0-9_:-]{1,14})["']/g)].map(x=>x[1]).filter(x=>!/^AMR/i.test(x)))].slice(0,20);
            const actVals=[...new Set([...d0.matchAll(/(?:act(?:\.value)?|["']act["'])\s*(?:=|,|:)\s*["']([A-Za-z0-9_:-]+)["']/gi)].map(x=>x[1]))];
            let hrefInfo=null;try{if(href0){const u0=new URL(href0,'https://sistema.ssw.inf.br/bin/'+prog);hrefInfo={path:u0.pathname,paramNames:[...u0.searchParams.keys()],act:u0.searchParams.get('act')||''}}}catch{}
            console.log('SSW38 romaneio link f0: '+JSON.stringify({hrefInfo,quoted,actVals,hasAjax:/ajaxEnvia/i.test(d0),hasSsw0146:/ssw0146/i.test(d0)}));
            const call=(d0.match(/ajaxEnvia\(([^)]{0,320})\)/i)||[])[1]||'';
            const pc=d0.toLowerCase().indexOf('ssw0146'),ctx=pc>=0?d0.slice(Math.max(0,pc-180),pc+260):'';
            const cleanSkel=s=>String(s||'').replace(/AMR\d+-\d+/gi,'ROM').replace(/\b\d{2,}\b/g,'#').replace(/\s+/g,' ').slice(0,500);
            console.log('SSW38 f0 chamada: '+JSON.stringify({ajax:cleanSkel(call),contexto:cleanSkel(ctx)}));
          }catch{}
          const f13m=(fr.match(/<f13\b[^>]*>([\s\S]*?)<\/f13>/i)||[])[1]||'';
          const d13=String(f13m).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
          const href13=(d13.match(/href=["']([^"']+)["']/i)||[])[1]||'';
          if(href13){
            const url13=new URL(href13,'https://sistema.ssw.inf.br/bin/'+prog);
            const pr=await fetch(url13,{headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Cookie':cookie(),'Referer':'https://sistema.ssw.inf.br/bin/'+prog},redirect:'manual',signal:AbortSignal.timeout(15000)});
            apply(pr.headers);const pt=await pr.text();
            const headings=[...pt.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(x=>htmlText38(x[1])).filter(x=>x&&x.length<80).slice(0,40);
            const inputs13=[...pt.matchAll(/<input\b([^>]*)>/gi)].map(m=>{const a=m[1]||'';return{name:(a.match(/\bname=["']?([^"'\s>]+)/i)||[])[1]||'',id:(a.match(/\bid=["']?([^"'\s>]+)/i)||[])[1]||''}}).filter(x=>x.name||x.id).slice(0,30);
            console.log('SSW38 imprimir estrutura: '+JSON.stringify({status:pr.status,bytes:Buffer.byteLength(pt),program:url13.pathname.split('/').pop(),paramNames:[...url13.searchParams.keys()],xml:(pt.match(/<xml\b/gi)||[]).length,rows:(pt.match(/<tr\b/gi)||[]).length,cells:(pt.match(/<td\b/gi)||[]).length,r:(pt.match(/<r\b/gi)||[]).length,headings,inputs:inputs13,programs:[...new Set([...pt.matchAll(/ssw\d{3,6}/gi)].map(x=>x[0]))].slice(0,15)}));
          }
        }catch(e){console.log('SSW38 controles ERRO: '+e.message)}
      }
      if(p.rows.length){
        try{
          const fr=(body38.match(/<r\b[^>]*>([\s\S]*?)<\/r>/i)||[])[1]||'',f0=(fr.match(/<f0\b[^>]*>([\s\S]*?)<\/f0>/i)||[])[1]||'';
          const dec=String(f0).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
          const href=(dec.match(/href=["']([^"']+)/i)||[])[1]||'',onclick=(dec.match(/onclick=["']([\s\S]*?)["']/i)||[])[1]||'';
          const sets=[...dec.matchAll(/(?:nro_romaneio|seq_romaneio|act|qtde_ctrc)[^=]{0,15}=\s*["']?([^"' ;<]+)/gi)].map(m=>({field:(m[0].match(/nro_romaneio|seq_romaneio|act|qtde_ctrc/i)||[])[0]||'',kind:/^\d+$/.test(m[1])?'NUM':(/^[A-Z_]+$/i.test(m[1])?'CODE':'OTHER')}));
          console.log('SSW38 detalhe link: '+JSON.stringify({hasHref:!!href,hasOnclick:!!onclick,sets,actions:[...new Set([...dec.matchAll(/ajaxEnvia\(["']([^"']+)/gi)].map(x=>x[1]))]}));
          const f6=(fr.match(/<f6\b[^>]*>([\s\S]*?)<\/f6>/i)||[])[1]||'';
          const d6=String(f6).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
          const f6Acts=[...new Set([...d6.matchAll(/ajaxEnvia\(["']([^"']+)/gi)].map(x=>x[1]))];
          const f6Fns=[...new Set([...d6.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(x=>x[1]).filter(x=>!['Number','String'].includes(x)))];
          const f6Fields=[...new Set([...d6.matchAll(/\b(nro_romaneio|seq_romaneio|a_romaneio|act|qtde_ctrc)\b/gi)].map(x=>x[1]))];
          console.log('SSW38 qtde link: '+JSON.stringify({acts:f6Acts,fns:f6Fns,fields:f6Fields,hasHref:/href=/i.test(d6),hasOnclick:/onclick=/i.test(d6)}));
        }catch{}
      }
      if(p.rows.length){
        const first=p.rows[0],mm=String(first.romaneio||'').match(/^[A-Z]{3}0*(\d+)-(\d+)$/i);
        if(mm){
          const probes=[];
          for(const act of ['ROM','CTE','CTR','ROM_INT','PEN','DIS','CSV']){
            try{
              const pp=new URLSearchParams();
              const ims=[...html.matchAll(/<input\b([^>]*)>/gi)];
              for(const m of ims){const a=m[1]||'',nm=(a.match(/\bname=["']?([^"'\s>]+)/i)||[])[1],val=(a.match(/\bvalue=["']([^"']*)["']/i)||a.match(/\bvalue=([^\s>]+)/i)||[])[1]||'';if(nm)pp.set(nm,htmlText38(val))}
              pp.set('act',act);pp.set('nro_romaneio',mm[1]);pp.set('seq_romaneio',mm[2]);pp.set('qtde_ctrc',String(first.qtdeCtrcs||''));
              const ar=await fetch('https://sistema.ssw.inf.br/bin/'+prog,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Referer':'https://sistema.ssw.inf.br/bin/'+prog,'Cookie':cookie()},body:pp.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});
              apply(ar.headers);const at=await ar.text();
              const firstR=(at.match(/<r\b[^>]*>([\s\S]*?)<\/r>/i)||[])[1]||'',fields=[...firstR.matchAll(/<f(\d+)\b/gi)].map(x=>Number(x[1]));
              const inps=[...at.matchAll(/<input\b([^>]*)>/gi)].map(m=>{const a=m[1]||'';return{name:(a.match(/\bname=["']?([^"'\s>]+)/i)||[])[1]||'',id:(a.match(/\bid=["']?([^"'\s>]+)/i)||[])[1]||'',type:(a.match(/\btype=["']?([^"'\s>]+)/i)||[])[1]||''}}).filter(x=>x.name||x.id).slice(0,30);
              const acts=[...new Set([...at.matchAll(/ajaxEnvia\(["']([^"']+)/gi)].map(x=>x[1]))].slice(0,30);
              const progs=[...new Set([...at.matchAll(/ssw\d{3,6}/gi)].map(x=>x[0]))].slice(0,20);
              const title=htmlText38((at.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'');
              let mapStats=null;
              if(act==='PEN'){
                const roms=p.rows.map(x=>String(x.romaneio||'').toUpperCase()),plates=p.rows.map(x=>normPlate(x.veiculo)),drivers=p.rows.map(x=>norm38(x.motorista));
                const rr=[...at.matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/gi)].map(m=>{const o={};for(const fm of m[1].matchAll(/<f(\d+)\b[^>]*>([\s\S]*?)<\/f\1>/gi))o[fm[1]]=htmlText38(fm[2]);return o});
                const maxField=Math.max(0,...rr.flatMap(o=>Object.keys(o).map(Number)));
                const codeCounts={};for(const o of rr){const v=String(o['5']||'').trim();if(/^\d{1,3}$/.test(v))codeCounts[v]=(codeCounts[v]||0)+1}
                const rawFieldRefs={};
                for(const rm of at.matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/gi)){
                  for(const fm of rm[1].matchAll(/<f(\d+)\b[^>]*>([\s\S]*?)<\/f\1>/gi)){
                    const n=fm[1],raw=String(fm[2]||'').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
                    if(!rawFieldRefs[n])rawFieldRefs[n]={nro:0,seq:0,placa:0,motorista:0,codigo:0,seqOcor:0,href:0,onclick:0};
                    const z=rawFieldRefs[n];if(/nro_romaneio/i.test(raw))z.nro++;if(/seq_romaneio/i.test(raw))z.seq++;if(/\bplaca\b/i.test(raw))z.placa++;if(/motorista/i.test(raw))z.motorista++;if(/\bcodigo\b/i.test(raw))z.codigo++;if(/seq_ocor_entrega/i.test(raw))z.seqOcor++;if(/href=/i.test(raw))z.href++;if(/onclick=/i.test(raw))z.onclick++;
                  }
                }
                console.log('SSW38 PEN refs: '+JSON.stringify(rawFieldRefs));
                const expectedSizes=(p.rows||[]).map(x=>Number(x.qtdeCtrcs||0)).sort((a,b)=>a-b);
                const groupCandidates=[];
                const groupByFields=fs=>{
                  const m=new Map();for(const o of rr){const k=fs.map(n=>String(o[String(n)]||'')).join('|');if(!k.replace(/\|/g,''))continue;m.set(k,(m.get(k)||0)+1)}
                  return[...m.values()].sort((a,b)=>a-b);
                };
                for(let i=0;i<=12;i++){
                  const sizes=groupByFields([i]);if(sizes.length>=8&&sizes.length<=12)groupCandidates.push({key:'f'+i,groups:sizes.length,sizes});
                  for(let j=i+1;j<=12;j++){const s2=groupByFields([i,j]);if(s2.length>=8&&s2.length<=12)groupCandidates.push({key:'f'+i+'+f'+j,groups:s2.length,sizes:s2})}
                }
                console.log('SSW38 PEN grouping: '+JSON.stringify({expectedSizes,candidates:groupCandidates.slice(0,30)}));
                const classifyText=v=>{const s=norm38(v);if(/ENTREG/.test(s))return'ENTREGA';if(/TEMPO/.test(s))return'TEMPO';if(/RECUS/.test(s))return'RECUSA';if(/AUSENT|NAO ENCONTR/.test(s))return'AUSENTE';if(/ENDERE/.test(s))return'ENDERECO';if(/AGEND/.test(s))return'AGENDAMENTO';if(/DEVOL/.test(s))return'DEVOLUCAO';if(/AVARIA/.test(s))return'AVARIA';return'OUTRO'};
                const textCats={};for(const o of rr){const k=classifyText(o['10']||'');textCats[k]=(textCats[k]||0)+1}
                console.log('SSW38 PEN status: '+JSON.stringify({codeCounts,textCats}));
                mapStats=[];
                for(let n=0;n<=maxField;n++){
                  const vals=rr.map(o=>String(o[n]||'').trim()).filter(Boolean),up=vals.map(v=>v.toUpperCase()),norms=vals.map(norm38);
                  const numVals=vals.filter(v=>/^\d{1,4}$/.test(v));
                  const smallDistinct=[...new Set(numVals.map(v=>Number(v)).filter(v=>v<=999))].sort((a,b)=>a-b).slice(0,25);
                  mapStats.push({f:n,nonempty:vals.length,unique:new Set(vals).size,rom:up.filter(v=>roms.some(r=>r&&(v===r||v.includes(r)||r.includes(v)))).length,plate:vals.filter(v=>plates.includes(normPlate(v))).length,driver:norms.filter(v=>drivers.includes(v)).length,date:vals.filter(v=>/^\d{2}\/\d{2}\/\d{2,4}/.test(v)).length,time:vals.filter(v=>/^\d{1,2}:\d{2}/.test(v)).length,numeric:numVals.length,smallDistinct,avgLen:vals.length?Math.round(vals.reduce((a,v)=>a+v.length,0)/vals.length):0,maxLen:vals.reduce((a,v)=>Math.max(a,v.length),0)});
                }
              }
              probes.push({act,status:ar.status,bytes:Buffer.byteLength(at),xml:(at.match(/<xml\b/gi)||[]).length,rows:(at.match(/<r\b/gi)||[]).length,fields:fields.slice(0,30),title,inputs:inps,actions:acts,programs:progs,mapStats});
            }catch(e){probes.push({act,error:String(e.message||e)})}
          }
          console.log('SSW38 probe detalhe: '+JSON.stringify(probes));
          try{
            const direct=[];
            for(const x of p.rows.slice(0,3)){
              for(const val of [x.romaneio,String(x.romaneio||'').replace(/[^0-9]/g,'')]){
                const pp=new URLSearchParams({act:'ROM',a_romaneio:val});
                const rr=await fetch('https://sistema.ssw.inf.br/bin/'+prog,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Referer':'https://sistema.ssw.inf.br/bin/'+prog,'Cookie':cookie()},body:pp.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});
                const tt=await rr.text();
                direct.push({mode:val===x.romaneio?'codigo':'digitos',bytes:Buffer.byteLength(tt),xml:(tt.match(/<xml\b/gi)||[]).length,rows:(tt.match(/<r\b/gi)||[]).length,title:htmlText38((tt.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''),hasBaixa:/Baixa de Entregas/i.test(tt)});
              }
            }
            console.log('SSW38 ROM direto: '+JSON.stringify(direct));
            const navTests=[];
            const x=p.rows[0];
            for(const act of ['ROM_INT','CTE','CTR','PEN']){
              for(const val of [x.romaneio,String(x.romaneio||'').replace(/[^0-9]/g,'')]){
                try{
                  const pp=new URLSearchParams({act,a_romaneio:val,nro_romaneio:val});
                  const rr=await fetch('https://sistema.ssw.inf.br/bin/'+prog,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Referer':'https://sistema.ssw.inf.br/bin/'+prog,'Cookie':cookie()},body:pp.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});
                  const tt=await rr.text();
                  navTests.push({act,mode:val===x.romaneio?'codigo':'digitos',bytes:Buffer.byteLength(tt),xml:(tt.match(/<xml\b/gi)||[]).length,rows:(tt.match(/<r\b/gi)||[]).length,title:htmlText38((tt.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''),hasRom:/romaneio/i.test(tt),hasCte:/ctrc|cte/i.test(tt)});
                }catch(e){navTests.push({act,error:String(e.message||e)})}
              }
            }
            console.log('SSW38 ROM navegação: '+JSON.stringify(navTests));
          }catch(e){console.log('SSW38 ROM direto ERRO: '+e.message)}
        }
      }
      if(!p.rows.length){
        const first=(body38.match(/<r\b[^>]*>([\s\S]*?)<\/r>/i)||[])[1]||'';
        const shape={};
        for(const fm of first.matchAll(/<f(\d+)\b[^>]*>([\s\S]*?)<\/f\1>/gi)){
          const v=htmlText38(fm[2]),n=fm[1];
          shape['f'+n]=/^AMR\d/i.test(v)?'ROM':(/^[A-Z]{3}[A-Z0-9]\d[A-Z0-9]\d{2}$/i.test(v)?'PLACA':(/\d{2}\/\d{2}\/\d{2}/.test(v)?'DATA':(/^\d+$/.test(v)?'NUM':'TXT'+v.length)));
        }
        console.log('SSW38 ROM_ALL estrutura: '+JSON.stringify({status:rr.status,bytes:Buffer.byteLength(body38),xml:(body38.match(/<xml\b/gi)||[]).length,r:(body38.match(/<r\b/gi)||[]).length,shape}));
      }
    }catch(e){console.log('SSW38 ROM_ALL ERRO: '+e.message)}
  }
  if(!p.rows.length){
    const structure={
      bytes:Buffer.byteLength(html),
      xml:(html.match(/<xml\b/gi)||[]).length,
      rs:(html.match(/<rs\b/gi)||[]).length,
      r:(html.match(/<r\b/gi)||[]).length,
      f1:(html.match(/<f1\b/gi)||[]).length,
      f2:(html.match(/<f2\b/gi)||[]).length,
      f3:(html.match(/<f3\b/gi)||[]).length,
      f4:(html.match(/<f4\b/gi)||[]).length,
      f5:(html.match(/<f5\b/gi)||[]).length,
      tr:(html.match(/<tr\b/gi)||[]).length,
      td:(html.match(/<td\b/gi)||[]).length,
      table:(html.match(/<table\b/gi)||[]).length
    };
    const inputs=[...html.matchAll(/<input\b([^>]*)>/gi)].map(m=>{const a=m[1]||'';return{name:(a.match(/\bname=["']?([^"'\s>]+)/i)||[])[1]||'',id:(a.match(/\bid=["']?([^"'\s>]+)/i)||[])[1]||'',type:(a.match(/\btype=["']?([^"'\s>]+)/i)||[])[1]||''}}).filter(x=>x.name||x.id);
    const scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>m[1]);
    const bins=[...new Set([...html.matchAll(/(?:\/bin\/)?(ssw\d{3,6})/gi)].map(m=>m[1]))];
    const ajax=[...new Set([...html.matchAll(/ajaxEnvia\(["']([^"']+)/gi)].map(m=>m[1]))];
    const xhr=[...new Set([...html.matchAll(/(?:url|action|href)\s*[:=]\s*["']([^"']+)/gi)].map(m=>m[1]).filter(x=>/ssw|ajax|cgi|bin/i.test(x)))].slice(0,20);
    console.log('SSW38 estrutura: '+JSON.stringify({...structure,inputs,scripts,bins,ajax,xhr}));
    const pRom=html.indexOf('ROM_ALL'),pRomOne=html.indexOf("ajaxEnvia('ROM'");
    if(pRom>=0)console.log('SSW38 FORM ROM_ALL: '+html.slice(Math.max(0,pRom-1400),pRom+2200).replace(/\s+/g,' '));
    if(pRomOne>=0)console.log('SSW38 FORM ROM: '+html.slice(Math.max(0,pRomOne-1200),pRomOne+1800).replace(/\s+/g,' '));
    try{
      const jr=await fetch('https://sistema.ssw.inf.br/scripts/ssw0198_181124.js?v=18.11.24',{headers:{'User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36'},signal:AbortSignal.timeout(15000)});
      const js=await jr.text(),pos=js.indexOf('ROM_ALL');
      if(pos>=0)console.log('SSW38 JS ROM_ALL: '+js.slice(Math.max(0,pos-900),pos+1800).replace(/\s+/g,' '));
    }catch(e){console.log('SSW38 JS ERRO: '+e.message)}

  }
  const total=p.rows.reduce((a,x)=>a+x.qtdeCtrcs,0),motoristas=[...new Set(p.rows.map(x=>x.motorista))];
  console.log('SSW38 sequências: '+JSON.stringify({extraidas:p.rows.filter(x=>x.seqRomaneio).length,total:p.rows.length,unicas:new Set(p.rows.map(x=>x.seqRomaneio).filter(Boolean)).size}));
  try{
    const checks=[];
    for(const x of p.rows){
      if(!x.seqRomaneio)continue;
      const mm=String(x.romaneio||'').match(/^[A-Z]{3}0*(\d+)-/i),nro=mm?mm[1]:'';
      const pp=new URLSearchParams({act:'PEN',seq_romaneio:String(x.seqRomaneio),nro_romaneio:nro});
      const rr=await fetch('https://sistema.ssw.inf.br/bin/'+prog,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 Chrome/120 Safari/537.36','Referer':'https://sistema.ssw.inf.br/bin/'+prog,'Cookie':cookie()},body:pp.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});
      const tt=await rr.text();
      checks.push({esperado:Number(x.qtdeCtrcs||0),retornado:(tt.match(/<r\b/gi)||[]).length});
    }
    console.log('SSW38 PEN por romaneio: '+JSON.stringify(checks));
  }catch(e){console.log('SSW38 PEN por romaneio ERRO: '+e.message)}
  return{ok:true,rows:p.rows,total,motoristas:motoristas.length,romaneios:p.rows.length};
}
function sswConfig(){return{domain:process.env.SSW_DOMAIN||'',username:process.env.SSW_USERNAME||'',password:process.env.SSW_PASSWORD||'',cnpj:process.env.SSW_CNPJ_EDI||''}}
function sswConfigured(){const x=sswConfig();return !!(x.domain&&x.username&&x.password&&x.cnpj)}
function postJson(url,obj){return new Promise((ok,no)=>{const u=new URL(url),body=JSON.stringify(obj),q=https.request({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'User-Agent':'CONSTRULOG-Dashboard/1.0'}},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{let j;try{j=JSON.parse(b)}catch{j={raw:b}}if(r.statusCode>=200&&r.statusCode<300)return ok({status:r.statusCode,data:j});const msg=(j&&((j.message||j.erro||j.error)))||b||('HTTP '+r.statusCode);const e=new Error(String(msg));e.status=r.statusCode;e.data=j;no(e)})});q.setTimeout(20000,()=>q.destroy(new Error('Tempo esgotado ao conectar ao SSW')));q.on('error',no);q.write(body);q.end()})}
async function getSswToken(force=false){if(!sswConfigured())throw new Error('Credenciais SSW não configuradas');if(!force&&SSW_CACHE.token&&SSW_CACHE.expires>Date.now())return SSW_CACHE.token;const x=sswConfig(),r=await postJson(SSW_TOKEN_URL,{domain:x.domain,username:x.username,password:x.password,cnpj_edi:x.cnpj}),t=r.data&&(r.data.token||r.data.access_token);if(!t||typeof t!=='string')throw new Error('SSW respondeu sem token reconhecido');SSW_CACHE={token:t,expires:Date.now()+50*60*1000};return t}
function bi2Configured(){return !!(process.env.BI2_HOST&&process.env.BI2_USERNAME&&process.env.BI2_PASSWORD)}
function runBi2Sftp(commands='pwd\nls -la\nquit\n'){return new Promise((ok,no)=>{if(!bi2Configured())return no(new Error('Credenciais BI2 não configuradas'));const host=process.env.BI2_HOST,port=String(process.env.BI2_PORT||22),user=process.env.BI2_USERNAME;if(!/^[A-Za-z0-9._-]+$/.test(user)||!/^[A-Za-z0-9.-]+$/.test(host))return no(new Error('Host ou usuário BI2 inválido'));const ask='/tmp/construlog-bi2-askpass.sh';fs.writeFileSync(ask,'#!/bin/sh\nprintf \'%s\\n\' "$BI2_PASSWORD"\n',{mode:0o700});const p=spawn('sftp',['-q','-P',port,'-oBatchMode=no','-oStrictHostKeyChecking=accept-new','-oConnectTimeout=12',user+'@'+host],{env:{...process.env,SSH_ASKPASS:ask,SSH_ASKPASS_REQUIRE:'force',DISPLAY:':0'},stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{p.kill('SIGKILL');no(new Error('Tempo esgotado no SFTP BI2'))},20000);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',e=>{clearTimeout(timer);no(e)});p.on('close',code=>{clearTimeout(timer);try{fs.unlinkSync(ask)}catch{}if(code===0)return ok({ok:true,output:out.trim(),stderr:err.trim()});no(new Error((err||out||('SFTP encerrou com código '+code)).trim()))});p.stdin.end(commands)})}
async function inspectBi2Cliente(){if(!bi2Configured())return{ok:false,error:'BI2 não configurado'};try{const r=await runBi2Sftp('cd cliente\npwd\nls -la\nquit\n');const lines=r.output.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);return{ok:true,lines:lines.slice(0,80)}}catch(e){return{ok:false,error:String(e.message||e)}}}
async function refreshBi2State(){const configured=bi2Configured(),now=new Date().toISOString();if(!configured){BI2_STATE={configured:false,connected:false,fileCount:0,lastCheck:now,message:'BI2 aguardando credenciais'};return BI2_STATE}try{const r=await runBi2Sftp('ls -1\nquit\n'),lines=r.output.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^sftp>/i.test(x)&&!/^Remote working directory:/i.test(x));BI2_STATE={configured:true,connected:true,fileCount:lines.length,lastCheck:now,message:lines.length?'BI2 conectado • arquivos disponíveis':'BI2 conectado • aguardando arquivos do SSW'};return BI2_STATE}catch(e){BI2_STATE={configured:true,connected:false,fileCount:0,lastCheck:now,message:'Falha no BI2 SFTP',error:String(e.message||e)};return BI2_STATE}}
async function testBi2Login(){if(!bi2Configured())return{configured:false,connected:false,message:'BI2 aguardando credenciais'};try{const r=await runBi2Sftp();const lines=r.output.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);return{configured:true,connected:true,message:'BI2 SFTP conectado',sample:lines.slice(0,25)}}catch(e){return{configured:true,connected:false,message:'Falha no login BI2 SFTP',error:String(e.message||e)}}}
function probePort(host,port,timeout=4500){return new Promise(ok=>{const s=net.createConnection({host,port});let done=false;const end=(open,detail='')=>{if(done)return;done=true;s.destroy();ok({port,open,detail})};s.setTimeout(timeout,()=>end(false,'timeout'));s.on('connect',()=>end(true,'tcp'));s.on('error',e=>end(false,e.code||e.message))})}
async function probeBi2(){const host=process.env.BI2_HOST||'transfer.ssw.inf.br';let addresses=[];try{addresses=await dns.lookup(host,{all:true})}catch(e){return{ok:false,host,error:'DNS: '+e.message,ports:[]}}const ports=await Promise.all([21,22,990].map(p=>probePort(host,p)));return{ok:true,host,addresses:addresses.map(x=>x.address),ports}}
function fetchRaw(url,n=0){return new Promise((ok,no)=>{if(n>5)return no(new Error('Muitos redirecionamentos'));const q=https.get(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml,*/*','Cache-Control':'no-cache'}},r=>{if([301,302,303,307,308].includes(r.statusCode)&&r.headers.location){r.resume();return ok(fetchRaw(new URL(r.headers.location,url).toString(),n+1))}let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{if(r.statusCode<200||r.statusCode>=300)return no(new Error('HTTP '+r.statusCode));ok(b)})});q.setTimeout(20000,()=>q.destroy(new Error('Tempo esgotado')));q.on('error',no)})}
function parseDelimited(text,delim=';'){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch}else{if(ch==='"')quoted=true;else if(ch===delim){row.push(field);field=''}else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=ch}}if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}return rows}
function normKey(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim()}
function parseBi2Csv(text){const grid=parseDelimited(String(text||'').replace(/^\uFEFF/,''),';').filter(r=>r.some(v=>String(v).trim()));const meta=grid.find(r=>String(r[0]).trim()==='0')||[];const hi=grid.findIndex(r=>String(r[0]).trim()==='1');if(hi<0)return{meta:{},headers:[],rows:[]};const headers=grid[hi].slice(1).map((h,i)=>(String(h||'COL_'+(i+1)).trim()));const rows=grid.slice(hi+1).filter(r=>r.length>1&&String(r[0]).trim()!=='0'&&String(r[0]).trim()!=='1').map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i+1]??'').trim()])));return{meta:{sigla:meta[1]||'',empresa:meta[2]||'',relatorio:meta[3]||'',data:meta[4]||'',hora:meta[5]||''},headers,rows}}
function pickField(row,...aliases){const entries=Object.entries(row||{});for(const a of aliases){const na=normKey(a);const hit=entries.find(([k])=>normKey(k)===na);if(hit)return hit[1]}for(const a of aliases){const na=normKey(a);const hit=entries.find(([k])=>normKey(k).includes(na));if(hit)return hit[1]}return''}
function bi2Number(v){let s=String(v??'').replace(/R\$/gi,'').trim();if(!s)return 0;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');s=s.replace(/[^0-9.-]/g,'');return Number(s)||0}
function sumField(rows,aliases){return rows.reduce((a,r)=>a+bi2Number(pickField(r,...aliases)),0)}
function distinctCount(rows,aliases){const s=new Set();for(const r of rows){const v=pickField(r,...aliases);if(v)s.add(v)}return s.size}
function topCounts(rows,aliases,limit=10){const m={};for(const r of rows){const v=pickField(r,...aliases)||'Não informado';m[v]=(m[v]||0)+1}return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([label,value])=>({label,value}))}
function bi2DateRange(from,to,maxDays=62){const re=/^\d{4}-\d{2}-\d{2}$/;if(!re.test(from||'')||!re.test(to||''))return[];const a=new Date(from+'T12:00:00Z'),b=new Date(to+'T12:00:00Z');if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||a>b)return[];const out=[];for(let d=new Date(a);d<=b;d.setUTCDate(d.getUTCDate()+1)){out.push(d.toISOString().slice(0,10));if(out.length>maxDays)throw new Error('Período SSW limitado a '+maxDays+' dias por consulta')}return out}
function bi2CompactDate(s){return String(s||'').replace(/-/g,'')}
function bi2RowKey(r){return [pickField(r,'FILIAL'),pickField(r,'CTRC'),pickField(r,'NF'),pickField(r,'REMETENTE')].map(x=>String(x||'').trim()).join('|')}
async function fetchBi2DayParsed(codigo,ymd){const key=codigo+':'+ymd,hit=BI2_DAY_CACHE.get(key);if(hit&&Date.now()-hit.at<10*60*1000)return hit.value;if(BI2_DAY_INFLIGHT.has(key))return BI2_DAY_INFLIGHT.get(key);const task=(async()=>{try{const rep=await fetchBi2Report(codigo,bi2CompactDate(ymd)),p=parseBi2Csv(rep.text),value={ok:true,date:ymd,bytes:rep.bytes,meta:p.meta,rows:p.rows,headers:p.headers};BI2_DAY_CACHE.set(key,{at:Date.now(),value});return value}catch(e){if(String(e.message||e).includes('HTTP 404')){const value={ok:false,date:ymd,missing:true,rows:[]};BI2_DAY_CACHE.set(key,{at:Date.now(),value});return value}throw e}finally{BI2_DAY_INFLIGHT.delete(key)}})();BI2_DAY_INFLIGHT.set(key,task);return task}
async function fetchBi2RangeParsed(codigo,from,to){const dates=bi2DateRange(from,to),snaps=[];for(let i=0;i<dates.length;i+=4){const part=await Promise.all(dates.slice(i,i+4).map(d=>fetchBi2DayParsed(codigo,d)));snaps.push(...part)}return snaps}
function mergeUniqueBi2Rows(snaps){const m=new Map();for(const s of snaps)for(const r of (s.rows||[])){const k=bi2RowKey(r);if(!m.has(k))m.set(k,r)}return[...m.values()]}
function bi2PeriodInfo(snaps,from,to){const available=snaps.filter(x=>x.ok),missing=snaps.filter(x=>x.missing);return{from,to,daysRequested:snaps.length,daysAvailable:available.length,daysMissing:missing.length,availableDates:available.map(x=>x.date),series:snaps.map(x=>({date:x.date,total:x.ok?(x.rows||[]).length:null}))}}
function bi2Auth(){const sigla=(process.env.BI2_COMPANY||process.env.BI2_USERNAME||'').toLowerCase(),pasta=process.env.BI2_FOLDER||'cliente',hash=crypto.createHash('md5').update(process.env.BI2_PASSWORD||'').digest('hex');return{sigla,pasta,auth:'Basic '+hash}}
function bi2ApiGet(url,authorization){return new Promise((ok,no)=>{const q=https.get(url,{headers:{'User-Agent':'CONSTRULOG-BI2/1.0','Accept':'text/csv,*/*','Authorization':authorization,'Cache-Control':'no-cache'}},r=>{let chunks=[];r.on('data',d=>chunks.push(Buffer.from(d)));r.on('end',()=>{const body=Buffer.concat(chunks);ok({status:r.statusCode||0,type:r.headers['content-type']||'',bytes:body.length,preview:body.toString('utf8',0,Math.min(body.length,250)).replace(/[\r\n]+/g,' | ')})})});q.setTimeout(20000,()=>q.destroy(new Error('Tempo esgotado na WebAPI BI2')));q.on('error',no)})}
async function fetchBi2ReportFolder(codigo,data='',folder='cliente'){if(!bi2Configured())throw new Error('BI2 não configurado');const a=bi2Auth(),q='?codigo='+encodeURIComponent(codigo)+(data?'&data='+encodeURIComponent(data):'');return new Promise((ok,no)=>{const url='https://ssw.inf.br/api/bi2/'+encodeURIComponent(a.sigla)+'/'+encodeURIComponent(folder)+q;const req=https.get(url,{headers:{'User-Agent':'CONSTRULOG-BI2/1.0','Accept':'text/csv,*/*','Authorization':a.auth,'Cache-Control':'no-cache'}},r=>{const chunks=[];r.on('data',d=>chunks.push(Buffer.from(d)));r.on('end',()=>{const body=Buffer.concat(chunks);if(r.statusCode!==200)return no(new Error('BI2 HTTP '+r.statusCode));ok({text:body.toString('utf8'),bytes:body.length,type:r.headers['content-type']||''})})});req.setTimeout(20000,()=>req.destroy(new Error('Tempo esgotado na WebAPI BI2')));req.on('error',no)})}
async function fetchBi2Report(codigo,data=''){return fetchBi2ReportFolder(codigo,data,bi2Auth().pasta)}

function brDateToIso(v){
  const m=String(v||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if(!m)return'';
  const y=m[3].length===2?'20'+m[3]:m[3];
  return y+'-'+m[2]+'-'+m[1];
}
async function buildBi2Baixas(date=''){
  const target=date||new Date().toISOString().slice(0,10);
  let rep;
  try{rep=await fetchBi2ReportFolder(17,bi2CompactDate(target),bi2Auth().pasta)}
  catch(e){rep=await fetchBi2ReportFolder(17,'',bi2Auth().pasta)}
  const p=parseBi2Csv(rep.text),rows=p.rows||[];
  const todayRows=rows.filter(r=>brDateToIso(r['DATA ENTREGA'])===target);
  const base=todayRows.length?todayRows:rows;
  return{
    ok:true,source:'SSW BI2',codigo:17,date:target,reportDate:p.meta?.relatorio||'',reportTime:p.meta?.data||'',
    totalArquivo:rows.length,baixadasHoje:todayRows.length,usingToday:todayRows.length>0,
    filiais:topCounts(base,['UNIDADE DESTINO'],20),
    cidades:topCounts(base,['CIDADE DESTINO'],20),
    remetentes:topCounts(base,['REMETENTE'],20),
    rows:base.slice(0,1000).map(r=>({
      ctrc:r.CTRC||'',nf:r.NF||'',remetente:r.REMETENTE||'',destinatario:r.DESTINATARIO||'',
      cidade:r['CIDADE DESTINO']||'',uf:r['UF DESTINO']||'',unidade:r['UNIDADE DESTINO']||'',
      previsao:r['DATA PREVENTR']||'',entrega:r['DATA ENTREGA']||'',performance:r.PERFORMANCE||''
    }))
  }
}
function xmlDecode(v){return String(v||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')}
function xmlTag(block,tag){const m=String(block||'').match(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'));return m?xmlDecode(m[1].replace(/<[^>]+>/g,'').trim()):''}
function parseTrackingPayload(text){
  const raw=String(text||'').trim();
  if(!raw)return{success:false,items:[]};
  if(raw[0]==='{'||raw[0]==='['){
    try{
      const j=JSON.parse(raw),doc=j.documento||j.tracking||j;
      let items=doc.tracking||doc.items?.item||j.tracking?.items?.item||[];
      if(!Array.isArray(items))items=items?[items]:[];
      return{success:j.success!==false,items:items.map(x=>({data_hora:x.data_hora||x.data||'',ocorrencia:x.ocorrencia||x.descricao_ocorrencia||'',descricao:x.descricao||x.complemento||'',cidade:x.cidade||''}))}
    }catch{return{success:false,items:[]}}
  }
  const success=/<(?:success)>\s*true\s*<\/(?:success)>/i.test(raw);
  const items=[];
  const re=/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;let m;
  while((m=re.exec(raw)))items.push({data_hora:xmlTag(m[1],'data_hora'),ocorrencia:xmlTag(m[1],'ocorrencia'),descricao:xmlTag(m[1],'descricao'),cidade:xmlTag(m[1],'cidade')});
  if(!items.length){
    const re2=/<tracking(?:\s[^>]*)?>([\s\S]*?)<\/tracking>/gi;while((m=re2.exec(raw)))items.push({data_hora:xmlTag(m[1],'data_hora'),ocorrencia:xmlTag(m[1],'ocorrencia'),descricao:xmlTag(m[1],'descricao'),cidade:xmlTag(m[1],'cidade')});
  }
  return{success,items}
}
function trackingFlags(items){
  let saiu=false,entregue=false,last=null;
  for(const it of items||[]){
    const txt=(String(it.ocorrencia||'')+' '+String(it.descricao||'')).toUpperCase();
    if(/SA[IÍ]DA PARA ENTREGA|\(0?85\)|\b085\b/.test(txt))saiu=true;
    if(/MERCADORIA ENTREGUE|ENTREGA REALIZADA COM RESSALVA|\(0?1\)|\(0?37\)|\b001\b|\b037\b/.test(txt)){entregue=true;saiu=true}
    last=it;
  }
  return{saiu,entregue,last}
}
function postForm(url,params){
  return new Promise((ok,no)=>{
    const u=new URL(url),body=params.toString();
    const q=https.request({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/xml,text/xml,application/json,*/*','Content-Length':Buffer.byteLength(body),'User-Agent':'CONSTRULOG-SSW-Tracking/1.0'}},r=>{
      let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{if(r.statusCode>=200&&r.statusCode<300)return ok(b);no(new Error('SSW tracking HTTP '+r.statusCode))})
    });
    q.setTimeout(15000,()=>q.destroy(new Error('Tempo esgotado no rastreamento SSW')));q.on('error',no);q.write(body);q.end()
  })
}
async function trackingDestQuery(cnpj,nf){
  const doc=String(cnpj||'').replace(/\D/g,''),n=String(nf||'').trim();
  if(doc.length!==14||!n)return{ok:false,items:[],saiu:false,entregue:false};
  const key=doc+'|'+n,hit=SSW_TRACK_CACHE.get(key),ttl=hit?.value?.entregue?10*60*1000:90*1000;
  if(hit&&Date.now()-hit.at<ttl)return hit.value;
  const body=new URLSearchParams();body.append('cnpjdest',doc);body.append('cnpj',doc);body.append('NR',n);body.append('nro_nf',n);body.append('urlori','https://ssw.inf.br/ajuda/rastreamentodestnf.html');
  try{
    const raw=await postForm('https://ssw.inf.br/api/trackingdest',body),p=parseTrackingPayload(raw),f=trackingFlags(p.items);
    const value={ok:p.success!==false,items:p.items,saiu:f.saiu,entregue:f.entregue,last:f.last||null};
    SSW_TRACK_CACHE.set(key,{at:Date.now(),value});return value
  }catch(e){
    const value={ok:false,items:[],saiu:false,entregue:false,error:String(e.message||e)};
    SSW_TRACK_CACHE.set(key,{at:Date.now(),value});return value
  }
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out
}
function normCtrc(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
function normPlate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
async function fetchBi2FolderDayParsed(codigo,folder,ymd){
  try{
    const rep=await fetchBi2ReportFolder(codigo,bi2CompactDate(ymd),folder),p=parseBi2Csv(rep.text);
    return{ok:true,date:ymd,rows:p.rows,meta:p.meta,bytes:rep.bytes}
  }catch(e){
    if(String(e.message||e).includes('HTTP 404'))return{ok:false,date:ymd,missing:true,rows:[]};
    throw e
  }
}
async function buildSswMotoristas(from='',to=''){
  const today=new Date().toISOString().slice(0,10);
  from=from||today;to=to||today;
  const cacheKey='online|'+from+'|'+to,hit=SSW_DRIVER_CACHE.get(cacheKey);
  if(hit&&Date.now()-hit.at<90000)return hit.value;

  let base38=null;
  if(internalSswConfigured()&&to===today){
    try{base38=await fetchSsw38Rows()}catch{}
  }

  const dates=bi2DateRange(from,to,31),snaps174=[],snaps17=[];
  for(let i=0;i<dates.length;i+=4){
    const ds=dates.slice(i,i+4);
    const pair=await Promise.all([
      Promise.all(ds.map(d=>fetchBi2FolderDayParsed(174,'ctrc',d))),
      Promise.all(ds.map(d=>fetchBi2FolderDayParsed(17,bi2Auth().pasta,d)))
    ]);
    snaps174.push(...pair[0]);snaps17.push(...pair[1]);
  }

  let baseRows=[];
  snaps174.filter(x=>x.ok).forEach(s=>baseRows.push(...(s.rows||[])));
  if(!baseRows.length){
    try{baseRows=parseBi2Csv((await fetchBi2ReportFolder(174,'','ctrc')).text).rows||[]}catch{}
  }

  const ctrcMap=new Map();
  for(const r of baseRows){
    const k=normCtrc(r.numero_ctrc||r.CTRC);
    if(k)ctrcMap.set(k,r);
  }

  let candidates=[...ctrcMap.values()].filter(r=>{
    const d=brDateToIso(r.prev_ent||r['PREV ENTREGA']||r['PREVISAO ENTREGA']);
    return d&&d>=from&&d<=to;
  });
  if(!candidates.length&&from===today&&to===today){
    candidates=[...ctrcMap.values()].filter(r=>brDateToIso(r.prev_ent||'')===today);
  }

  const unique=[];
  const seen=new Set();
  for(const r of candidates){
    const doc=String(r.dest_cnpj||r['CNPJ DESTINATARIO']||'').replace(/\D/g,'');
    const nf=String(r.numero_nf||r.NF||'').trim();
    const k=doc+'|'+nf;
    if(doc.length===14&&nf&&!seen.has(k)){seen.add(k);unique.push(r)}
  }

  const trackingResults=await mapLimit(unique,8,async r=>{
    const tr=await trackingDestQuery(r.dest_cnpj||r['CNPJ DESTINATARIO'],r.numero_nf||r.NF);
    return{r,tr}
  });

  let driverRows=[];try{driverRows=await fetchMotoristasVeiculos()}catch{}
  const driverMap=new Map(driverRows.map(x=>[normPlate(x.placa),String(x.motorista||'').trim()]));
  let vehicleRows=[];try{vehicleRows=parseBi2Csv((await fetchBi2ReportFolder(245,'','tabelas')).text).rows||[]}catch{}
  const vehicleMap=new Map(vehicleRows.map(x=>[normPlate(x.PLACA),x]));

  const rows=[];
  let trackingOk=0;
  for(const item of trackingResults){
    const r=item.r,tr=item.tr||{};
    if(tr.ok)trackingOk++;
    const last=tr.last||{};
    const occ=String(last.ocorrencia||'').trim();
    const codeMatch=occ.match(/\((\d{1,3})\)/);
    const rawCode=codeMatch?codeMatch[1]:'';
    const plate=normPlate(r.veiculo_entrega),vehicle=vehicleMap.get(plate)||{};
    const saida=!!tr.saiu,entregue=!!tr.entregue;
    rows.push({
      ctrc:r.numero_ctrc||'',nf:r.numero_nf||'',remetente:r.remetente_nome||'',destinatario:r.destinatario_nome||'',
      cidade:r.cidade_destino||r.dest_cidade||'',uf:r.uf_destino||r.dest_uf||'',veiculo:plate||String(r.veiculo_entrega||'').trim(),
      motorista:driverMap.get(plate)||'',relacionamento:vehicle.RELACIONAMENTO||'',saida,entregue,
      ocorrenciaCodigo:rawCode,ocorrencia:occ||r.ult_ocorr_descricao||'',
      dataOcorrencia:String(last.data_hora||'').slice(0,10)||r.ult_ocorr_data||'',
      horaOcorrencia:String(last.data_hora||'').slice(11,16)||r.ult_ocorr_hora||'',
      previsao:r.prev_ent||'',dataEntrega:entregue?(String(last.data_hora||'').slice(0,10)||''):'',
      trackingOk:!!tr.ok
    });
  }

  const saiuRows=rows.filter(x=>x.saida||x.entregue);
  const groups=new Map();
  saiuRows.forEach(r=>{
    const k=r.motorista||r.veiculo||'Sem identificação';
    if(!groups.has(k))groups.set(k,{motorista:r.motorista||'',veiculo:r.veiculo||'',saidas:0,baixadas:0,pendentes:0,ocorrencias:0});
    const g=groups.get(k);g.saidas++;if(r.entregue)g.baixadas++;else{g.pendentes++;g.ocorrencias++}
  });

  const motoristas=[...groups.values()].map(g=>({...g,taxa:g.saidas?g.baixadas/g.saidas*100:0})).sort((a,b)=>b.saidas-a.saidas);
  const saidas=saiuRows.length,baixadas=rows.filter(x=>x.entregue).length,pendentes=saiuRows.filter(x=>!x.entregue).length;
  const occ={};saiuRows.filter(x=>!x.entregue).forEach(x=>{const k=(x.ocorrenciaCodigo?x.ocorrenciaCodigo+' - ':'')+(x.ocorrencia||'Sem ocorrência');occ[k]=(occ[k]||0)+1});

  const deliveredMap=new Map();
  snaps17.filter(x=>x.ok).forEach(s=>(s.rows||[]).forEach(r=>{const k=normCtrc(r.CTRC||r.numero_ctrc);if(k)deliveredMap.set(k,r)}));

  let motoristas38=[],totalRomaneado=0,romaneios38=[];
  if(base38&&base38.ok){
    romaneios38=base38.rows||[];totalRomaneado=base38.total||0;
    const gm=new Map();
    for(const x of romaneios38){
      const k=String(x.motorista||x.veiculo||'Não identificado').trim();
      if(!gm.has(k))gm.set(k,{motorista:x.motorista||'Não identificado',veiculo:x.veiculo||'',total:0,romaneios:[]});
      const g=gm.get(k);g.total+=Number(x.qtdeCtrcs||0);if(x.romaneio)g.romaneios.push(x.romaneio);if(!g.veiculo&&x.veiculo)g.veiculo=x.veiculo;
    }
    motoristas38=[...gm.values()].sort((a,b)=>b.total-a.total||a.motorista.localeCompare(b.motorista,'pt-BR'));
  }

  const value={
    ok:true,source:'SSW Tracking Online + BI2',from,to,daysRequested:dates.length,
    days174:snaps174.filter(x=>x.ok).length,days17:snaps17.filter(x=>x.ok).length,
    candidatos:unique.length,trackingConsultados:trackingResults.length,trackingOk,
    totalRomaneado,motoristas38,romaneios38,
    saidas,baixadas,baixasSsw:baixadas,baixasBi2:deliveredMap.size,pendentes,taxa:saidas?baixadas/saidas*100:0,
    veiculos:new Set(saiuRows.map(x=>x.veiculo).filter(Boolean)).size,
    motoristasIdentificados:new Set(saiuRows.map(x=>x.motorista).filter(Boolean)).size,
    motoristas,
    ocorrencias:Object.entries(occ).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([label,value])=>({label,value})),
    rows:rows.sort((a,b)=>Number(b.entregue)-Number(a.entregue)||String(b.dataOcorrencia).localeCompare(String(a.dataOcorrencia))).slice(0,1000),
    note:(totalRomaneado?'Opção 38: '+totalRomaneado+' CT-e(s) em '+romaneios38.length+' romaneio(s) • '+motoristas38.length+' motorista(s). ':'')+'Rastreamento on-line consultado para '+trackingOk+' de '+unique.length+' NF(s); status individual ainda depende da vinculação do CT-e ao romaneio.'
  };
  SSW_DRIVER_CACHE.set(cacheKey,{at:Date.now(),value});return value
}
async function buildBi2Remetentes(from='',to=''){let rows=[],meta={},period=null;if(from&&to){const snaps=await fetchBi2RangeParsed(13,from,to);rows=mergeUniqueBi2Rows(snaps);period=bi2PeriodInfo(snaps,from,to);const latest=[...snaps].reverse().find(x=>x.ok);meta=latest?latest.meta:{}}else{const rep=await fetchBi2Report(13),p=parseBi2Csv(rep.text);rows=p.rows;meta=p.meta}const groups=new Map();for(const r of rows){const nome=pickField(r,'REMETENTE')||'Não informado';if(!groups.has(nome))groups.set(nome,{remetente:nome,ctrcs:0,frete:0,valorMercadoria:0,volumes:0,peso:0,m3:0,atrasoTotal:0,atrasoN:0,cidades:new Set(),destinatarios:new Set()});const g=groups.get(nome);g.ctrcs++;g.frete+=bi2Number(pickField(r,'FRETE'));g.valorMercadoria+=bi2Number(pickField(r,'VAL MERC'));g.volumes+=bi2Number(pickField(r,'QTD VOLUMES'));g.peso+=bi2Number(pickField(r,'PESO'));g.m3+=bi2Number(pickField(r,'M3'));const av=bi2Number(pickField(r,'ATRASO'));if(av||String(pickField(r,'ATRASO')).trim()==='0'){g.atrasoTotal+=av;g.atrasoN++}const cid=pickField(r,'CIDADE DESTINO');if(cid)g.cidades.add(cid);const dst=pickField(r,'DESTINATARIO');if(dst)g.destinatarios.add(dst)}const clientes=[...groups.values()].map(g=>({remetente:g.remetente,ctrcs:g.ctrcs,frete:g.frete,valorMercadoria:g.valorMercadoria,volumes:g.volumes,peso:g.peso,m3:g.m3,atrasoMedio:g.atrasoN?g.atrasoTotal/g.atrasoN:0,cidades:g.cidades.size,destinatarios:g.destinatarios.size})).sort((a,b)=>b.ctrcs-a.ctrcs);const hist=period?' • '+period.daysAvailable+'/'+period.daysRequested+' dia(s) com arquivo BI2':'';return{ok:true,sourceCode:13,sourceName:meta.relatorio||'CT-es atrasados',limited:true,note:'Base atual do BI2: CT-es atrasados únicos observados no período. O relatório 083 de performance por cliente emitente ainda não está disponível.'+hist,meta,period,totalClientes:clientes.length,totalCtrcs:rows.length,totalFrete:sumField(rows,['FRETE']),totalMercadoria:sumField(rows,['VAL MERC']),totalVolumes:sumField(rows,['QTD VOLUMES']),clientes}}
async function buildBi2Atrasos(from='',to=''){let rows=[],meta={},bytes=0,headers=[],period=null;if(from&&to){const snaps=await fetchBi2RangeParsed(13,from,to);rows=mergeUniqueBi2Rows(snaps);period=bi2PeriodInfo(snaps,from,to);const latest=[...snaps].reverse().find(x=>x.ok);meta=latest?latest.meta:{};bytes=snaps.filter(x=>x.ok).reduce((a,x)=>a+(x.bytes||0),0);headers=latest?latest.headers:[]}else{const rep=await fetchBi2Report(13),p=parseBi2Csv(rep.text);rows=p.rows;meta=p.meta;bytes=rep.bytes;headers=p.headers}const clean=rows.slice(0,1000).map(r=>({filial:pickField(r,'FILIAL'),ctrc:pickField(r,'CTRC'),nf:pickField(r,'NF'),remetente:pickField(r,'REMETENTE'),pagador:pickField(r,'PAGADOR'),destinatario:pickField(r,'DESTINATARIO'),uf:pickField(r,'UF DESTINO','UF'),cidade:pickField(r,'CIDADE DESTINO','CIDADE'),entregaAgendada:pickField(r,'ENTREGA AGENDADA'),previsao:pickField(r,'PREVISAO ENTREGA','PREVISAO','DATA PREVISAO'),diasAtraso:pickField(r,'DIAS ATRASO','ATRASO'),unidadeAtual:pickField(r,'UNIDADE ATUAL'),localizacaoAtual:pickField(r,'LOCALIZACAO ATUAL'),ultimaOcorrencia:pickField(r,'COD ULTIMA OCORRENCIA'),instrucaoOcorrencia:pickField(r,'INSTRUCAO/COMPLEMENTO ULTIMA OCORRENCIA'),dataUltimaOcorrencia:pickField(r,'DATA ULTIMA OCORRENCIA'),responsabilidadeCliente:pickField(r,'RESPONSABILIDADE CLIENTE'),valorMercadoria:pickField(r,'VAL MERC'),frete:pickField(r,'FRETE'),volumes:pickField(r,'QTD VOLUMES'),peso:pickField(r,'PESO'),m3:pickField(r,'M3'),tipoDocumento:pickField(r,'TIPO DOCUMENTO')}));return{ok:true,codigo:13,bytes,meta,period,total:rows.length,filiaisCount:distinctCount(rows,['FILIAL']),cidadesCount:distinctCount(rows,['CIDADE DESTINO','CIDADE']),destinatariosCount:distinctCount(rows,['DESTINATARIO']),remetentesCount:distinctCount(rows,['REMETENTE']),valorMercadoria:sumField(rows,['VAL MERC']),freteTotal:sumField(rows,['FRETE']),volumesTotal:sumField(rows,['QTD VOLUMES']),pesoTotal:sumField(rows,['PESO']),m3Total:sumField(rows,['M3']),headers,filiais:topCounts(rows,['FILIAL'],12),cidades:topCounts(rows,['CIDADE DESTINO','CIDADE'],12),destinatarios:topCounts(rows,['DESTINATARIO'],12),remetentes:topCounts(rows,['REMETENTE'],12),localizacoes:topCounts(rows,['LOCALIZACAO ATUAL','UNIDADE ATUAL'],12),ocorrencias:topCounts(rows,['COD ULTIMA OCORRENCIA'],12),rows:clean}}
async function refreshBi2ApiState(){const now=new Date().toISOString();const x=await testBi2WebApi();if(x.ok&&Array.isArray(x.reports)){const good=x.reports.filter(r=>r.status===200&&/text\/csv/i.test(r.type));BI2_API_STATE={connected:good.length>0,lastCheck:now,reports:x.reports.map(r=>({codigo:r.codigo,status:r.status,bytes:r.bytes,type:r.type})),message:good.length?'WebAPI BI2 conectada':'WebAPI BI2 sem relatórios disponíveis'};}else{BI2_API_STATE={connected:false,lastCheck:now,reports:[],message:'Falha na WebAPI BI2',error:x.error||''}}return BI2_API_STATE}
async function testBi2WebApi(){if(!bi2Configured())return{ok:false,error:'BI2 não configurado'};try{const sigla=(process.env.BI2_COMPANY||process.env.BI2_USERNAME||'').toLowerCase(),pasta=process.env.BI2_FOLDER||'cliente',hash=crypto.createHash('md5').update(process.env.BI2_PASSWORD||'').digest('hex'),auth='Basic '+hash,base='https://ssw.inf.br/api/bi2/'+encodeURIComponent(sigla)+'/'+encodeURIComponent(pasta);const reports=[];for(const codigo of [13,16]){const r=await bi2ApiGet(base+'?codigo='+codigo,auth);reports.push({codigo,status:r.status,type:r.type,bytes:r.bytes,preview:r.preview})}return{ok:true,sigla,pasta,reports}}catch(e){return{ok:false,error:String(e.message||e)}}}
async function inspectBi2ApiDoc(){try{const html=await fetchRaw('https://ssw.inf.br/ajuda/bi2.html');const urls=[...html.matchAll(/https?:\/\/[^"'<>\s]+/gi)].map(m=>m[0]);const forms=[...html.matchAll(/<(?:form|input|button|select)[^>]*>/gi)].map(m=>m[0].replace(/\s+/g,' '));const textOnly=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();return{ok:true,urls:[...new Set(urls)].slice(0,40),forms:forms.slice(0,40),text:textOnly.slice(0,7000)}}catch(e){return{ok:false,error:String(e.message||e)}}}
async function inspectBi2Help(){try{const html=await fetchRaw('https://sistema.ssw.inf.br/ajuda/ssw2229.htm');const links=[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]).filter(x=>/bi2|webapi|api|bi/i.test(x));return{ok:true,links:[...new Set(links)].slice(0,50)}}catch(e){return{ok:false,error:String(e.message||e)}}}
function fetchText(url,n=0){return new Promise((ok,no)=>{if(n>5)return no(new Error('Muitos redirecionamentos'));const q=https.get(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/csv,text/plain,*/*','Cache-Control':'no-cache','Pragma':'no-cache'}},r=>{if([301,302,303,307,308].includes(r.statusCode)&&r.headers.location){r.resume();return ok(fetchText(new URL(r.headers.location,url).toString(),n+1))}let b='';r.setEncoding('utf8');r.on('data',c=>b+=c);r.on('end',()=>{if(r.statusCode<200||r.statusCode>=300)return no(new Error('Google Sheets respondeu '+r.statusCode));if(/<html|<!doctype/i.test(b.slice(0,300)))return no(new Error('Google retornou HTML em vez dos dados'));ok(b.replace(/^\uFEFF/,''))})});q.setTimeout(25000,()=>q.destroy(new Error('Tempo esgotado ao consultar Google Sheets')));q.on('error',no)})}
function csv(t){const a=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else{if(c==='"')q=true;else if(c===','){r.push(f);f=''}else if(c==='\n'){r.push(f.replace(/\r$/,''));a.push(r);r=[];f=''}else f+=c}}if(f.length||r.length){r.push(f.replace(/\r$/,''));a.push(r)}if(!a.length)return[];const h=a.shift().map((x,i)=>(x||('COL_'+(i+1))).trim());return a.filter(x=>x.some(v=>String(v).trim())).map(x=>Object.fromEntries(h.map((k,i)=>[k,x[i]??''])))}
async function rows(gid){let e;const cb=Date.now();for(const u of [`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=${gid}&cacheBust=${cb}`,`https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:csv&gid=${gid}&cacheBust=${cb}`]){try{const x=csv(await fetchText(u));if(x.length)return x;e=new Error('Aba sem linhas')}catch(err){e=err}}throw e}
http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://x');if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true}))}if(u.pathname==='/api/coletas/status'){try{const x=await fetchColetasStatus(u.searchParams.get('from')||'',u.searchParams.get('to')||'');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(x))}catch(e){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:false,error:String(e.message||e)}))}}if(u.pathname==='/api/bi2/baixas'){try{const x=await buildBi2Baixas(u.searchParams.get('date')||'');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(x))}catch(e){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:false,error:String(e.message||e)}))}}if(u.pathname==='/api/bi2/saidas-baixas'){try{const x=await buildSswMotoristas(u.searchParams.get('from')||'',u.searchParams.get('to')||'');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(x))}catch(e){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:false,error:String(e.message||e)}))}}if(u.pathname==='/api/bi2/remetentes'){try{const x=await buildBi2Remetentes(u.searchParams.get('from')||'',u.searchParams.get('to')||'');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(x))}catch(e){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:false,error:String(e.message||e)}))}}if(u.pathname==='/api/bi2/atrasos'){try{const x=await buildBi2Atrasos(u.searchParams.get('from')||'',u.searchParams.get('to')||'');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(x))}catch(e){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:false,error:String(e.message||e)}))}}if(u.pathname==='/api/bi2/api-status'){if(!BI2_API_STATE.lastCheck||Date.now()-new Date(BI2_API_STATE.lastCheck).getTime()>60*1000)await refreshBi2ApiState();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(BI2_API_STATE))}if(u.pathname==='/api/bi2/status'){if(!BI2_STATE.lastCheck||Date.now()-new Date(BI2_STATE.lastCheck).getTime()>5*60*1000)await refreshBi2State();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});const x=BI2_STATE,pub={configured:x.configured,connected:x.connected,fileCount:x.fileCount||0,lastCheck:x.lastCheck,message:x.message,error:x.error||''};return res.end(JSON.stringify(pub))}if(u.pathname==='/api/ssw/status'){const configured=sswConfigured();if(!configured){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,configured:false,connected:false,source:'google-sheets',message:'SSW aguardando credenciais'}))}try{await getSswToken(false);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,configured:true,connected:true,source:'ssw',message:'SSW conectado'}))}catch(e){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,configured:true,connected:false,source:'google-sheets',message:'SSW configurado, mas a autenticação falhou',error:String(e.message||e)}))}}if(u.pathname.startsWith('/api/sheet/')){const n=u.pathname.split('/').pop(),gid=GIDS[n];if(!gid){res.writeHead(404);return res.end()}try{const x=await rows(gid);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,rows:x,count:x.length}))}catch(e){res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:e.message}))}}let p=u.pathname==='/'?'index.html':u.pathname.slice(1);p=path.normalize(path.join(PUB,p));if(!p.startsWith(PUB)){res.writeHead(403);return res.end()}fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}const ext=path.extname(p);res.writeHead(200,{'Content-Type':ext==='.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Expires':'0'});res.end(d)})}catch(e){res.writeHead(500);res.end(e.message)}}).listen(PORT,'0.0.0.0',()=>{
  console.log('CONSTRULOG em '+PORT);if(internalSswConfigured())fetchSsw38Rows().then(x=>console.log('SSW38 validação: '+JSON.stringify({romaneios:x.romaneios,motoristas:x.motoristas,total:x.total}))).catch(e=>console.error('SSW38 validação ERRO: '+e.message));console.log('SSW interno configurado: '+(internalSswConfigured()?'SIM':'NAO'));

  refreshBi2State().catch(e=>console.error('BI2 SFTP monitor ERRO: '+e.message));
  refreshBi2ApiState().catch(e=>console.error('BI2 WebAPI monitor ERRO: '+e.message));
  setInterval(refreshBi2State,15*60*1000);
  setInterval(refreshBi2ApiState,60*1000);
});
