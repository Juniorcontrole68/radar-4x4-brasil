// Localização de endereços do SSW no mapa (dashboard/geo-endereco.js).
// Não usa rede: as consultas ao serviço de mapas são respondidas com o que o Photon devolveu,
// de verdade, para o romaneio AMR001060-0 em 09/10/2026 (tests/apoio/photon-gilmar.json).
//   Uso: node tests/geo-endereco.js
const path=require('path');
const geo=require(path.join(__dirname,'..','dashboard','geo-endereco.js'));
const gravado=require('./apoio/photon-gilmar.json').respostas;
let pass=0,fail=0;
function check(name,cond,extra=''){if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,extra);if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name+' '+extra).replace(/\r?\n/g,' ').slice(0,900))}}
const km=(a,b)=>geo.haversineMeters(a,b)/1000;

// O romaneio como o SSW entrega: endereço, cidade, CEP e onde a entrega fica de verdade.
const ROMANEIO=[
 ['0007                 AVENIDA SAUDADE,516','MOGI MIRIM','13806-093',{street:'AVENIDA SAUDADE',number:'516'}],
 ['0011                 AVENIDA PIERINA UZAM BARUFI,540','MOGI GUACU','13841-310',{street:'AVENIDA PIERINA UZAM BARUFI',number:'540'}],
 ['0010                 RUA CONCEICAO TRAVAGLIA BLANCO,65','MOGI GUACU','13846-723',{street:'RUA CONCEICAO TRAVAGLIA BLANCO',number:'65'}],
 ['0009                 AVENIDA EMILIA MARCHI MARTINI,2790','MOGI GUACU','13848-020',{street:'AVENIDA EMILIA MARCHI MARTINI',number:'2790'}],
 ['0008                 AVENIDA MARIA PALIARI CASSIMIRO N,12-22','MOGI GUACU','13844-330',{street:'AVENIDA MARIA PALIARI CASSIMIRO',number:'12'}],
 ['0012                 RUA MARECHAL FLORIANO PEIXOTO, 620,SN','AGUAI','13860-073',{street:'RUA MARECHAL FLORIANO PEIXOTO',number:'620'}],
 ['ENTREGA RUA JULIA PERES APARECIDO NUM 30 BAIRRO PR','SAO JOAO DA BOA VISTA','13871-160',{street:'RUA JULIA PERES APARECIDO',number:'30'}],
 ['0014                 RUA CORONEL ELTEVAO ELPIDIO ROMAO, 173,SN','SANTO ANTONIO DO JARDIM','13995-000',{street:'RUA CORONEL ELTEVAO ELPIDIO ROMAO',number:'173'}],
 ['0006                 AVENIDA MONTE SIAO,519','AGUAS DE LINDOIA','13940-000',{street:'AVENIDA MONTE SIAO',number:'519'}],
 ['0005                 AVENIDA DR REBOUCAS, 268,SN','SOCORRO','13960-000',{street:'AVENIDA DOUTOR REBOUCAS',number:'268'}],
 ['RUA CANANEIA,210-SN','PEDREIRA','13920-000',{street:'RUA CANANEIA',number:'210'}],
 ['AVENIDA ROGERIO ZANAGA DE ,272','AMERICANA','13469-790',{street:'AVENIDA ROGERIO ZANAGA',number:'272'}]
];
// O que a consulta de CEP devolvia em produção: o centro de Mogi Guaçu para quatro CEPs
// diferentes e, para o CEP geral de Pedreira, um ponto em São Paulo capital.
const CEP={'13806-093':[-22.43194,-46.95778],'13841-310':[-22.3677,-46.94552],'13846-723':[-22.3677,-46.94552],'13848-020':[-22.3677,-46.94552],'13844-330':[-22.3677,-46.94552],
  '13860-073':[-22.05944,-46.97861],'13871-160':[-21.96917,-46.79806],'13995-000':[-22.11505,-46.68357],'13940-000':[-22.47639,-46.63278],'13960-000':[-22.59139,-46.52889],
  '13920-000':[-23.70675,-46.64982],'13469-790':[-22.73917,-47.33139]};
const geocodeCep=async cep=>CEP[cep]?{lat:CEP[cep][0],lon:CEP[cep][1],displayName:'CEP '+cep}:null;
function respostaPhoton(lista){return{ok:true,status:200,json:async()=>({features:lista.map(x=>({geometry:{coordinates:[x[0],x[1]]},properties:{countrycode:x[2],type:x[3],name:x[4],street:x[5],housenumber:x[6],city:x[7],district:x[8],state:x[9]}}))})}}
function fetchGravado(chamadas){return async u=>{const url=new URL(String(u));chamadas.push(url.hostname+' '+(url.searchParams.get('q')||''));
  if(url.hostname==='photon.komoot.io'){const q=url.searchParams.get('q');if(!(q in gravado))throw new Error('consulta não gravada: '+q);return respostaPhoton(gravado[q])}
  return{ok:true,status:200,json:async()=>[]}}}

(async()=>{
  console.log('A. Limpeza do endereço do SSW');
  for(const [end,,,esperado] of ROMANEIO){const c=geo.cleanSswAddress(end);check(JSON.stringify(end.replace(/\s+/g,' '))+' -> '+esperado.street+', '+esperado.number,c.street===esperado.street&&c.number===esperado.number,JSON.stringify(c))}
  for(const [end,num,street,number,bairro] of [['AV. BRASIL, S/N','','AVENIDA BRASIL','',''],['R 7 DE SETEMBRO 1500','','RUA 7 DE SETEMBRO','1500',''],['RUA 15 DE NOVEMBRO','120','RUA 15 DE NOVEMBRO','120',''],
    ['15 DE NOVEMBRO, 100','','15 DE NOVEMBRO','100',''],['PCA DA MATRIZ, 10 BAIRRO CENTRO','','PRACA DA MATRIZ','10','CENTRO'],['ROD SP 340 KM 172','','RODOVIA SP 340 KM 172','',''],['','','','','']]){
    const c=geo.cleanSswAddress(end,num);check(JSON.stringify(end)+(num?' + número '+num:'')+' -> '+JSON.stringify([street,number,bairro]),c.street===street&&c.number===number&&c.bairro===bairro,JSON.stringify(c))}

  console.log('B. Sede do município e conferência da cidade');
  const ped=geo.cityCentroid('Pedreira','SP');
  check('sede de Pedreira/SP vem da tabela (não do bairro Pedreira da capital)',!!ped&&Math.abs(ped.lat+22.7413)<0.01&&Math.abs(ped.lon+46.8948)<0.01,JSON.stringify(ped));
  check('"Mogi Guaçu, SP, Brasil" é reconhecida como consulta de cidade',!!geo.cityQueryCentroid('Mogi Guaçu, SP, Brasil')&&!!geo.cityQueryCentroid('MOGI GUACU, São Paulo'));
  check('consulta com rua não é tratada como cidade',geo.cityQueryCentroid('Rua A, Mogi Guaçu, SP, Brasil')===null&&geo.cityQueryCentroid('13920-000, Brasil')===null);
  check('cidade que não existe na UF não é inventada',geo.cityCentroid('Pedreira','MG')===null&&geo.cityCentroid('Cidade Que Nao Existe','SP')===null);
  check('ponto em São Paulo capital NÃO fica em Pedreira',geo.insideCity({lat:-23.70675,lon:-46.64982},'PEDREIRA','SP')===false);
  check('ponto a 18 km da sede ainda é Mogi Guaçu (município grande)',geo.insideCity({lat:-22.20276,lon:-46.98851},'MOGI GUACU','SP')===true);
  check('nome de rua cortado pelo SSW ou digitado errado ainda bate',geo.streetSimilarity('AVENIDA ROGERIO ZANAGA','Avenida Rogério Zanaga de Camargo Neves')===1&&geo.streetSimilarity('RUA CORONEL ELTEVAO ELPIDIO ROMAO','Rua Coronel Estêvão Elpídio Romão')===1&&geo.streetSimilarity('AVENIDA DOUTOR REBOUCAS','Avenida Dr. Rebouças')===1);
  check('rua diferente não bate',geo.streetSimilarity('RUA CANANEIA','Rua Campinas')===0&&geo.streetSimilarity('AVENIDA ROGERIO ZANAGA','Avenida Graciliano Ramos;Avenida Marginal')===0);

  console.log('C. Romaneio AMR001060-0 inteiro, com as respostas reais do serviço de mapas');
  let chamadas=[];
  let loc=geo.createLocator({fetch:fetchGravado(chamadas),geocodeCep});
  const res=await Promise.all(ROMANEIO.map(([endereco,cidade,cep])=>loc.locateAddress({endereco,cidade,uf:'SP',cep})));
  const por=p=>res.filter(x=>x&&x.precision===p).length;
  check('as 12 entregas são localizadas',res.every(Boolean));
  check('11 pela rua do cliente (2 com o número exato), 1 pelo CEP',por('endereco')===2&&por('rua')===9&&por('cep')===1&&por('cidade')===0,JSON.stringify(res.map(x=>x&&x.precision)));
  check('todas ficam na cidade do destinatário',res.every((x,i)=>geo.insideCity(x,ROMANEIO[i][1],'SP')===true),res.map((x,i)=>ROMANEIO[i][1]+':'+geo.insideCity(x,ROMANEIO[i][1],'SP')).join(' '));
  const pedreira=res[10];
  check('Pedreira: Rua Cananeia, 210 em Pedreira, não em São Paulo capital (antes: 110 km de erro)',pedreira.precision==='endereco'&&km(pedreira,{lat:-22.72976,lon:-46.89544})<0.05&&km(pedreira,{lat:-23.70675,lon:-46.64982})>100,JSON.stringify(pedreira));
  const guacu=[1,2,3].map(i=>res[i].lat.toFixed(4)+','+res[i].lon.toFixed(4));
  check('as entregas de Mogi Guaçu deixam de ficar empilhadas no mesmo ponto',new Set(guacu).size===3,guacu.join(' | '));
  check('Americana: acha a avenida certa e ignora o número 272 de outra rua',res[11].precision==='rua'&&km(res[11],{lat:-22.70555,lon:-47.37212})<0.05,JSON.stringify(res[11]));
  check('rua que não existe no mapa cai para o CEP, conferido contra a cidade',res[4].precision==='cep'&&res[4].coordinateSource==='CEP BrasilAPI',JSON.stringify(res[4]));
  check('origem informada: endereço exato, rua sem número ou CEP',res[8].coordinateSource==='Endereço do cliente'&&res[0].coordinateSource==='Rua do cliente (sem o número no mapa)',res[8].coordinateSource+' | '+res[0].coordinateSource);
  const antes=chamadas.length;await loc.locateAddress({endereco:ROMANEIO[10][0],cidade:'PEDREIRA',uf:'SP',cep:'13920-000'});
  check('segunda consulta do mesmo endereço não vai de novo ao serviço',chamadas.length===antes,String(chamadas.length-antes));

  console.log('D. Serviço de mapas fora do ar ou devolvendo lugar errado');
  // Serviço devolve a "Rua Cananeia" de São Paulo capital e o CEP também aponta para lá.
  loc=geo.createLocator({fetch:async()=>respostaPhoton([[-46.6498,-23.7068,'BR','house','','Rua Cananeia','210','São Paulo','Pedreira','São Paulo']]),geocodeCep});
  let r=await loc.locateAddress({endereco:'RUA CANANEIA,210-SN',cidade:'PEDREIRA',uf:'SP',cep:'13920-000'});
  check('resultado e CEP em outra cidade são recusados; fica a sede de Pedreira',r.precision==='cidade'&&km(r,ped)<0.1&&r.coordinateSource==='cidade-aproximada',JSON.stringify(r));
  // Tudo fora do ar: nenhuma entrega fica sem posição e o serviço deixa de ser martelado.
  chamadas=[];let agora=1e12;const logs=[];
  loc=geo.createLocator({fetch:async u=>{chamadas.push(String(u).slice(8,30));throw new Error('sem rede')},geocodeCep:async()=>null,now:()=>agora,log:m=>logs.push(m)});
  const fora=await Promise.all(ROMANEIO.map(([endereco,cidade,cep])=>loc.locateAddress({endereco,cidade,uf:'SP',cep})));
  check('sem serviço nenhum, as 12 entregas ficam na sede da cidade certa',fora.every((x,i)=>x&&x.precision==='cidade'&&geo.insideCity(x,ROMANEIO[i][1],'SP')===true));
  check('depois de 3 falhas seguidas o serviço entra em pausa (antes: esperava o tempo máximo em cada entrega)',chamadas.length<=8&&logs.some(m=>/photon em pausa/.test(m))&&logs.some(m=>/nominatim em pausa/.test(m)),chamadas.length+' chamadas; '+logs.join(' | '));
  const n0=chamadas.length;agora+=5*60*1000;await loc.locateAddress({endereco:'RUA NOVA, 10',cidade:'SOCORRO',uf:'SP'});
  check('durante a pausa nenhuma consulta é feita',chamadas.length===n0,String(chamadas.length-n0));
  agora+=6*60*1000;await loc.locateAddress({endereco:ROMANEIO[10][0],cidade:'PEDREIRA',uf:'SP',cep:'13920-000'});
  check('passados 10 minutos, tenta de novo (resultado ruim por falha não fica guardado 24 h)',chamadas.length>n0,String(chamadas.length-n0));
  r=await geo.createLocator({fetch:async()=>respostaPhoton([]),geocodeCep:async()=>null}).locateAddress({endereco:'RUA X, 1',cidade:'Cidade Que Nao Existe',uf:'SP'});
  check('cidade desconhecida e nada no mapa: devolve vazio, não inventa posição',r===null,JSON.stringify(r));

  // Achado no CT-e real AMR015326-5: "SITIO BAIRRO OLARIA" vira rua "SITIO", e o mapa devolvia
  // o "Sítio Ypiacas" (12 km do cliente) como se fosse a rua.
  const sitio=[{lat:-21.879048,lon:-46.733752,name:'Sítio Ypiacas',street:'Rua David de Carvalho',housenumber:'',city:'São João da Boa Vista',state:'São Paulo',type:'house'}];
  check('"SITIO BAIRRO OLARIA": sobra só "SITIO" como nome de rua',geo.cleanSswAddress('SITIO BAIRRO OLARIA','3').street==='SITIO');
  check('nome só com palavra genérica (SITIO) não casa com um sítio qualquer do mapa',geo.pickAddressResult(sitio,{street:'SITIO',number:'3',cidade:'SAO JOAO DA BOA VISTA',uf:'SP'})===null);
  check('  ...nem FAZENDA, CHACARA ou ZONA RURAL',geo.streetSimilarity('FAZENDA','Fazenda Santa Rita')===0&&geo.streetSimilarity('CHACARA','Chácara Bela Vista')===0&&geo.streetSimilarity('ZONA RURAL','Zona Rural')===0);
  check('com um nome que identifica, continua casando',geo.streetSimilarity('SITIO YPIACAS','Sítio Ypiacas')===1&&geo.streetSimilarity('FAZENDA SANTA RITA','Fazenda Santa Rita')===1&&geo.streetSimilarity('RUA DO SITIO VELHO','Rua do Sítio Velho')===1);
  check('ruas de verdade não são afetadas',geo.streetSimilarity('AVENIDA EMILIA MARCHI MARTINI','Avenida Emília Marchi Martini')===1&&geo.streetSimilarity('RUA JULIA PERES APARECIDO','Rua Julia Peres Aparecido')===1&&geo.streetSimilarity('RUA JARDIM','Rua Jardim')===1&&geo.streetSimilarity('AVENIDA DO PARQUE','Avenida do Parque')===1);

  console.log('\nResultado: '+pass+' OK, '+fail+' falha(s)');
  process.exit(fail?1:0)
})().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
