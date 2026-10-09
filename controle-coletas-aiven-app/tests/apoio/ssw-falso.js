// SSW de mentira para testar a lógica de sessão (login, menu, opção 38) e a leitura de CT-e
// (opção 101 + XML) sem tocar no SSW real.
const http=require('http');
const PORT=Number(process.env.MOCK_PORT||10555);
let logins=0,seq=0,recusados=0;const tokens=new Map(),paths={};
const DATA={
  AMR:[['AMR001056-1','EYV3626','08/10/26','JAILSON MOREIRA DE SOUZA','12','5'],['AMR001057-1','FAB1A23','08/10/26','FABIANO TESTE','5','5']],
  TBT:[['TBT000321-1','TBT9Z99','08/10/26','ROGER TESTE','6','2']]
};
const page=rows=>'<html><body><form><input name="act" value=""><input name="dummy" value="1"></form><table><tr><th>Romaneio</th><th>Veículo</th><th>Inclusão</th><th>Motorista</th><th>Qtde CTRCs</th><th>Falta Ocorr.</th></tr>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table></body></html>';
const loginPage='<html><body><form action="ssw0422"><input name="f1"><input name="f2"><input name="f3"><input type="password" name="f4"></form></body></html>';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ---------------------------------------------------------------- opção 101: tela do CT-e e XML
// CT-es de mentira, no formato que o SSW real devolve (conferido no CT-e AMR015326-5):
// tela em duas colunas (Expedidor | Entrega), link "mapa" com o ponto do cliente e botão XML
// que entrega um .zip com o XML do CT-e. lat/lon vazios = cliente sem ponto no SSW.
const zlib=require('zlib');
const CTES={
  15326:{dv:5,nct:14791,nf:525535,nome:'3056207 WAGNO ABREU DE JESUZ',doc:'10811266000178',lgr:'SITIO BAIRRO OLARIA',nro:'3',cpl:'SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO',bairro:'ZONA RURAL',cid:'SAO JOAO DA BOA VISTA',uf:'SP',cep:'13871160',lat:'-21,9777401',lon:'-46,7894998',vol:5,peso:'134,084'},
  15327:{dv:3,nct:14792,nf:88120,nome:'DEPOSITO SAUDADE LTDA',doc:'11222333000144',lgr:'AVENIDA SAUDADE',nro:'516',cpl:'',bairro:'CENTRO',cid:'MOGI MIRIM',uf:'SP',cep:'13800000',lat:'-22,4288700',lon:'-46,9566500',vol:12,peso:'1.250,500'},
  15328:{dv:1,nct:14793,nf:4471,nome:'MADEIREIRA TRAVAGLIA',doc:'22333444000155',lgr:'RUA CONCEICAO TRAVAGLIA BLANCO',nro:'65',cpl:'GALPAO 2',bairro:'JARDIM SANTA CRUZ',cid:'MOGI GUACU',uf:'SP',cep:'13840000',lat:'-22,3212800',lon:'-46,9441100',vol:3,peso:'80,000'},
  15329:{dv:9,nct:14794,nf:9012,nome:'CERAMICA PEDREIRA',doc:'33444555000166',lgr:'RUA DAS PORCELANAS',nro:'100',cpl:'',bairro:'CENTRO',cid:'PEDREIRA',uf:'SP',cep:'13920000',lat:'',lon:'',vol:20,peso:'410,000'},
  15330:{dv:7,nct:14795,nf:7001,nome:'CLIENTE DO RIO',doc:'44555666000177',lgr:'AVENIDA ATLANTICA',nro:'1702',cpl:'',bairro:'COPACABANA',cid:'RIO DE JANEIRO',uf:'RJ',cep:'22021001',lat:'-22,9711000',lon:'-43,1822000',vol:1,peso:'10,000'}
};
const chaveDe=c=>'35'+'2610'+'54582567000142'+'57'+'001'+String(c.nct).padStart(9,'0')+'1'+String(c.nct).padStart(8,'0')+'4';
const porChave=k=>Object.entries(CTES).find(([,c])=>chaveDe(c)===k);
const xmlDe=c=>'<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe'+chaveDe(c)+'" versao="4.00"><ide><serie>1</serie><nCT>'+c.nct+'</nCT><xMunFim>'+c.cid+'</xMunFim><UFFim>'+c.uf+'</UFFim></ide><compl><xObs>LIGAR ANTES DE ENTREGAR</xObs></compl>'+
  '<rem><CNPJ>44530855000108</CNPJ><xNome>NAVAS E CIA LTDA</xNome><enderReme><xLgr>ROD. LINS/GUAIMBE</xLgr><nro>50</nro><xMun>LINS</xMun><CEP>16403266</CEP><UF>SP</UF></enderReme></rem>'+
  '<receb><CNPJ>'+c.doc+'</CNPJ><xNome>'+c.nome+'</xNome><enderReceb><xLgr>'+c.lgr.slice(0,15)+'</xLgr><nro>'+c.nro+'</nro>'+(c.cpl?'<xCpl>'+c.cpl.slice(0,42)+'</xCpl>':'')+'<xBairro>'+c.bairro+'</xBairro><xMun>'+c.cid+'</xMun><CEP>'+c.cep+'</CEP><UF>'+c.uf+'</UF></enderReceb></receb>'+
  '<dest><CNPJ>'+c.doc+'</CNPJ><xNome>'+c.nome+'</xNome><fone>1936236644</fone><enderDest><xLgr>'+c.lgr+'</xLgr><nro>'+c.nro+'</nro>'+(c.cpl?'<xCpl>'+c.cpl+'</xCpl>':'')+'<xBairro>'+c.bairro+'</xBairro><xMun>'+c.cid+'</xMun><CEP>'+c.cep+'</CEP><UF>'+c.uf+'</UF></enderDest></dest>'+
  '<infCTeNorm><infDoc><infNFe><chave>3526104453085500010855001'+String(c.nf).padStart(9,'0')+'1000000017</chave></infNFe></infDoc></infCTeNorm></infCte></CTe></cteProc>';
function zipDe(nome,texto){
  const name=Buffer.from(nome),raw=Buffer.from(texto),data=zlib.deflateRawSync(raw);
  const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(8,8);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(name.length,26);
  const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(8,10);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+data.length,16);
  return Buffer.concat([lh,name,data,ch,name,end])
}
const dv=(c,t)=>'<div class='+c+' style="left:1px;top:1px;">'+t+'</div> ';
// Formulário inicial como o do SSW real: vários campos de 50 letras; só o "Código de barras"
// (t_cod_barras, ação BAR) acha o CT-e pela chave de 44 dígitos.
const campo=(rotulo,nome,max,act)=>'<div class=texto>'+rotulo+':</div><input type="text" name="'+nome+'" id="'+nome+'" value="" maxlength='+max+'><a href="#" onclick="ajaxEnvia(\''+act+'\', 1);return false;">&#9658;</a><a href="#" onclick="btnClose();return false;">&times;</a>';
const FORM101='<html><body><form><input type="hidden" name="act" value="">'+
  '<div class=texto>CTRC (sigla opc, n&uacute;mero sem DV):</div><input type="text" name="t_ser_ctrc" value="" maxlength=3><input type="text" name="t_nro_ctrc" id="t_nro_ctrc" value="" maxlength=6><a href="#" onclick="ajaxEnvia(\'P1\', 1);return false;">&#9658;</a>'+
  campo('Nota Fiscal','t_nro_nf',10,'P2')+campo('Cod vol cliente/shipment','t_cod_cli',50,'P8')+campo('CT-e/NFS-e','t_nro_cte',10,'P4')+campo('N&deg; Pedido','t_nro_pedido',50,'P6')+campo('C&oacute;digo de barras','t_cod_barras',50,'BAR')+
  '<input type="hidden" name="seq_ctrc" value=""><input type="hidden" name="FAMILIA" value="TST"><input type="hidden" name="web_sess" value="abc"></form></body></html>';
const nenhum='<html><body>Nenhum CTRC selecionado para dados e per&iacute;odo informados</body></html>';
const tela101=(nro,c)=>{
  const ctrc='AMR'+String(nro).padStart(6,'0')+'-'+c.dv,mapa=(id,end,comPonto)=>'<A id="'+id+'" class="baselnk" href="#" onclick="showmapa(\'end='+end+'&nome='+encodeURIComponent(c.nome)+(comPonto&&c.lat?'&olat='+c.lat+'&olng='+c.lon:'')+'&cid='+c.cid+'&uf='+c.uf+'\');return false;">mapa</A> ';
  return'<html><head><title>101 - Situa&ccedil;&atilde;o do CTRC</title></head><body><form><input type="hidden" name="act" value=""><input type="hidden" name="g_ctrc_ser_ctrc" value="AMR"><input type="hidden" name="g_ctrc_nro_ctrc" value="'+nro+'"><input type="hidden" name="seq_ctrc" value="'+(22000+Number(nro)%1000)+'"><input type="hidden" name="FAMILIA" value="TST"><input type="hidden" name="web_sess" value="abc"></form>'+
    dv('texto','CTRC&nbsp;/Subc./RPS:')+dv('data','<b>'+ctrc+'</b>')+'<A id="link_imp_xml" class=baselnk href="#" onclick="ajaxEnvia(\'XML\', 0);return false;">XML</A>'+
    dv('texto','CT-e:')+dv('data','001 '+String(c.nct).padStart(9,'0'))+dv('texto','Previs&atilde;o de entrega:')+dv('data','09/10/26')+dv('texto','N&deg; da Nota Fiscal:')+dv('data','1/'+String(c.nf).padStart(9,'0'))+dv('texto','N&ordm; Pedido:')+dv('data','74236')+
    dv('texto','Qtde. de vol./pares:')+dv('data',c.vol+'/0')+dv('texto','Peso real /Peso real orig (Kg):')+dv('data',c.peso)+dv('texto','Valor da Nota Fiscal:')+dv('data','1.580,62')+dv('texto','Valor frete (R$):')+dv('data',(c.frete||'79,03'))+
    dv('texto','Remetente:')+dv('texto','Destinat&aacute;rio:')+dv('texto','Nome:')+dv('data','NAVAS E CIA LTDA (B2)')+dv('texto','Nome:')+dv('data',c.nome.slice(0,26)+' ..')+dv('texto','CNPJ:')+dv('data','44530855000108')+dv('texto','CNPJ:')+dv('data',c.doc)+mapa('link_mapa_setor_cli_dest',c.lgr+','+c.nro,true)+
    dv('texto','Expedidor:')+dv('texto','Entrega:')+dv('texto','Nome:')+dv('data','NAVAS E CIA LTDA B2')+dv('texto','Nome:')+dv('data',c.nome)+dv('texto','CNPJ:')+dv('data','44530855000108')+dv('texto','CNPJ:')+dv('data',c.doc)+mapa('link_mapa_setor_cli_ent',c.lgr.slice(0,15)+', '+c.nro,true)+
    dv('texto','Endere&ccedil;o:')+dv('data','ROD. LINS/GUAIMBE,50')+dv('texto','Endere&ccedil;o:')+dv('data',c.lgr.slice(0,15)+','+c.nro)+dv('texto','Complemento:')+dv('texto','Complemento:')+dv('data',c.cpl.slice(0,28))+
    dv('texto','Bairro:')+dv('data','JARDIM GUANABARA')+dv('texto','Bairro:')+dv('data',c.bairro)+dv('texto','CEP:')+dv('data','16403-266 LINS/SP')+dv('texto','CEP:')+dv('data',c.cep.slice(0,5)+'-'+c.cep.slice(5)+' '+c.cid+'/'+c.uf)+dv('texto','Telefone:')+dv('texto','Pagador:')+
    dv('texto','Situa&ccedil;&atilde;o Atual:')+dv('data','TST AMR 09/10/26 06:45 85-SAIDA PARA ENTREGA')+'<A id="link_ocor" href="#" onclick="ajaxEnvia(\'O\', 1);return false;"><u>O</u>corr&ecirc;ncias</A> <A id="link_danfe" href="#" onclick="ajaxEnvia(\'A\', 1);return false;">DANFEs</A> <A id="link_arq" href="#" onclick="ajaxEnvia(\'ARQ\', 1);return false;">Arquivos EDI</A></body></html>'
};
// PDF do romaneio (opção 38 -> ssw0146): uma linha por CT-e, começando por "CTRC  NF", como o do SSW.
// O romaneio AMR001057-1 leva os cinco CT-es de mentira (um deles a mais de 300 km).
function pdfDe(linhas){
  const txt='BT /F1 9 Tf 40 800 Td 12 TL '+linhas.map(l=>'('+String(l).replace(/[\\()]/g,'\\$&')+') Tj T*').join(' ')+' ET';
  const objs=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>','<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length '+Buffer.byteLength(txt,'latin1')+'>>\nstream\n'+txt+'\nendstream','<</Type/Font/Subtype/Type1/BaseFont/Courier>>'];
  let out='%PDF-1.4\n';const pos=[];
  objs.forEach((o,i)=>{pos.push(Buffer.byteLength(out,'latin1'));out+=(i+1)+' 0 obj\n'+o+'\nendobj\n'});
  const xref=Buffer.byteLength(out,'latin1');
  out+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n'+pos.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<</Size '+(objs.length+1)+'/Root 1 0 R>>\nstartxref\n'+xref+'\n%%EOF\n';
  return Buffer.from(out,'latin1')
}
const ROMANEIO_PDF={'AMR|1057|1':['ROMANEIO DE ENTREGAS AMR001057-1   FABIANO TESTE   FAB1A23','CTRC         NF       DESTINATARIO',
  ...Object.entries(CTES).map(([nro,c])=>'AMR'+String(nro).padStart(6,'0')+'-'+c.dv+'  '+String(c.nf).padStart(6,'0')+'  '+c.nome.slice(0,30))]};
const semCte='<html><body><form><input type="hidden" name="act" value=""></form><div class=texto>CTRC n&atilde;o encontrado.</div></body></html>';
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
  if(u.pathname==='/bin/menu01'&&u.searchParams.get('f3')==='101')return send(200,'<script>location="ssw0053"</script>');
  if(u.pathname==='/bin/ssw0053'&&req.method==='GET')return send(200,FORM101);
  if(u.pathname==='/bin/ssw0053'&&req.method==='POST'){
    const p=new URLSearchParams(body),act=p.get('act')||'';
    if(act==='P1'){const nro=Number(p.get('t_nro_ctrc')),c=CTES[nro];st.cte=c?nro:0;return send(200,c?tela101(nro,c):semCte)}
    if(act==='BAR'){const hit=porChave(p.get('t_cod_barras')||'');st.cte=hit?Number(hit[0]):0;return send(200,hit?tela101(hit[0],hit[1]):nenhum)}
    if(act==='P8'||act==='P6'||act==='P4'||act==='P2')return send(200,nenhum);
    const nro=Number(p.get('g_ctrc_nro_ctrc')),c=CTES[nro];
    if(act==='XML'&&c)return send(200,'<html><form><input type=hidden name=web_body value="'+encodeURIComponent('abrir("CTe_66480000'+nro+'.zip", "CTe_66480000'+nro+'.zip", 1, 1, "binary", 3)')+'"></form></html>');
    if(act==='A')return send(200,'<html><body>Nenhuma DANFE dispon&iacute;vel.</body></html>');
    if(act==='ARQ')return send(200,'<html><body>Nenhum arquivo EDI para este CTRC.</body></html>');
    return send(200,semCte)
  }
  if(u.pathname==='/bin/ssw0146'){
    const k=[u.searchParams.get('f1'),u.searchParams.get('f2'),u.searchParams.get('f3')].join('|');
    if(!ROMANEIO_PDF[k])return send(200,'<html><body>Romaneio n&atilde;o encontrado.</body></html>');
    return send(200,'<html><form><input type=hidden name=web_body value="'+encodeURIComponent('abrir("ROM'+k.replace(/\|/g,'_')+'.pdf","ROM'+k.replace(/\|/g,'_')+'.pdf",1,1,"binary",3)')+'"></form></html>')
  }
  if(u.pathname==='/bin/ssw0424'&&/^ROM/.test(String(u.searchParams.get('filename')||''))){
    const linhas=ROMANEIO_PDF[String(u.searchParams.get('filename')).replace(/^ROM|\.pdf$/g,'').replace(/_/g,'|')];
    if(!linhas)return send(404,'');
    res.writeHead(200,{'Content-Type':'application/pdf'});return res.end(pdfDe(linhas))
  }
  if(u.pathname==='/bin/ssw0424'){
    const nro=Number((String(u.searchParams.get('filename')||'').match(/66480000(\d+)\.zip$/)||[])[1]),c=CTES[nro];
    if(!c)return send(404,'');
    res.writeHead(200,{'Content-Type':'application/ssw'});return res.end(zipDe(chaveDe(c)+'-cte.xml',xmlDe(c)))
  }
  if(u.pathname==='/bin/menu01'){st.unit=u.searchParams.get('f2');await sleep(150);return send(200,'<script>location="ssw0198"</script>')}
  if(u.pathname==='/bin/ssw0198'&&req.method==='GET'){await sleep(150);return send(200,page(DATA[st.unit]||[]))}
  if(u.pathname==='/bin/ssw0198'&&req.method==='POST')return send(200,'<xml></xml>');
  return send(404,'');
}).listen(PORT,'127.0.0.1',()=>console.log('SSW de teste em '+PORT));
