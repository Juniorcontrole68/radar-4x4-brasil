'use strict';
// CONSTRULOG WMS 360° — relatórios em PDF do recebimento e da expedição (A4, para imprimir e assinar).
// Recebe os dados já lidos do banco (montados em wms.js) e devolve o arquivo; não acessa o banco.
const {PDFDocument,StandardFonts,rgb}=require('pdf-lib');

const A4=[595.28,841.89],MARGEM=36,LARG=A4[0]-2*MARGEM;
const COR={texto:rgb(.12,.16,.22),fraco:rgb(.39,.45,.55),linha:rgb(.8,.84,.88),faixa:rgb(.95,.96,.98),titulo:rgb(.06,.24,.45),
  ok:rgb(.09,.5,.27),alerta:rgb(.71,.33,.04),erro:rgb(.6,.11,.11)};

// a fonte padrão do PDF só escreve o alfabeto latino (WinAnsi); o resto vira equivalente simples
const WIN=new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
function txt(v){
  return String(v??'').normalize('NFC').replace(/[→⇒]/g,'->').replace(/[←]/g,'<-').replace(/[×]/g,'x').replace(/[\r\n\t]+/g,' ')
    .replace(/./gu,ch=>{const c=ch.codePointAt(0);return(c>=32&&c<127)||(c>=160&&c<=255)||WIN.has(ch)?ch:'?'});
}
const fmtN=(v,c=0)=>v===null||v===undefined||v===''?'':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:c,maximumFractionDigits:c});
const qtd=v=>v===null||v===undefined?'':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:3});
function dataHora(v){
  if(!v)return'';const d=new Date(v);if(isNaN(d))return String(v);
  return d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function data(v){
  if(!v)return'';const s=String(v instanceof Date?v.toISOString():v).slice(0,10);const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:s;
}
const doc14=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===14?d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'):d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):d};
// eventos: {acao:{em,por}} lidos da auditoria do WMS
const ev=(o,acao)=>o.eventos?.[acao]||{em:null,por:''};
const chaveFmt=v=>String(v||'').replace(/(\d{4})(?=\d)/g,'$1 ');

class Relatorio{
  constructor(pdf,fontes,{titulo,numero,empresa,situacao,corSituacao,gerado}){
    Object.assign(this,{pdf,f:fontes.normal,b:fontes.negrito,titulo,numero,empresa,situacao,corSituacao,gerado,paginas:[]});
    this.novaPagina();
  }
  novaPagina(){
    const p=this.pdf.addPage(A4);this.p=p;this.paginas.push(p);
    let y=A4[1]-MARGEM;
    p.drawText(txt(this.empresa.toUpperCase()+' · WMS 360°'),{x:MARGEM,y:y-9,size:9,font:this.b,color:COR.fraco});
    p.drawText(txt(this.titulo),{x:MARGEM,y:y-28,size:17,font:this.b,color:COR.titulo});
    const n=txt('Nº '+this.numero),wn=this.b.widthOfTextAtSize(n,17);
    p.drawText(n,{x:MARGEM+LARG-wn,y:y-28,size:17,font:this.b,color:COR.titulo});
    const s=txt(this.situacao.toUpperCase()),ws=this.b.widthOfTextAtSize(s,9)+14;
    p.drawRectangle({x:MARGEM+LARG-ws,y:y-14,width:ws,height:14,borderColor:this.corSituacao,borderWidth:1});
    p.drawText(s,{x:MARGEM+LARG-ws+7,y:y-10,size:9,font:this.b,color:this.corSituacao});
    y-=38;p.drawLine({start:{x:MARGEM,y},end:{x:MARGEM+LARG,y},thickness:1.2,color:COR.titulo});
    this.y=y-12;
  }
  espaco(h){if(this.y-h<MARGEM+24)this.novaPagina()}
  quebra(texto,fonte,tam,larg){
    const pal=txt(texto).split(' '),linhas=[];let l='';
    for(const w of pal){
      const t=l?l+' '+w:w;
      if(fonte.widthOfTextAtSize(t,tam)<=larg){l=t;continue}
      if(l)linhas.push(l);
      // palavra maior que a coluna (chave, código): corta no caractere
      let r=w;while(fonte.widthOfTextAtSize(r,tam)>larg&&r.length>1){let k=r.length;while(k>1&&fonte.widthOfTextAtSize(r.slice(0,k),tam)>larg)k--;linhas.push(r.slice(0,k));r=r.slice(k)}
      l=r;
    }
    if(l||!linhas.length)linhas.push(l);
    return linhas;
  }
  secao(t,minimo=40){
    this.espaco(minimo);this.y-=6;
    this.p.drawRectangle({x:MARGEM,y:this.y-14,width:LARG,height:16,color:COR.faixa});
    this.p.drawText(txt(t.toUpperCase()),{x:MARGEM+6,y:this.y-10,size:9.5,font:this.b,color:COR.titulo});
    this.y-=22;
  }
  paragrafo(t,{tam=8.5,cor=COR.fraco}={}){
    for(const l of this.quebra(t,this.f,tam,LARG)){this.espaco(12);this.p.drawText(l,{x:MARGEM,y:this.y-tam,size:tam,font:this.f,color:cor});this.y-=tam+3}
    this.y-=3;
  }
  // grade de campos rótulo/valor, em colunas
  campos(lista,cols=3){
    const lc=LARG/cols;
    for(let i=0;i<lista.length;i+=cols){
      const linha=lista.slice(i,i+cols);
      const alt=Math.max(...linha.map(([,v,span])=>v===null?1:this.quebra(v||'—',this.b,9,lc*(span||1)-8).length))*11+(linha.some(([,v])=>v===null)?16:12);
      this.espaco(alt);
      let x=MARGEM;
      for(const [r,v,span] of linha){
        this.p.drawText(txt(r),{x,y:this.y-7,size:7,font:this.f,color:COR.fraco});
        if(v===null)this.p.drawLine({start:{x,y:this.y-22},end:{x:x+lc*(span||1)-12,y:this.y-22},thickness:.6,color:COR.fraco}); // em branco, para preencher à mão
        else this.quebra(v||'—',this.b,9,lc*(span||1)-8).forEach((l,k)=>this.p.drawText(l,{x,y:this.y-18-k*11,size:9,font:this.b,color:COR.texto}));
        x+=lc*(span||1);
      }
      this.y-=alt;
    }
  }
  // cols: [{t:'Título',w:fração,a:'r',v:linha=>texto,cor:linha=>rgb}]
  tabela(cols,linhas,{vazio='Nenhum registro.',tam=7.5}={}){
    const tot=cols.reduce((a,c)=>a+c.w,0),ws=cols.map(c=>c.w/tot*LARG);
    const cab=()=>{
      const alt=Math.max(...cols.map((c,i)=>this.quebra(c.t,this.b,7,ws[i]-6).length))*9+6;
      this.espaco(alt+14);
      this.p.drawRectangle({x:MARGEM,y:this.y-alt,width:LARG,height:alt,color:COR.titulo});
      let x=MARGEM;
      cols.forEach((c,i)=>{this.quebra(c.t,this.b,7,ws[i]-6).forEach((l,k)=>{const w=this.b.widthOfTextAtSize(l,7);
        this.p.drawText(l,{x:c.a==='r'?x+ws[i]-3-w:x+3,y:this.y-9-k*9,size:7,font:this.b,color:rgb(1,1,1)})});x+=ws[i]});
      this.y-=alt;
    };
    cab();
    if(!linhas.length){this.espaco(16);this.p.drawText(txt(vazio),{x:MARGEM+3,y:this.y-11,size:tam,font:this.f,color:COR.fraco});this.y-=16;this.y-=6;return}
    linhas.forEach((ln,idx)=>{
      const cel=cols.map((c,i)=>this.quebra(c.v(ln)??'',c.neg?this.b:this.f,tam,ws[i]-6));
      const alt=Math.max(...cel.map(x=>x.length))*(tam+2)+5;
      if(this.y-alt<MARGEM+24){this.novaPagina();cab()}
      if(idx%2)this.p.drawRectangle({x:MARGEM,y:this.y-alt,width:LARG,height:alt,color:COR.faixa});
      let x=MARGEM;
      cols.forEach((c,i)=>{const fo=c.neg?this.b:this.f,cor=c.cor?.(ln)||COR.texto;
        cel[i].forEach((l,k)=>{const w=fo.widthOfTextAtSize(l,tam);this.p.drawText(l,{x:c.a==='r'?x+ws[i]-3-w:x+3,y:this.y-tam-2-k*(tam+2),size:tam,font:fo,color:cor})});x+=ws[i]});
      this.y-=alt;
      this.p.drawLine({start:{x:MARGEM,y:this.y},end:{x:MARGEM+LARG,y:this.y},thickness:.4,color:COR.linha});
    });
    this.y-=8;
  }
  // quadros de resumo (número grande + rótulo)
  indicadores(lista){
    const w=LARG/lista.length;this.espaco(42);
    lista.forEach(([r,v,cor],i)=>{const x=MARGEM+i*w;
      this.p.drawRectangle({x:x+2,y:this.y-36,width:w-4,height:36,borderColor:COR.linha,borderWidth:.8});
      this.p.drawText(txt(v),{x:x+8,y:this.y-17,size:13,font:this.b,color:cor||COR.texto});
      this.p.drawText(txt(r),{x:x+8,y:this.y-29,size:7,font:this.f,color:COR.fraco})});
    this.y-=44;
  }
  // código de barras Code 128 (o mesmo das etiquetas do WMS)
  barras(padrao,legenda){
    const h=34,mod=Math.min(1,(LARG-20)/[...padrao].reduce((a,w)=>a+ +w,0));
    this.espaco(h+16);
    let x=MARGEM+10;
    [...padrao].forEach((w,i)=>{const l=+w*mod;if(i%2===0)this.p.drawRectangle({x,y:this.y-h,width:l,height:h,color:rgb(0,0,0)});x+=l});
    this.p.drawText(txt(legenda),{x:MARGEM+10,y:this.y-h-10,size:7.5,font:this.f,color:COR.texto});
    this.y-=h+18;
  }
  assinaturas(lista){
    this.espaco(70);this.y-=34;
    const w=LARG/lista.length;
    lista.forEach((t,i)=>{const x=MARGEM+i*w;
      this.p.drawLine({start:{x:x+8,y:this.y},end:{x:x+w-8,y:this.y},thickness:.7,color:COR.texto});
      this.quebra(t,this.f,7.5,w-16).forEach((l,k)=>this.p.drawText(l,{x:x+8,y:this.y-10-k*9,size:7.5,font:this.f,color:COR.fraco}))});
    this.y-=34;
  }
  rodapes(){
    const n=this.paginas.length;
    this.paginas.forEach((p,i)=>{
      p.drawLine({start:{x:MARGEM,y:MARGEM+8},end:{x:MARGEM+LARG,y:MARGEM+8},thickness:.5,color:COR.linha});
      p.drawText(txt('Gerado em '+dataHora(this.gerado.em)+' por '+(this.gerado.por||'—')+' · '+this.titulo+' nº '+this.numero),{x:MARGEM,y:MARGEM-2,size:7,font:this.f,color:COR.fraco});
      const t='Página '+(i+1)+' de '+n,w=this.f.widthOfTextAtSize(t,7);
      p.drawText(t,{x:MARGEM+LARG-w,y:MARGEM-2,size:7,font:this.f,color:COR.fraco});
    });
  }
}
async function novo(meta){
  const pdf=await PDFDocument.create();
  pdf.setTitle(txt(meta.titulo+' nº '+meta.numero));pdf.setAuthor(txt(meta.empresa));pdf.setCreator('WMS 360°');pdf.setProducer('WMS 360°');
  const fontes={normal:await pdf.embedFont(StandardFonts.Helvetica),negrito:await pdf.embedFont(StandardFonts.HelveticaBold)};
  return{pdf,r:new Relatorio(pdf,fontes,meta)};
}

const ST_REC={aguardando:['Aguardando chegada',COR.fraco],na_doca:['Na doca',COR.alerta],em_conferencia:['Em conferência',COR.alerta],recontagem:['Recontagem',COR.alerta],
  divergencia:['Com divergência',COR.erro],conferido:['Conferido',COR.ok],finalizado:['Finalizado',COR.ok],cancelado:['Cancelado',COR.erro]};
const TIPO_DIV={falta:'Falta',sobra:'Sobra',produto_errado:'Produto não previsto na nota',avaria:'Avaria'};
const ST_DIV={aberta:'Aberta (sem decisão)',aceita:'Aceita',bloqueada:'Aceita e bloqueada',recusada:'Recusada'};

// r: saída de lerRecebimento (sem conferência cega) + motorista_doc, armazem, produtos (peso/medidas) e barras (padrão Code 128 da chave)
async function pdfRecebimento(r,{empresa='Construlog',usuario=''}={}){
  const [st,cor]=ST_REC[r.status]||[r.status,COR.texto];
  const {pdf,r:d}=await novo({titulo:'Relatório de recebimento',numero:r.id,empresa,situacao:st,corSituacao:cor,gerado:{em:new Date(),por:usuario}});
  const rodadaFinal=p=>(r.recontar||[]).includes(String(p))?2:1;
  const contado=new Map(),avariado=new Map();
  for(const c of r.contagens)if(c.rodada===rodadaFinal(c.produto_id)){contado.set(c.produto_id,(contado.get(c.produto_id)||0)+c.qtd);avariado.set(c.produto_id,(avariado.get(c.produto_id)||0)+c.avariada)}
  const esperadoPor=new Map();for(const i of r.itens)if(i.produto_id)esperadoPor.set(i.produto_id,(esperadoPor.get(i.produto_id)||0)+i.qtd_esperada);
  const conferiu=r.contagens.length>0;
  const totEsp=r.itens.reduce((a,i)=>a+i.qtd_esperada,0),totCont=[...contado.values()].reduce((a,v)=>a+v,0),totAv=[...avariado.values()].reduce((a,v)=>a+v,0);
  const prod=new Map((r.produtos||[]).map(p=>[p.id,p]));
  const peso=r.itens.reduce((a,i)=>a+(prod.get(i.produto_id)?.peso_bruto_kg||0)*i.qtd_esperada,0);
  const m3=r.itens.reduce((a,i)=>a+(prod.get(i.produto_id)?.m3||0)*i.qtd_esperada,0);

  d.indicadores([['Itens na nota',fmtN(r.itens.length)],['Quantidade da nota',qtd(totEsp)],['Quantidade conferida',conferiu?qtd(totCont):'—',conferiu&&Math.abs(totCont-totEsp)>1e-9?COR.erro:COR.ok],
    ['Avariadas',conferiu?qtd(totAv):'—',totAv>0?COR.erro:null],['Divergências',fmtN(r.divergencias.length),r.divergencias.length?COR.alerta:null],['Paletes (LPN)',fmtN(r.lpns.length)]]);

  d.secao('Nota fiscal');
  d.campos([['Número / série',(r.nf_numero||'—')+(r.nf_serie?' / '+r.nf_serie:'')],['Emitente (fornecedor)',r.emitente_nome],['CNPJ do emitente',doc14(r.emitente_cnpj)],
    ['Cliente depositante',r.cliente?.nome],['CNPJ do cliente',doc14(r.cliente?.cnpj)],['Armazém',r.armazem],
    ['Chave de acesso',r.nf_chave?chaveFmt(r.nf_chave):'Lançado sem chave',3]]);
  if(r.barras)d.barras(r.barras,'Chave '+r.nf_chave);

  d.secao('Transporte e doca');
  d.campos([['Placa do veículo',r.placa],['Motorista',r.motorista],['Documento do motorista',r.motorista_doc],['Doca de descarga',r.doca],['Previsto para',data(r.previsto_para)],['Peso bruto estimado (cadastro)',peso?fmtN(peso,2)+' kg':''],
    ['Volume estimado (cadastro)',m3?fmtN(m3,3)+' m³':'']]);

  d.secao('Linha do tempo');
  d.tabela([{t:'Etapa',w:3,v:x=>x[0],neg:1},{t:'Data e hora',w:2,v:x=>x[1]},{t:'Responsável',w:2,v:x=>x[2]}],[
    ['Pré-aviso / lançamento da nota',dataHora(r.criado_em),r.criado_por],
    ['Chegada do veículo e liberação da doca',dataHora(r.chegada_em),ev(r,'chegada').por],
    ['Início da conferência cega',dataHora(r.conferencia_inicio_em),[...new Set(r.contagens.filter(c=>c.rodada===1).map(c=>c.usuario))].join(', ')],
    ...(r.contagens.some(c=>c.rodada===2)?[['Recontagem (2ª rodada)',dataHora(r.contagens.filter(c=>c.rodada===2).map(c=>c.criado_em).sort()[0]),[...new Set(r.contagens.filter(c=>c.rodada===2).map(c=>c.usuario))].join(', ')]]:[]),
    ['Fim da conferência',dataHora(r.conferencia_fim_em),ev(r,'fechar_conferencia').por],
    ...(r.divergencias.length?[['Decisão das divergências',dataHora(r.divergencias.map(x=>x.decisao_em).filter(Boolean).sort().pop()),[...new Set(r.divergencias.map(x=>x.decisao_por).filter(Boolean))].join(', ')]]:[]),
    ['Finalização: estoque lançado e LPNs geradas',dataHora(r.finalizado_em),ev(r,'finalizar').por],
    ...(r.status==='cancelado'?[['Cancelamento',dataHora(ev(r,'cancelar').em),ev(r,'cancelar').por]]:[]),
  ].map(x=>[x[0],x[1]||'—',x[2]||''])) ;

  d.secao('Itens da nota x conferência física');
  d.tabela([
    {t:'Item',w:.6,v:i=>String(i.n_item||'')},{t:'Código NF',w:1.4,v:i=>i.codigo},{t:'SKU',w:1.3,v:i=>i.sku||'sem vínculo',neg:1},{t:'Descrição',w:3.6,v:i=>i.produto||i.descricao},
    {t:'EAN',w:1.6,v:i=>i.ean},{t:'Qtd NF',w:1,a:'r',v:i=>qtd(i.qtd_nf)+' '+(i.unidade||'')},{t:'Fator',w:.7,a:'r',v:i=>qtd(i.fator)},{t:'Esperado (un)',w:1.1,a:'r',v:i=>qtd(i.qtd_esperada),neg:1},
    {t:'Lote / validade NF',w:1.5,v:i=>[i.lote,data(i.validade)].filter(Boolean).join(' · ')},
  ],r.itens);
  if(conferiu){
    const ids=[...new Set([...esperadoPor.keys(),...contado.keys()])];
    const nome=new Map([...r.itens.filter(i=>i.produto_id).map(i=>[i.produto_id,[i.sku,i.produto]]),...r.contagens.map(c=>[c.produto_id,[c.sku,c.produto]])]);
    d.paragrafo('Resultado por produto (vale a última rodada de cada produto: a recontagem substitui a 1ª contagem).');
    d.tabela([{t:'SKU',w:1.3,v:p=>nome.get(p)?.[0],neg:1},{t:'Produto',w:3.6,v:p=>nome.get(p)?.[1]},{t:'Esperado',w:1,a:'r',v:p=>qtd(esperadoPor.get(p)||0)},
      {t:'Contado',w:1,a:'r',v:p=>qtd(contado.get(p)||0),neg:1},{t:'Avariado',w:1,a:'r',v:p=>qtd(avariado.get(p)||0),cor:p=>(avariado.get(p)||0)>0?COR.erro:null},
      {t:'Diferença',w:1,a:'r',v:p=>{const x=(contado.get(p)||0)-(esperadoPor.get(p)||0);return(x>0?'+':'')+qtd(x)},cor:p=>Math.abs((contado.get(p)||0)-(esperadoPor.get(p)||0))>1e-9?COR.erro:COR.ok,neg:1},
      {t:'Rodada',w:.8,a:'r',v:p=>rodadaFinal(p)+'ª'}],ids);
  }

  d.secao('Contagens registradas (conferência cega)');
  d.tabela([{t:'Rod.',w:.5,v:c=>c.rodada+'ª'},{t:'SKU',w:1.3,v:c=>c.sku,neg:1},{t:'Produto',w:2.7,v:c=>c.produto},{t:'Lote',w:1.1,v:c=>c.lote},{t:'Validade',w:1.2,v:c=>data(c.validade)},
    {t:'Qtd',w:.8,a:'r',v:c=>qtd(c.qtd)},{t:'Avariada',w:1,a:'r',v:c=>qtd(c.avariada),cor:c=>c.avariada>0?COR.erro:null},{t:'Foto',w:.6,v:c=>c.tem_foto?'Sim':'—'},
    {t:'Conferente',w:1.5,v:c=>c.usuario},{t:'Data e hora',w:1.5,v:c=>dataHora(c.criado_em)}],r.contagens,{vazio:'Ainda não houve contagem.'});

  d.secao('Divergências e decisões');
  d.tabela([{t:'Tipo',w:1.6,v:x=>TIPO_DIV[x.tipo]||x.tipo,neg:1,cor:()=>COR.erro},{t:'SKU',w:1.2,v:x=>x.sku},{t:'Produto',w:2.6,v:x=>x.produto},{t:'Esperado',w:1.1,a:'r',v:x=>qtd(x.qtd_esperada)},
    {t:'Contado',w:1,a:'r',v:x=>qtd(x.qtd_contada)},{t:'Qtd',w:.8,a:'r',v:x=>qtd(x.qtd),neg:1},{t:'Decisão',w:1.5,v:x=>ST_DIV[x.status]||x.status},{t:'Por / quando',w:1.7,v:x=>[x.decisao_por,dataHora(x.decisao_em)].filter(Boolean).join(' · ')},
    {t:'Observação',w:1.8,v:x=>x.obs}],r.divergencias,{vazio:'Sem divergências: a conferência bateu com a nota.'});

  d.secao('Paletes gerados (LPN) e armazenagem');
  d.tabela([{t:'LPN',w:1.5,v:l=>l.codigo,neg:1},{t:'Conteúdo (SKU · qtd · estado)',w:3.8,v:l=>l.conteudo||'(vazio: já saiu ou foi movido)'},{t:'Endereço atual',w:1.3,v:l=>l.endereco},
    {t:'Endereço sugerido',w:1.3,v:l=>l.sugerido},{t:'Tarefa de armazenagem',w:1.4,v:l=>({pendente:'Pendente',em_execucao:'Em execução',concluida:'Concluída',cancelada:'Cancelada'})[l.tarefa_status]||'—',
      cor:l=>l.tarefa_status==='concluida'?COR.ok:l.tarefa_status?COR.alerta:null}],r.lpns,{vazio:'As LPNs são geradas ao finalizar o recebimento.'});

  d.secao('Observações');
  d.paragrafo('Conferência cega: o conferente registra o que conta sem ver a quantidade da nota. Diferenças geram recontagem por outro conferente (quando a regra do cliente pede) e, persistindo, divergência para decisão da gestão. Mercadoria aceita entra como disponível; bloqueada ou avariada entra separada e não vai para a expedição.');
  d.assinaturas(['Conferente','Motorista / transportadora','Responsável pelo recebimento']);
  d.rodapes();
  return Buffer.from(await pdf.save());
}

const ST_EXP={aberta:['Aberta',COR.fraco],separando:['Em separação',COR.alerta],separada:['Separada na doca',COR.alerta],expedida:['Expedida',COR.ok],cancelada:['Cancelada',COR.erro]};

// x: saída de lerExpedicao + armazem, produtos (peso/medidas) e barras
async function pdfExpedicao(x,{empresa='Construlog',usuario=''}={}){
  const [st,cor]=ST_EXP[x.status]||[x.status,COR.texto];
  const {pdf,r:d}=await novo({titulo:'Romaneio de expedição',numero:x.id,empresa,situacao:st,corSituacao:cor,gerado:{em:new Date(),por:usuario}});
  const prod=new Map((x.produtos||[]).map(p=>[p.id,p]));
  const tot=x.itens.reduce((a,i)=>a+i.qtd,0),sep=x.itens.reduce((a,i)=>a+i.separado,0);
  const peso=x.itens.reduce((a,i)=>a+(prod.get(i.produto_id)?.peso_bruto_kg||0)*i.qtd,0),m3=x.itens.reduce((a,i)=>a+(prod.get(i.produto_id)?.m3||0)*i.qtd,0);
  const paletes=new Set(x.separacao.filter(s=>s.lpn).map(s=>s.lpn)).size;
  d.indicadores([['Itens na nota',fmtN(x.itens.length)],['Quantidade pedida',qtd(tot)],['Quantidade separada',qtd(sep),Math.abs(sep-tot)>1e-9?COR.alerta:COR.ok],
    ['Linhas de separação',fmtN(x.separacao.length)],['Paletes inteiros',fmtN(paletes)],['Peso bruto (cad.)',peso?fmtN(peso,1)+' kg':'—']]);

  d.secao('Nota fiscal de saída');
  d.campos([['Número / série',(x.nf_numero||'—')+(x.nf_serie?' / '+x.nf_serie:'')],['Cliente depositante',x.cliente?.nome],['CNPJ do cliente',doc14(x.cliente?.cnpj)],
    ['Destinatário',x.destinatario_nome],['CNPJ / CPF do destinatário',doc14(x.destinatario_cnpj)],['Armazém',x.armazem],
    ['Chave de acesso',x.nf_chave?chaveFmt(x.nf_chave):'Lançada sem chave',3]]);
  if(x.barras)d.barras(x.barras,'Chave '+x.nf_chave);

  d.secao('Carregamento');
  d.campos([['Doca de expedição',x.doca],['Placa do veículo',x.placa||null],['Expedida por',x.expedida_por],
    ['Peso bruto estimado (cadastro)',peso?fmtN(peso,2)+' kg':''],['Volume estimado (cadastro)',m3?fmtN(m3,3)+' m³':''],['Motorista',null]]);

  d.secao('Linha do tempo');
  const separadores=[...new Set(x.separacao.map(s=>s.separado_por).filter(Boolean))].join(', ');
  d.tabela([{t:'Etapa',w:3,v:y=>y[0],neg:1},{t:'Data e hora',w:2,v:y=>y[1]||'—'},{t:'Responsável',w:2,v:y=>y[2]||''}],[
    ['Nota lançada',dataHora(x.criado_em),x.criado_por],
    ['Reserva do estoque (primeiro que vence, primeiro que sai)',dataHora(ev(x,'reservar').em),ev(x,'reservar').por],
    ['Separação concluída e mercadoria na doca',dataHora(x.separada_em),separadores],
    ['Expedição: baixa definitiva do estoque',dataHora(x.expedida_em),x.expedida_por],
    ...(x.status==='cancelada'?[['Cancelamento',dataHora(ev(x,'cancelar').em),ev(x,'cancelar').por]]:[])]);

  d.secao('Itens da nota');
  d.tabela([{t:'Item',w:.6,v:i=>String(i.n_item||'')},{t:'Código NF',w:1.3,v:i=>i.codigo},{t:'SKU',w:1.3,v:i=>i.sku||'sem vínculo',neg:1},{t:'Descrição',w:3.4,v:i=>i.produto||i.descricao},
    {t:'Lote',w:1,v:i=>i.lote},{t:'Qtd NF',w:1,a:'r',v:i=>qtd(i.qtd_nf)+' '+(i.unidade||'')},{t:'Fator',w:.6,a:'r',v:i=>qtd(i.fator)},{t:'Qtd (un)',w:.9,a:'r',v:i=>qtd(i.qtd),neg:1},
    {t:'Reserv.',w:.9,a:'r',v:i=>qtd(i.reservado)},{t:'Separ.',w:.9,a:'r',v:i=>qtd(i.separado),neg:1,cor:i=>Math.abs(i.separado-i.qtd)>1e-9?COR.alerta:COR.ok},
    {t:'Peso kg',w:1,a:'r',v:i=>{const p=prod.get(i.produto_id)?.peso_bruto_kg;return p?fmtN(p*i.qtd,2):''}}],x.itens);

  d.secao('Lista de separação (ordem de caminhada)');
  d.tabela([{t:'#',w:.4,v:s=>String(x.separacao.indexOf(s)+1)},{t:'Endereço',w:1.2,v:s=>s.endereco,neg:1},{t:'SKU',w:1.2,v:s=>s.sku,neg:1},{t:'Produto',w:2.2,v:s=>s.produto},{t:'EAN',w:1.3,v:s=>s.ean},
    {t:'Lote',w:.8,v:s=>s.lote},{t:'Validade',w:1.1,v:s=>data(s.validade)},{t:'Palete (LPN)',w:1.4,v:s=>s.lpn||'fracionado'},{t:'Qtd',w:.7,a:'r',v:s=>qtd(s.qtd),neg:1},
    {t:'Sep.',w:.7,a:'r',v:s=>qtd(s.qtd_separada),cor:s=>s.status==='separada'?COR.ok:COR.alerta},{t:'Separador / quando',w:1.9,v:s=>[s.separado_por,dataHora(s.separado_em)].filter(Boolean).join(' · ')}],
    x.separacao,{vazio:'A lista aparece depois de reservar o estoque.'});

  d.secao('Conferência de carregamento',190);
  d.campos([['Volumes conferidos',null],['Lacre(s)',null],['Hora de saída',null],['Condição da carga',null],['Avarias no carregamento',null],['Observações',null]]);
  d.paragrafo('Declaro que recebi a mercadoria acima em perfeitas condições, na quantidade e nos volumes indicados, salvo ressalvas anotadas neste romaneio.',{tam:8.5,cor:COR.texto});
  d.assinaturas(['Separador','Conferente da expedição','Motorista (nome, documento e assinatura)']);
  d.rodapes();
  return Buffer.from(await pdf.save());
}

module.exports={pdfRecebimento,pdfExpedicao,txt};
