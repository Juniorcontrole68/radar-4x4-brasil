// SSW de mentira para testar a lógica de sessão (login, menu, opção 38) sem tocar no SSW real.
const http=require('http');
const PORT=Number(process.env.MOCK_PORT||10555);
let logins=0,seq=0,recusados=0;const tokens=new Map(),paths={};
const DATA={
  AMR:[['AMR001056-1','EYV3626','08/10/26','JAILSON MOREIRA DE SOUZA','12','5'],['AMR001057-1','FAB1A23','08/10/26','FABIANO TESTE','8','8']],
  TBT:[['TBT000321-1','TBT9Z99','08/10/26','ROGER TESTE','6','2']]
};
const page=rows=>'<html><body><form><input name="act" value=""><input name="dummy" value="1"></form><table><tr><th>Romaneio</th><th>Veículo</th><th>Inclusão</th><th>Motorista</th><th>Qtde CTRCs</th><th>Falta Ocorr.</th></tr>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table></body></html>';
const loginPage='<html><body><form action="ssw0422"><input name="f1"><input name="f2"><input name="f3"><input type="password" name="f4"></form></body></html>';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');paths[req.method+' '+u.pathname]=(paths[req.method+' '+u.pathname]||0)+1;
  let body='';for await(const c of req)body+=c;
  const tok=(String(req.headers.cookie||'').match(/(?:^|;\s*)token=([^;]+)/)||[])[1]||'';
  const send=(code,txt,h={})=>{res.writeHead(code,{'Content-Type':'text/html; charset=utf-8',...h});res.end(txt)};
  if(u.pathname==='/__mock/stats')return send(200,JSON.stringify({logins,recusados,activeTokens:tokens.size,paths}),{'Content-Type':'application/json'});
  if(u.pathname==='/__mock/expire'){tokens.clear();return send(200,'{}')}
  if(u.pathname==='/bin/ssw0422'&&req.method==='GET')return send(200,loginPage,{'Set-Cookie':'sid=s'+(++seq)+'; Path=/'});
  if(u.pathname==='/bin/ssw0422'&&req.method==='POST'){
    const p=new URLSearchParams(body);
    if(p.get('act')!=='L'||!p.get('f4')){recusados++;return send(200,loginPage)}
    logins++;const t='T'+logins;tokens.set(t,{unit:null});
    return send(200,'<html>ok</html>',{'Set-Cookie':'token='+t+'; Path=/'});
  }
  const st=tokens.get(tok);
  if(!st)return send(200,loginPage);                       // sessão expirada: devolve a tela de login
  if(u.pathname==='/bin/menu01'){st.unit=u.searchParams.get('f2');await sleep(150);return send(200,'<script>location="ssw0198"</script>')}
  if(u.pathname==='/bin/ssw0198'&&req.method==='GET'){await sleep(150);return send(200,page(DATA[st.unit]||[]))}
  if(u.pathname==='/bin/ssw0198'&&req.method==='POST')return send(200,'<xml></xml>');
  return send(404,'');
}).listen(PORT,'127.0.0.1',()=>console.log('SSW de teste em '+PORT));
