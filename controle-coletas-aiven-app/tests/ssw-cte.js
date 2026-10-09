'use strict';
// Leitura do CT-e guardado no SSW (dashboard/ssw-cte.js): .zip do XML, XML do CT-e e tela 101.
// Roda sem rede e sem banco:  node tests/ssw-cte.js
const zlib=require('zlib');
const path=require('path');
const cte=require(path.join(__dirname,'..','dashboard','ssw-cte.js'));

let ok=0,bad=0;
function check(name,cond,extra){
  if(cond){ok++;console.log('  ok   '+name)}
  else{bad++;console.log('  FALHA '+name+(extra!==undefined?'  -> '+JSON.stringify(extra):''))}
}
// Monta um .zip de verdade (cabeçalho local + índice), como o que o SSW entrega.
function makeZip(files,{store=false}={}){
  const locals=[],central=[];let offset=0;
  for(const [name,content] of files){
    const raw=Buffer.from(content,'utf8'),data=store?raw:zlib.deflateRawSync(raw),nameBuf=Buffer.from(name,'utf8'),extra=Buffer.alloc(28,1);
    const lh=Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(0,6);lh.writeUInt16LE(store?0:8,8);
    lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(nameBuf.length,26);lh.writeUInt16LE(extra.length,28);
    const ch=Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,6);ch.writeUInt16LE(store?0:8,10);
    ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(nameBuf.length,28);ch.writeUInt32LE(offset,42);
    locals.push(lh,nameBuf,extra,data);central.push(ch,nameBuf);
    offset+=30+nameBuf.length+extra.length+data.length
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,end])
}

const XML='<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe35261054582567000142570010000147911000148104" versao="4.00">'+
  '<ide><cUF>35</cUF><serie>1</serie><nCT>14791</nCT><dhEmi>2026-10-08T17:20:11-03:00</dhEmi><xMunFim>SAO JOAO DA BOA VISTA</xMunFim><UFFim>SP</UFFim></ide>'+
  '<compl><xObs>ENTREGAR NO PERIODO DA MANHA &amp; LIGAR ANTES</xObs><ObsCont xCampo="LOCAL"><xTexto>RUA JULIA PERES APARECIDO 30 PRIMAVERA</xTexto></ObsCont></compl>'+
  '<emit><CNPJ>54582567000142</CNPJ><xNome>CONSTRULOG</xNome><enderEmit><xLgr>RUA DA TRANSPORTADORA</xLgr><nro>1</nro><xMun>AMERICANA</xMun><UF>SP</UF></enderEmit></emit>'+
  '<rem><CNPJ>44530855000108</CNPJ><xNome>NAVAS E CIA LTDA</xNome><enderReme><xLgr>ROD. LINS/GUAIMBE</xLgr><nro>50</nro><xBairro>JARDIM GUANABARA</xBairro><cMun>3527108</cMun><xMun>LINS</xMun><CEP>16403266</CEP><UF>SP</UF></enderReme></rem>'+
  '<dest><CNPJ>10811266000178</CNPJ><xNome>3056207 WAGNO ABREU DE JESUZ</xNome><fone>1936236644</fone><enderDest><xLgr>SITIO BAIRRO OLARIA</xLgr><nro>3</nro><xCpl>SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO</xCpl><xBairro>ZONA RURAL</xBairro><cMun>3549102</cMun><xMun>SAO JOAO DA BOA VISTA</xMun><CEP>13871160</CEP><UF>SP</UF></enderDest></dest>'+
  '<infCTeNorm><infDoc><infNFe><chave>35261044530855000108550010005255351000000017</chave></infNFe><infNFe><chave>35261044530855000108550010005255361000000012</chave></infNFe></infDoc></infCTeNorm>'+
  '</infCte></CTe><protCTe><infProt><chCTe>35261054582567000142570010000147911000148104</chCTe></infProt></protCTe></cteProc>';

console.log('Arquivo .zip do SSW');
{
  const zip=makeZip([['35261054582567000142570010000147911000148104-cte.xml',XML]]);
  check('reconhece o .zip',cte.isZip(zip)===true);
  const got=cte.xmlFromDownload(zip);
  check('abre o XML de dentro do .zip',got.xml===XML,got.xml.slice(0,80));
  check('guarda o nome do arquivo de dentro',got.nome==='35261054582567000142570010000147911000148104-cte.xml',got.nome);
  check('.zip sem compactação também abre',cte.xmlFromDownload(makeZip([['a.xml',XML]],{store:true})).xml===XML);
  check('.zip com vários arquivos: pega o .xml',cte.xmlFromDownload(makeZip([['leia.txt','oi'],['b.xml',XML]])).nome==='b.xml');
  check('XML direto (sem .zip) passa igual',cte.xmlFromDownload(Buffer.from(XML,'utf8')).xml===XML);
  check('página de erro do SSW não é lida como CT-e',cte.parseCteXml(cte.xmlFromDownload(Buffer.from('<html>erro','utf8')).xml)===null&&cte.xmlFromDownload(Buffer.from('erro 500','utf8')).xml==='');
  check('arquivo vazio não quebra',cte.xmlFromDownload(Buffer.alloc(0)).xml==='');
  const quebrado=Buffer.from(zip);quebrado.fill(0,60,90);
  let caiu=false;try{cte.xmlFromDownload(quebrado)}catch{caiu=true}
  check('.zip corrompido não derruba o servidor',caiu===false);
  // o defeito do primeiro diagnóstico: tratar o .zip como texto estraga o arquivo
  check('texto não é confundido com .zip',cte.isZip(Buffer.from('PK não é zip','utf8'))===false);
  const latin=Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a><xNome>JOÃO</xNome></a>','latin1');
  check('XML em ISO-8859-1 mantém os acentos',cte.xmlValue(cte.xmlFromDownload(latin).xml,'xNome')==='JOÃO')
}

console.log('XML do CT-e');
{
  const p=cte.parseCteXml(XML);
  check('chave do CT-e',p.chave==='35261054582567000142570010000147911000148104',p.chave);
  check('número e cidade final',p.numero==='14791'&&p.cidadeFim==='SAO JOAO DA BOA VISTA'&&p.ufFim==='SP');
  const d=p.destinatario;
  check('destinatário: nome e documento',d.nome==='3056207 WAGNO ABREU DE JESUZ'&&d.doc==='10811266000178',d);
  check('destinatário: telefone (só dígitos)',d.fone==='1936236644'&&p.remetente.fone==='',d.fone);
  check('destinatário: rua e número separados',d.logradouro==='SITIO BAIRRO OLARIA'&&d.numero==='3',d);
  check('destinatário: complemento inteiro',d.complemento==='SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO',d.complemento);
  check('destinatário: bairro, cidade, UF e CEP',d.bairro==='ZONA RURAL'&&d.cidade==='SAO JOAO DA BOA VISTA'&&d.uf==='SP'&&d.cep==='13871-160',d);
  check('remetente não se mistura com destinatário',p.remetente.logradouro==='ROD. LINS/GUAIMBE'&&p.remetente.cidade==='LINS');
  check('sem recebedor no XML: vem vazio',p.recebedor===null&&p.expedidor===null);
  check('chaves das notas fiscais',p.nfChaves.length===2&&p.nfChaves[0].slice(25,34)==='000525535',p.nfChaves);
  check('observações (com & e campo do contribuinte)',p.observacoes[0]==='ENTREGAR NO PERIODO DA MANHA & LIGAR ANTES'&&p.observacoes[1]==='LOCAL: RUA JULIA PERES APARECIDO 30 PRIMAVERA',p.observacoes);
  const comReceb=XML.replace('<dest>','<receb><CPF>12345678901</CPF><xNome>OBRA DO WAGNO</xNome><enderReceb><xLgr>RUA JULIA PERES APARECIDO</xLgr><nro>30</nro><xBairro>PRIMAVERA</xBairro><xMun>SAO JOAO DA BOA VISTA</xMun><CEP>13871160</CEP><UF>SP</UF></enderReceb></receb><dest>');
  const r=cte.parseCteXml(comReceb);
  check('recebedor (local de entrega diferente) é lido',r.recebedor.logradouro==='RUA JULIA PERES APARECIDO'&&r.recebedor.numero==='30'&&r.recebedor.doc==='12345678901',r.recebedor);
  check('recebedor não troca o destinatário',r.destinatario.logradouro==='SITIO BAIRRO OLARIA');
  const prefixo=XML.replace(/<(\/?)(\w)/g,'<$1cte:$2').replace('<cte:?xml','<?xml');
  check('XML com prefixo (cte:) também é lido',cte.parseCteXml(prefixo)?.destinatario?.logradouro==='SITIO BAIRRO OLARIA');
  check('XML de nota fiscal não é confundido com CT-e',cte.parseCteXml('<nfeProc><NFe><infNFe Id="NFe1"></infNFe></NFe></nfeProc>')===null)
}

console.log('Tela da opção 101 (como o SSW mostra)');
{
  // Mesma ordem de texto e mesmos links "mapa" da tela real do CT-e AMR015326-5.
  const d=(cls,t)=>'<div class='+cls+' style="left:1px;top:1px;">'+t+'</div> ';
  const mapa=(id,call)=>'<A id="'+id+'" onfocus="obj=this;" class="baselnk" href="#" onclick="'+call+'return false;" style="left:1px">mapa</A> ';
  const HTML='<html><body><form><input type=hidden name="seq_ctrc" value="22119"></form>'+
    d('texto','Remetente:')+d('texto','Destinat&aacute;rio:')+d('texto','Nome:')+d('data','NAVAS E CIA LTDA (B2)')+d('texto','Nome:')+d('data','3056207  WAGNO ABREU DE JES ..')+
    d('texto','CNPJ:')+d('data','44530855000108')+mapa('link_mapa_setor_cli_rem',"showmapa('end=ROD. LINS/GUAIMBE,50&nome=NAVAS%20E%20CIA%20LTDA&cid=LINS&uf=SP');")+
    d('texto','CNPJ:')+d('data','10811266000178')+mapa('link_mapa_setor_cli_dest',"showmapa('end=SITIO BAIRRO OLARIA,3&nome=3056207%20%20WAGNO%20ABREU%20DE%20JES%20%2E%2E&olat=-21,9777401&olng=-46,7894998&cid=SAO JOAO DA BOA VISTA&uf=SP');")+
    d('texto','CEP:')+d('data','16403-266 LINS/SP')+d('texto','CEP:')+d('data','13871-160 SAO JOAO DA BOA VISTA/SP')+
    d('texto','Expedidor:')+d('texto','Entrega:')+d('texto','Nome:')+d('data','NAVAS E CIA LTDA B2')+d('texto','Nome:')+d('data','3056207 WAGNO ABREU DE JESUZ')+
    d('texto','CNPJ:')+d('data','44530855000108')+d('texto','Setor:')+d('data','164')+mapa('link_mapa_setor_cli_exp',"showmapa('end=ROD. LINS/GUAIMBE,50&nome=NAVAS&cid=LINS&uf=SP');")+
    d('texto','CNPJ:')+d('data','10811266000178')+d('texto','Setor:')+d('data','8')+mapa('link_mapa_setor_cli_ent',"showmapa('end=SITIO BAIRRO OL, 3&nome=3056207 WAGNO ABREU DE JESUZ&olat=-21,9777401&olng=-46,7894998&cid=SAO JOAO DA BOA VISTA&uf=SP');")+
    d('texto','Endere&ccedil;o:')+d('data','ROD. LINS/GUAIMBE,50')+d('texto','Endere&ccedil;o:')+d('data','SITIO BAIRRO OL,3')+
    d('texto','Complemento:')+d('data','')+d('texto','Complemento:')+d('data','SN ENDERECO ENTREGA RUA JULIA')+
    d('texto','Bairro:')+d('data','JARDIM GUANABARA')+d('texto','Bairro:')+d('data','ZONA RURAL')+
    d('texto','CEP:')+d('data','16403-266 LINS/SP')+d('texto','CEP:')+d('data','13871-160 SAO JOAO DA BOA VISTA/SP')+
    d('texto','Telefone:')+d('data','(14) 35332900')+d('texto','Celular:')+d('texto','Telefone:')+d('data','(19) 36236644')+d('texto','Celular:')+
    d('texto','Pagador:')+d('texto','Outras Informa&ccedil;&otilde;es:')+'</body></html>';
  const t=cte.parseTela101(HTML);
  check('bloco Entrega: endereço da coluna da direita',t.entrega&&t.entrega.endereco==='SITIO BAIRRO OL,3'&&t.entrega.logradouro==='SITIO BAIRRO OL'&&t.entrega.numero==='3',t.entrega);
  check('bloco Entrega: complemento (o do expedidor vem vazio)',t.entrega.complemento==='SN ENDERECO ENTREGA RUA JULIA',t.entrega.complemento);
  check('bloco Entrega: bairro, CEP, cidade e UF',t.entrega.bairro==='ZONA RURAL'&&t.entrega.cep==='13871-160'&&t.entrega.cidade==='SAO JOAO DA BOA VISTA'&&t.entrega.uf==='SP',t.entrega);
  check('bloco Entrega: nome de quem recebe',t.entrega.nome==='3056207 WAGNO ABREU DE JESUZ',t.entrega.nome);
  check('ponto do mapa da entrega (vírgula decimal do SSW)',t.mapas.ent&&t.mapas.ent.lat===-21.9777401&&t.mapas.ent.lon===-46.7894998,t.mapas.ent);
  check('ponto do mapa do destinatário, com a rua inteira',t.mapas.dest.logradouro==='SITIO BAIRRO OLARIA'&&t.mapas.dest.numero==='3'&&t.mapas.dest.cidade==='SAO JOAO DA BOA VISTA'&&t.mapas.dest.uf==='SP',t.mapas.dest);
  check('cliente sem ponto no SSW: coordenada vazia, não zero',t.mapas.rem.lat===null&&t.mapas.rem.lon===null&&t.mapas.rem.cidade==='LINS',t.mapas.rem);
  check('nome com %20 é decodificado',t.mapas.dest.nome==='3056207 WAGNO ABREU DE JES ..',t.mapas.dest.nome);
  check('coordenada fora do Brasil é descartada',cte.parseMapaCall("showmapa('end=X,1&olat=48,85&olng=2,35&cid=Y&uf=SP')").lat===null);
  check('coordenada zerada é descartada',cte.parseMapaCall("showmapa('end=X,1&olat=0,0&olng=0,0&cid=Y&uf=SP')").lat===null);
  // texto corrido da tela real, como o diagnóstico de 09/10 devolveu
  const REAL='<div>Expedidor: Entrega: Nome: NAVAS E CIA LTDA B2 Nome: 3056207 WAGNO ABREU DE JESUZ CNPJ: 44530855000108 Ctrl-C Setor: 164 mapa CNPJ: 10811266000178 Ctrl-C Setor: 8 mapa Endere&ccedil;o: ROD. LINS/GUAIMBE,50 Endere&ccedil;o: SITIO BAIRRO OL,3 Complemento: Complemento: SN ENDERECO ENTREGA RUA JULIA Bairro: JARDIM GUANABARA Bairro: ZONA RURAL CEP: 16403-266 LINS/SP CEP: 13871-160 SAO JOAO DA BOA VISTA/SP Telefone: (14) 35332900 Celular: Telefone: (19) 36236644 Celular: Pagador: Outras Informa&ccedil;&otilde;es:</div>';
  const r=cte.parseTela101(REAL).entrega;
  check('texto real da tela (com Ctrl-C, Setor e mapa no meio)',r&&r.endereco==='SITIO BAIRRO OL,3'&&r.complemento==='SN ENDERECO ENTREGA RUA JULIA'&&r.bairro==='ZONA RURAL'&&r.cidade==='SAO JOAO DA BOA VISTA'&&r.uf==='SP'&&r.nome==='3056207 WAGNO ABREU DE JESUZ',r);
  const semCompl=cte.parseTela101(REAL.replace('Complemento: Complemento: SN ENDERECO ENTREGA RUA JULIA','Complemento: GALPAO 2 Complemento:')).entrega;
  check('complemento só no expedidor não vai para a entrega',semCompl&&semCompl.complemento===''&&semCompl.bairro==='ZONA RURAL',semCompl);
  check('tela sem o bloco Entrega não quebra',cte.parseTela101('<html>Sessão expirada</html>').entrega===null)
}

console.log('Dados da carga na tela 101');
{
  const TOPO='<div>Dados do CTRC: 000022119 Dom&iacute;nio: CNG Empresa: 01 CTRC&nbsp;/Subc./RPS: <b>AMR015326-5</b> DACTE XML SEFAZ CT-e: 001 000014791 07/10/26 14:43 AUTORIZADO Previs&atilde;o de entrega: 09/10/26 ajustar N&deg; da Nota Fiscal: 1/000525535 N&ordm; Pedido: 74236 Estou chegando: Qtde. de vol./pares: 5/0 Conferente coleta: Peso c&aacute;lculo (Kg): 134,084 Peso real /Peso real orig (Kg): 1.134,084 Cubagem/Cub Orig (m&sup3;): 0,0000 Valor da Nota Fiscal: 1.580,62 Frete original:</div>';
  const r=cte.parseTela101(TOPO).resumo;
  check('número do CT-e no SSW',r.ctrc==='AMR015326-5',r.ctrc);
  check('nota fiscal sem a série e sem zeros',r.nf==='525535',r.nf);
  check('volumes',r.volumes===5,r.volumes);
  check('peso com milhar e vírgula',r.peso===1134.084,r.peso);
  check('valor da nota',r.valorNf===1580.62,r.valorNf);
  check('previsão e pedido',r.previsao==='09/10/26'&&r.pedido==='74236',r);
  const sit=cte.parseTela101('<div>Observa&ccedil;&atilde;o: Instru&ccedil;&atilde;o Entrega: Situa&ccedil;&atilde;o Atual: CNG AMR 09/10/26 06:45 85-SAIDA PARA ENTREGA O corr&ecirc;ncias Fr e te D ANFEs</div>').resumo.situacao;
  check('situação atual do CT-e (sem as siglas da frente)',sit==='09/10/26 06:45 85-SAIDA PARA ENTREGA',sit);
  const vazio=cte.parseTela101('<html>nada</html>').resumo;
  check('tela sem dados: tudo zerado, sem quebrar',vazio.ctrc===''&&vazio.volumes===0&&vazio.peso===0)
}

console.log('Qual endereço usar na entrega');
{
  const e=cte.entregaNoComplemento;
  check('complemento com "ENDERECO ENTREGA RUA…"',e('SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR')==='RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR',e('SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR'));
  check('"End. de entrega: Av. …" (com acento e pontuação)',e('End. de Entrega: Av. Brasil, 100')==='AV. BRASIL, 100',e('End. de Entrega: Av. Brasil, 100'));
  check('"ENTREGAR NA RUA …"',e('ENTREGAR NA RUA DAS FLORES 12')==='RUA DAS FLORES 12');
  check('"LOCAL DE ENTREGA ROD …"',e('LOCAL DE ENTREGA ROD SP 340 KM 172')==='ROD SP 340 KM 172');
  check('texto do romaneio começando por ENTREGA',e('ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR')==='RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR');
  check('complemento comum não vira endereço',e('GALPAO 2 FUNDOS')===''&&e('SALA 3')===''&&e('')==='');
  check('"entrega" sem logradouro depois não vira endereço',e('ENTREGA SOMENTE PELA MANHA')===''&&e('AGENDAR ENTREGA')==='');
  check('rua citada sem dizer que é a entrega não vira endereço',e('ESQUINA COM RUA DAS FLORES')==='');

  const p=cte.parseCteXml(XML);
  const tela={endereco:'SITIO BAIRRO OL,3',logradouro:'SITIO BAIRRO OL',numero:'3',complemento:'SN ENDERECO ENTREGA RUA JULIA',bairro:'ZONA RURAL',cep:'13871-160',cidade:'SAO JOAO DA BOA VISTA',uf:'SP'};
  const mapas={ent:{endereco:'SITIO BAIRRO OL, 3',logradouro:'SITIO BAIRRO OL',numero:'3',cidade:'SAO JOAO DA BOA VISTA',uf:'SP',lat:-21.97,lon:-46.78}};
  const ROM='ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR';
  let c=cte.enderecosEntrega({cte:p,entrega:tela,mapas},ROM);
  check('caso real (sítio + entrega no complemento): a entrega vem primeiro',c[0].fonte==='complemento (endereço de entrega)'&&c[0].endereco==='RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR',c[0]);
  check('usa o complemento mais completo, nunca o cortado da tela',!c.some(x=>x.endereco==='RUA JULIA'),c.map(x=>x.endereco));
  check('depois vem o endereço do destinatário no XML',c[1].fonte==='XML do CT-e (destinatário)'&&c[1].endereco==='SITIO BAIRRO OLARIA'&&c[1].numero==='3'&&c[1].cep==='13871-160',c[1]);
  check('todos levam a cidade e a UF do destinatário',c.every(x=>x.cidade==='SAO JOAO DA BOA VISTA'&&x.uf==='SP'),c.map(x=>x.cidade));
  check('o texto do romaneio fica por último',c[c.length-1].fonte==='romaneio');
  check('não repete o mesmo endereço',new Set(c.map(x=>x.endereco+'|'+x.numero)).size===c.length);
  const comReceb=cte.parseCteXml(XML.replace('<dest>','<receb><CNPJ>1</CNPJ><xNome>OBRA</xNome><enderReceb><xLgr>RUA NOVA</xLgr><nro>7</nro><xMun>AGUAI</xMun><UF>SP</UF><CEP>13860000</CEP></enderReceb></receb><dest>'));
  c=cte.enderecosEntrega({cte:comReceb,entrega:tela,mapas},ROM);
  check('recebedor no XML ganha de tudo, com a cidade dele',c[0].fonte==='XML do CT-e (recebedor)'&&c[0].endereco==='RUA NOVA'&&c[0].cidade==='AGUAI'&&c[0].cep==='13860-000',c[0]);
  // Como o SSW real grava (romaneio AMR001060-0): o recebedor é o próprio destinatário, com campos cortados.
  const D={nome:'3056207 WAGNO ABREU DE JESUZ',doc:'10811266000178',logradouro:'SITIO BAIRRO OLARIA',numero:'3',complemento:'SN ENDERECO ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO',bairro:'ZONA RURAL',cidade:'SAO JOAO DA BOA VISTA',uf:'SP',cep:'13871-160'};
  const R={...D,logradouro:'SITIO BAIRRO OL',complemento:'SN ENDERECO ENTREGA RUA JULIA PERES APAREC'};
  const o=cte.recebedorEhOutroLocal;
  check('recebedor = destinatário com a rua cortada NÃO é outro local',o(D,R)===false);
  check('recebedor idêntico não é outro local',o(D,{...D})===false&&o(D,null)===false&&o(D,{logradouro:''})===false);
  check('recebedor com outro documento é outro local',o(D,{...R,doc:'08339603000124'})===true);
  check('mesmo cliente, outra rua / outro número / outra cidade: é outro local',o(D,{...D,logradouro:'RUA NOVA'})===true&&o(D,{...D,numero:'77'})===true&&o(D,{...D,cidade:'AGUAI'})===true);
  check('sem destinatário no XML: vale o recebedor',o(null,R)===true);
  c=cte.enderecosEntrega({cte:{destinatario:D,recebedor:R},entrega:tela,mapas},ROM);
  check('caso real: o recebedor cortado some; vem a entrega do complemento e depois o cadastro inteiro',c.length===3&&c[0].fonte==='complemento (endereço de entrega)'&&c[0].outroLocal===true&&c[1].fonte==='XML do CT-e (destinatário)'&&c[1].endereco==='SITIO BAIRRO OLARIA'&&c[1].outroLocal===false&&!c.some(x=>x.endereco==='SITIO BAIRRO OL'),c);
  check('o texto do romaneio que traz a entrega também é marcado como outro local',c[2].fonte==='romaneio'&&c[2].outroLocal===true,c[2]);
  const D2={nome:'CARVALHO E CARVALHO',doc:'08339603000124',logradouro:'AVENIDA EMILIA MARCHI MARTINI',numero:'2790',complemento:'',bairro:'JARDIM SUECIA',cidade:'MOGI GUACU',uf:'SP',cep:'13848-020',fone:'1938317925'};
  c=cte.enderecosEntrega({cte:{destinatario:D2,recebedor:{...D2}},entrega:null,mapas:{}},'0009                 AVENIDA EMILIA MARCHI MARTINI,2790');
  check('entrega no próprio cadastro: destinatário primeiro, nada marcado como outro local',c[0].fonte==='XML do CT-e (destinatário)'&&c.every(x=>x.outroLocal===false)&&c[0].bairro==='JARDIM SUECIA',c);
  c=cte.enderecosEntrega({cte:null,entrega:tela,mapas},'0007      AVENIDA SAUDADE, 516');
  check('sem XML: complemento cortado da tela é ignorado; usa o cadastro do SSW e, por último, o romaneio',c[0].fonte==='cadastro do cliente no SSW'&&c[c.length-1].endereco==='0007 AVENIDA SAUDADE, 516',c);
  c=cte.enderecosEntrega(null,'RUA A, 10');
  check('sem nada do SSW: fica só o romaneio (como é hoje)',c.length===1&&c[0].fonte==='romaneio'&&c[0].cidade==='',c);
  check('sem nada de nada: lista vazia',cte.enderecosEntrega(null,'').length===0);
  const semCompl=cte.parseCteXml(XML.replace(/<xCpl>.*?<\/xCpl>/,'<xCpl>CASA</xCpl>'));
  c=cte.enderecosEntrega({cte:semCompl,entrega:{...tela,complemento:'CASA'},mapas},'0007   SITIO BAIRRO OLARIA,3');
  check('complemento comum: vai direto no endereço do destinatário',c[0].fonte==='XML do CT-e (destinatário)',c[0])
}

console.log('\n'+ok+' ok, '+bad+' falha(s)');
process.exit(bad?1:0);
