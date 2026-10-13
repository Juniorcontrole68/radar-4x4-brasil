/* Motor do Roteirizador: leitura de NF-e, cadastro de produtos, encaixe de tubos,
   carregamento, roteirização com frota heterogênea e cálculo financeiro.
   Sem dependências; roda no navegador e no Node (testes). */
(function (G) {
  'use strict';
  const RE = {};

  // ---------- utilidades ----------
  const num = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[R$\s]/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(,\d+)$/.test(s)) s = s.replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  };
  RE.num = num;
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  RE.round = round;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  RE.norm = norm;
  const hm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  RE.hm = hm;
  const fmtHM = (min) => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  RE.fmtHM = fmtHM;

  // datas ISO (AAAA-MM-DD) sem fuso: tudo calculado em dias de calendário
  const dISO = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  const pISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  RE.addDays = (s, n) => { const d = pISO(s); d.setUTCDate(d.getUTCDate() + n); return dISO(d); };
  RE.weekday = (s) => pISO(s).getUTCDay();
  RE.parseDateBR = (s) => {
    if (!s) return null;
    s = String(s).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      const d = +m[1], mo = +m[2];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
      return dISO(dt);
    }
    if (/^\d{5}$/.test(s)) { // número de série do Excel
      const dt = new Date(Date.UTC(1899, 11, 30)); dt.setUTCDate(dt.getUTCDate() + (+s)); return dISO(dt);
    }
    return null;
  };
  RE.DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const haversine = (a, b) => {
    const R = 6371, t = Math.PI / 180;
    const dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  RE.haversine = haversine;

  // ---------- municípios (tabela IBGE embutida) ----------
  let MUN = null, MUN_BY_NAME = null;
  RE.loadMunicipios = (packed) => {
    MUN = new Map(); MUN_BY_NAME = new Map();
    for (const row of packed.split('|')) {
      const [c, n, uf, la, lo] = row.split(';');
      const o = { cod: c, nome: n, uf, lat: +la, lon: +lo };
      MUN.set(c, o);
      MUN_BY_NAME.set(norm(n) + '/' + uf, o);
    }
  };
  RE.findMun = (cod, nome, uf) => {
    if (!MUN) return null;
    if (cod && MUN.has(String(cod))) return MUN.get(String(cod));
    if (nome && uf) return MUN_BY_NAME.get(norm(nome) + '/' + norm(uf)) || null;
    return null;
  };
  RE.munList = () => (MUN ? [...MUN.values()] : []);

  // ---------- XML NF-e (leitor próprio, sem DOM) ----------
  const ent = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  const blocks = (xml, name) => {
    const out = [];
    const re = new RegExp('<(?:\\w+:)?' + name + '(\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + name + '>', 'g');
    let m; while ((m = re.exec(xml))) out.push({ attrs: m[1] || '', inner: m[2] });
    return out;
  };
  const block = (xml, name) => { const b = blocks(xml, name); return b.length ? b[0].inner : ''; };
  // números do XML da NF-e usam sempre ponto decimal
  const numX = (v) => { if (v == null || v === '') return null; const n = parseFloat(v); return isFinite(n) ? n : null; };
  const tag = (xml, name) => { const b = blocks(xml, name); return b.length ? ent(b[0].inner.trim()) : ''; };

  // Lê um XML (nfeProc, NFe ou evento). Retorna {tipo:'nfe', nota} | {tipo:'cancelamento', chave} | {tipo:'ignorado', motivo}
  RE.parseNFeXML = (xml) => {
    xml = String(xml || '').replace(/^﻿/, '');
    if (/<(?:\w+:)?infEvento/.test(xml) && !/<(?:\w+:)?infNFe/.test(xml)) {
      const tp = tag(xml, 'tpEvento');
      const ch = tag(xml, 'chNFe');
      if (tp === '110111' && ch) return { tipo: 'cancelamento', chave: ch };
      return { tipo: 'ignorado', motivo: 'Evento ' + (tp || 'desconhecido') + ' sem efeito na carga' };
    }
    const inf = blocks(xml, 'infNFe')[0];
    if (!inf) return { tipo: 'ignorado', motivo: 'Arquivo não é uma NF-e' };
    let chave = (/Id\s*=\s*"NFe(\d{44})"/.exec(inf.attrs) || [])[1] || tag(xml, 'chNFe');
    const x = inf.inner;
    const ide = block(x, 'ide'), emit = block(x, 'emit'), dest = block(x, 'dest');
    const ender = block(dest, 'enderDest');
    const entrega = block(x, 'entrega');
    const src = entrega && tag(entrega, 'xMun') ? entrega : ender;
    const endereco = {
      lgr: tag(src, 'xLgr'), nro: tag(src, 'nro'), cpl: tag(src, 'xCpl'), bairro: tag(src, 'xBairro'),
      cMun: tag(src, 'cMun'), cidade: tag(src, 'xMun'), uf: tag(src, 'UF'),
      cep: (tag(src, 'CEP') || tag(ender, 'CEP')).replace(/\D/g, ''),
      localEntregaDiferente: !!(entrega && tag(entrega, 'xMun')),
    };
    const itens = blocks(x, 'det').map((d) => {
      const p = block(d.inner, 'prod');
      return {
        cod: tag(p, 'cProd'), desc: tag(p, 'xProd'), ncm: tag(p, 'NCM'), un: tag(p, 'uCom'),
        qtd: numX(tag(p, 'qCom')) || 0, vProd: numX(tag(p, 'vProd')) || 0, info: tag(d.inner, 'infAdProd'),
      };
    });
    const transp = block(x, 'transp');
    let pesoB = 0, pesoL = 0, qVol = 0, temPeso = false;
    for (const v of blocks(transp, 'vol')) {
      const b = numX(tag(v.inner, 'pesoB')), l = numX(tag(v.inner, 'pesoL')), q = numX(tag(v.inner, 'qVol'));
      if (b != null) { pesoB += b; temPeso = true; }
      if (l != null) { pesoL += l; temPeso = true; }
      if (q != null) qVol += q;
    }
    const tot = block(x, 'ICMSTot');
    const dh = tag(ide, 'dhEmi') || tag(ide, 'dEmi');
    const nota = {
      chave: chave || '',
      numero: tag(ide, 'nNF'), serie: tag(ide, 'serie'),
      emissao: dh ? dh.slice(0, 10) : '',
      emitente: tag(emit, 'xNome'), emitenteDoc: tag(emit, 'CNPJ') || tag(emit, 'CPF'),
      destNome: tag(dest, 'xNome'), destDoc: tag(dest, 'CNPJ') || tag(dest, 'CPF'),
      destFone: tag(ender, 'fone'),
      endereco, itens,
      pesoB: temPeso ? round(pesoB || pesoL, 3) : null,
      pesoL: temPeso ? round(pesoL, 3) : null,
      qVol: qVol || null,
      valorMerc: numX(tag(tot, 'vNF')) || numX(tag(tot, 'vProd')) || 0,
      freteXml: numX(tag(tot, 'vFrete')) || 0,
      modFrete: tag(transp, 'modFrete'),
      obs: tag(block(x, 'infAdic'), 'infCpl'),
      origem: 'xml',
      tpNF: tag(ide, 'tpNF'),
    };
    return { tipo: 'nfe', nota };
  };

  // Decompõe a chave de acesso (44 dígitos)
  RE.parseChave = (ch) => {
    ch = String(ch || '').replace(/\D/g, '');
    if (ch.length !== 44) return null;
    // dígito verificador módulo 11
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) { soma += (+ch[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11, dv = r < 2 ? 0 : 11 - r;
    return { chave: ch, cUF: ch.slice(0, 2), aamm: ch.slice(2, 6), cnpj: ch.slice(6, 20), modelo: ch.slice(20, 22), serie: String(+ch.slice(22, 25)), numero: String(+ch.slice(25, 34)), valida: dv === +ch[43] };
  };

  // Texto de DANFE (PDF) -> notas parciais (uma por chave encontrada)
  RE.parseDanfeText = (pages) => {
    const notas = [];
    let cur = null;
    for (const raw of pages) {
      const t = raw.replace(/\s+/g, ' ');
      // a chave pode vir em blocos de 4, sem espaço, com pontos ou partida pelo leitor do PDF: junta os dígitos
      // de cada trecho e procura 44 dígitos com dígito verificador válido; a que vem depois de "CHAVE DE ACESSO" ganha
      const achar = (txt) => {
        const runs = txt.replace(/(\d)[\s.\-\/]{1,3}(?=\d)/g, '$1').match(/\d{44,}/g) || [], out = [];
        for (const r of runs) for (let i = 0; i + 44 <= r.length; i++) { const c = RE.parseChave(r.slice(i, i + 44)); if (c && c.valida && /^(1[1-7]|2[1-9]|3[1-35]|4[1-3]|5[0-3])$/.test(c.cUF) && c.modelo === '55') { out.push(c.chave); i += 43; } }
        return out;
      };
      const lab = /CHAVE\s+DE\s+ACESSO/i.exec(t);
      const chaves = [...new Set([].concat(lab ? achar(t.slice(lab.index, lab.index + 200)) : [], achar(t)))];
      if (chaves.length && (!cur || cur.chave !== chaves[0])) {
        const c = RE.parseChave(chaves[0]);
        cur = { chave: c.chave, numero: c.numero, serie: c.serie, emitenteDoc: c.cnpj, itens: [], origem: 'pdf', textoPdf: '' };
        notas.push(cur);
      }
      if (!cur) continue;
      cur.textoPdf += ' ' + t;
    }
    for (const n of notas) {
      const t = n.textoPdf;
      const g = (re) => { const m = re.exec(t); return m ? m[1].trim() : ''; };
      n.emissao = RE.parseDateBR(g(/DATA (?:DA |DE )?EMISS[ÃA]O\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)) || '';
      n.pesoB = num(g(/PESO BRUTO\s*:?\s*([\d.,]+)/i));
      n.pesoL = num(g(/PESO L[ÍI]QUIDO\s*:?\s*([\d.,]+)/i));
      n.valorMerc = num(g(/VALOR TOTAL DA NOTA\s*:?\s*(?:R\$)?\s*([\d.,]+)/i)) || 0;
      n.freteXml = num(g(/VALOR DO FRETE\s*:?\s*(?:R\$)?\s*([\d.,]+)/i)) || 0;
      const ceps = t.match(/\b\d{5}-\d{3}\b/g) || [];
      const dn = g(/DESTINAT[ÁA]RIO\s*\/?\s*REMETENTE.*?NOME\s*\/?\s*RAZ[ÃA]O SOCIAL\s*(.{3,60}?)\s+(?:CNPJ|CPF)/i);
      const ufMun = /MUNIC[ÍI]PIO\s+(?:FONE\s*\/?\s*FAX\s+)?UF\s+(?:INSCRI[ÇC][ÃA]O ESTADUAL\s+)?([A-ZÀ-Ú][A-ZÀ-Ú' \-]{2,40}?)\s+(?:\(?\d{2}\)?\s*[\d\- ]{8,}\s+)?([A-Z]{2})\b/i.exec(t);
      n.destNome = dn;
      n.endereco = { lgr: '', nro: '', bairro: '', cidade: ufMun ? ufMun[1].trim() : '', uf: ufMun ? ufMun[2] : '', cep: (ceps[1] || ceps[0] || '').replace(/\D/g, ''), cMun: '' };
      // tubo na nota: procura nos produtos (do quadro de produtos até os dados adicionais)
      const prod = (/DADOS\s+DOS?\s+PRODUTOS?([\s\S]*?)(?:DADOS\s+ADICIONAIS|C[ÁA]LCULO\s+DO\s+ISSQN|$)/i.exec(t) || [])[1] || t;
      n.exigeTubo = /\bTUBOS?\b/i.test(prod);
      n.mercadoria = n.exigeTubo ? 'COM TUBO' : '';
      n.pdfParcial = true;
      delete n.textoPdf;
    }
    return notas;
  };

  // CSV simples (separador ; ou , com aspas)
  RE.parseCSV = (text) => {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  };

  const COLS = {
    chave: ['CHAVE', 'CHAVE DE ACESSO', 'CHAVE NFE'], ctrc: ['CTRC', 'CTE', 'CT-E', 'NUMERO CTRC'], emitente: ['REMETENTE', 'EMBARCADOR', 'EMITENTE'], qVol: ['VOLUMES', 'QTD VOLUMES', 'QTDE VOLUMES'], mercadoria: ['MERCADORIA', 'TIPO MERCADORIA', 'CARGA'], numero: ['NUMERO', 'NF', 'NOTA', 'NUMERO NF', 'N NF', 'NUM NF', 'NFE'],
    serie: ['SERIE'], destNome: ['DESTINATARIO', 'CLIENTE', 'NOME', 'RAZAO SOCIAL'], destDoc: ['CNPJ', 'CPF', 'CNPJ/CPF', 'DOCUMENTO'],
    lgr: ['ENDERECO', 'LOGRADOURO', 'RUA'], nro: ['NUMERO ENDERECO', 'NRO', 'NUM'], bairro: ['BAIRRO'], cidade: ['CIDADE', 'MUNICIPIO'],
    uf: ['UF', 'ESTADO'], cep: ['CEP'], pesoB: ['PESO', 'PESO BRUTO', 'PESO KG', 'KG'], volM3: ['VOLUME', 'M3', 'VOLUME M3', 'CUBAGEM'],
    valorMerc: ['VALOR', 'VALOR NF', 'VALOR MERCADORIA', 'VALOR TOTAL'], frete: ['FRETE', 'VALOR FRETE', 'FRETE RECEBIDO'],
    emissao: ['EMISSAO', 'DATA EMISSAO', 'DATA'], prazo: ['PRAZO', 'DATA LIMITE', 'ENTREGA ATE', 'DATA ENTREGA', 'PREVISAO', 'PREVISAO ENTREGA'],
    desc: ['PRODUTO', 'DESCRICAO', 'MERCADORIA'], qtd: ['QUANTIDADE', 'QTD', 'QTDE'], cod: ['CODIGO', 'COD PRODUTO', 'SKU'],
    diam: ['DIAMETRO', 'DIAMETRO MM', 'DE MM'], compr: ['COMPRIMENTO', 'COMPRIMENTO M'], lat: ['LAT', 'LATITUDE'], lon: ['LON', 'LNG', 'LONGITUDE'],
  };
  RE.mapHeaders = (hdr) => {
    const map = {};
    const H = hdr.map((h) => norm(h).replace(/[^A-Z0-9/ ]/g, '').replace(/\s+/g, ' ').trim());
    for (const [k, syn] of Object.entries(COLS)) {
      const i = H.findIndex((h) => syn.includes(h));
      if (i >= 0 && !Object.values(map).includes(i)) map[k] = i;
    }
    return map;
  };
  // Linhas de planilha -> notas. Linhas com a mesma chave/número viram itens da mesma nota.
  RE.rowsToNotas = (rows) => {
    if (rows.length < 2) return [];
    const map = RE.mapHeaders(rows[0]);
    const byKey = new Map();
    for (const r of rows.slice(1)) {
      const g = (k) => (map[k] != null ? String(r[map[k]] == null ? '' : r[map[k]]).trim() : '');
      const chave = g('chave').replace(/\D/g, '');
      const key = chave || (g('numero') + '/' + g('serie') + '/' + g('destDoc') + g('destNome'));
      if (!key.replace(/\//g, '')) continue;
      let n = byKey.get(key);
      if (!n) {
        n = {
          chave: chave.length === 44 ? chave : '', numero: g('numero'), serie: g('serie'), emissao: RE.parseDateBR(g('emissao')) || '',
          destNome: g('destNome'), destDoc: g('destDoc').replace(/\D/g, ''),
          endereco: { lgr: g('lgr'), nro: g('nro'), bairro: g('bairro'), cidade: g('cidade'), uf: g('uf').toUpperCase(), cep: g('cep').replace(/\D/g, ''), cMun: '' },
          pesoB: num(g('pesoB')), volM3: num(g('volM3')), valorMerc: num(g('valorMerc')) || 0, freteXml: 0,
          frete: num(g('frete')), prazo: RE.parseDateBR(g('prazo')) || '', itens: [], origem: 'planilha',
          ctrc: g('ctrc'), emitente: g('emitente'), qVol: num(g('qVol')), mercadoria: g('mercadoria'), exigeTubo: /TUBO/i.test(g('mercadoria')),
          lat: num(g('lat')), lon: num(g('lon')),
        };
        if (chave.length === 44) { const c = RE.parseChave(chave); if (c) { n.numero = n.numero || c.numero; n.serie = n.serie || c.serie; } }
        byKey.set(key, n);
      } else {
        const p = num(g('pesoB')); if (p != null) n.pesoB = (n.pesoB || 0) + p;
        const v = num(g('volM3')); if (v != null) n.volM3 = (n.volM3 || 0) + v;
      }
      if (g('desc')) {
        const it = { cod: g('cod'), desc: g('desc'), qtd: num(g('qtd')) || 1, un: '', vProd: 0 };
        const dmm = num(g('diam')), cm = num(g('compr'));
        if (dmm) it.desc += ' ' + dmm + 'MM';
        if (cm) it.desc += ' ' + String(cm).replace('.', ',') + 'M';
        n.itens.push(it);
      }
    }
    return [...byKey.values()];
  };

  // Linha de "CTRCs disponíveis para entrega" (SSW opção 038, pendências) -> nota
  RE.notaDoSSW = (r) => {
    const merc = [r.mercadoria, r.detalhes].filter(Boolean).join(' ');
    return {
      numero: String(r.nf || '').replace(/^0+/, ''), serie: '', ctrc: r.ctrc || '', emitente: r.remetente || '', destNome: r.cliente || '',
      endereco: { lgr: r.endereco || '', nro: '', bairro: '', cidade: r.cidade || '', uf: r.uf || 'SP', cep: '', cMun: '' },
      pesoB: r.peso > 0 ? r.peso : null, volM3: r.m3 > 0 ? r.m3 : null, qVol: r.volumes || null, valorMerc: r.valorMerc || 0, freteXml: 0,
      frete: r.frete > 0 ? r.frete : null, prazo: RE.parseDateBR(r.previsao) || '', itens: [], origem: 'ssw', mercadoria: r.mercadoria || '',
      obs: r.detalhes || '', exigeTubo: /\bTUBO/i.test(merc), statusSSW: r.status || '',
    };
  };

  // ---------- reconhecimento de produtos ----------
  const NPS = { '1/2': 21.3, '3/4': 26.7, '1': 33.4, '1.1/4': 42.2, '1.1/2': 48.3, '2': 60.3, '2.1/2': 73.0, '3': 88.9, '4': 114.3, '5': 141.3, '6': 168.3, '8': 219.1, '10': 273.1, '12': 323.9 };
  RE.classificar = (desc) => {
    const d = norm(desc);
    if (/\bCAIXA D.?AGUA\b|\bCX D.?AGUA\b|\bRESERVATORIO\b|\bCAIXA DAGUA\b/.test(d)) return 'caixa_agua';
    if (/\b(JOELHO|LUVA|CURVA|CONEXAO|ADAPTADOR|REDUCAO|BUCHA|TAMPAO|CAP|UNIAO|COLAR|REGISTRO|VALVULA|FLANGE|TE)\b/.test(d)) return 'conexao';
    if (/\b(TUBO|TUBOS|TB|CANO|BARRA TUBO)\b/.test(d)) return 'tubo';
    return 'outro';
  };
  RE.materialDe = (desc) => {
    const d = norm(desc);
    if (/PEAD|POLIETILENO/.test(d)) return 'PEAD';
    if (/PVC/.test(d)) return 'PVC';
    if (/GALV|ACO|FERRO|CARBONO|INOX/.test(d)) return 'AÇO';
    if (/PPR|POLIPROPILENO/.test(d)) return 'PPR';
    if (/CONCRETO/.test(d)) return 'CONCRETO';
    if (/COBRE/.test(d)) return 'COBRE';
    return '';
  };
  // Extrai dimensões de tubo da descrição. Só devolve o que está escrito.
  RE.dimsDaDescricao = (desc) => {
    const d = norm(desc).replace(/,/g, '.');
    const out = {};
    let m = /(?:\bDN|\bDE|\bØ|\bDIAM\.?|\bD\.)\s*(\d{2,4}(?:\.\d+)?)/.exec(d) || /(\d{2,4}(?:\.\d+)?)\s*MM\b/.exec(d);
    if (m) out.de = +m[1];
    else {
      m = /(\d(?:\.\d\/\d)?|\d\/\d)\s*(?:"|POL\b|POLEGADA)/.exec(d);
      if (m && NPS[m[1]]) { out.dePol = m[1]; out.deNpsSugerido = NPS[m[1]]; }
    }
    m = /(?:\bX\s*|\bC\/\s*|\bCOMP\.?\s*|\bBARRA\s*(?:DE\s*)?)?(\d{1,2}(?:\.\d{1,2})?)\s*(?:M|MT|MTS|METROS?)\b(?!M)/.exec(d.replace(/(\d)\s*MM\b/g, '$1MM'));
    if (m && +m[1] > 0.2 && +m[1] <= 13) out.compr = +m[1];
    m = /(?:ESP\.?|ESPESSURA|PAREDE|E=)\s*(\d{1,2}(?:\.\d+)?)\s*(?:MM)?/.exec(d);
    if (m) out.esp = +m[1];
    m = /\bDI\s*(\d{2,4}(?:\.\d+)?)/.exec(d);
    if (m) out.di = +m[1];
    m = /\bSDR\s*(\d{1,2}(?:\.\d+)?)/.exec(d);
    if (m && out.de && !out.esp) out.esp = round(out.de / +m[1], 1);
    return out;
  };

  // Procura o produto no cadastro: código exato, depois texto contido na descrição
  RE.matchProduto = (it, produtos) => {
    if (!produtos || !produtos.length) return null;
    if (it.cod) { const p = produtos.find((p) => p.codigo && norm(p.codigo) === norm(it.cod)); if (p) return p; }
    const d = norm(it.desc);
    let best = null;
    for (const p of produtos) {
      const t = norm(p.padrao || '');
      if (t && d.includes(t) && (!best || t.length > norm(best.padrao).length)) best = p;
    }
    return best;
  };

  const DENS = { PVC: 1.40, PEAD: 0.95, 'AÇO': 7.85, PPR: 0.90, CONCRETO: 2.40, COBRE: 8.96 };
  // Enriquecimento de uma nota com cadastro, unidades e pendências. Não inventa peso, volume nem frete.
  RE.enriquecer = (nota, ctx) => {
    const produtos = ctx.produtos || [];
    const cfg = ctx.cfg || {};
    const pend = [], avisos = [];
    let volItens = 0, volItensCompleto = true, pesoItens = 0, pesoItensCompleto = true, tuboSemMedida = false;
    const itens = (nota.itens || []).map((it0) => {
      const it = Object.assign({}, it0);
      const p = RE.matchProduto(it, produtos);
      it.produtoId = p ? p.id : null;
      it.tipo = p && p.tipo ? p.tipo : RE.classificar(it.desc);
      const un = norm(it.un);
      if (it.tipo === 'tubo') {
        const dd = RE.dimsDaDescricao(it.desc);
        const t = {
          de: p && p.diamExtMm || dd.de || null,
          esp: p && p.espMm || dd.esp || null,
          di: p && p.diamIntMm || dd.di || null,
          compr: p && p.comprM || dd.compr || null,
          material: p && p.material || RE.materialDe(it.desc),
          encaixavel: p ? p.encaixavel !== false : true,
          pesoUnit: p && p.pesoUnitKg || null,
          dims: p && (p.diamExtMm || p.comprM) ? 'cadastro' : 'descricao',
        };
        if (!t.di && t.de && t.esp) t.di = round(t.de - 2 * t.esp, 1);
        // vendido por metro: quantidade em metros -> barras
        let barras = it.qtd;
        if ((un === 'M' || un === 'MT' || un === 'MTS' || un === 'METRO') && t.compr) barras = Math.ceil(it.qtd / t.compr - 1e-9);
        t.barras = Math.max(0, Math.round(barras));
        // tubo sem medida não trava mais a nota: ela vai obrigatoriamente na van com tubo (sem a conta do encaixe)
        if (!t.de || !t.compr) { tuboSemMedida = true; avisos.push({ cod: 'tubo_sem_medida', msg: 'Tubo sem ' + (!t.de ? 'diâmetro' : 'comprimento') + ' (' + it.desc + '): vai na van com tubo, sem conferir o encaixe' }); }
        if (t.de && !t.di) avisos.push({ cod: 'tubo_sem_di', msg: 'Sem diâmetro interno: ' + it.desc + ' não recebe outros tubos dentro' });
        if (t.de && t.compr) {
          it.volM3 = round((t.de / 1000) ** 2 * t.compr * t.barras, 4); // caixa envolvente
          volItens += 0; // tubos são tratados pela geometria
          if (t.pesoUnit) { t.pesoFonte = 'cadastro'; }
          else if (t.di && DENS[t.material]) {
            const a = Math.PI / 4 * ((t.de / 1000) ** 2 - (t.di / 1000) ** 2);
            t.pesoUnit = round(a * t.compr * DENS[t.material] * 1000, 2); t.pesoFonte = 'geometria';
          }
        }
        it.tubo = t;
        if (t.pesoUnit) pesoItens += t.pesoUnit * t.barras; else pesoItensCompleto = false;
      } else {
        const vu = p && p.volUnitM3, pu = p && p.pesoUnitKg;
        if (vu) { it.volM3 = round(vu * it.qtd, 4); volItens += it.volM3; } else volItensCompleto = false;
        if (pu) { it.pesoKg = round(pu * it.qtd, 3); pesoItens += it.pesoKg; } else pesoItensCompleto = false;
      }
      return it;
    });
    const n = Object.assign({}, nota, { itens });
    // peso: nota > operador > cadastro
    if (nota.pesoOperador != null) { n.pesoKg = nota.pesoOperador; n.pesoFonte = 'operador'; }
    else if (nota.pesoB != null && nota.pesoB > 0) { n.pesoKg = nota.pesoB; n.pesoFonte = 'nota'; }
    else if (itens.length && pesoItensCompleto && pesoItens > 0) { n.pesoKg = round(pesoItens, 2); n.pesoFonte = 'cadastro'; }
    else if (nota.origem === 'sobra') { n.pesoKg = 0; n.pesoFonte = 'sobra sem peso'; avisos.push({ cod: 'peso_sobra', msg: 'Sobra sem peso informado: entra na rota sem contar peso (informe o peso para conferir a carga)' }); }
    else { n.pesoKg = null; pend.push({ cod: 'peso', bloqueia: true, msg: 'Sem peso bruto na nota nem no cadastro dos produtos' }); }
    // volume das mercadorias que não são tubo
    const naoTubos = itens.filter((i) => i.tipo !== 'tubo');
    if (nota.volOperador != null) { n.volOutrosM3 = nota.volOperador; n.volFonte = 'operador'; }
    else if (nota.volM3 != null && nota.volM3 > 0 && !itens.some((i) => i.tipo === 'tubo')) { n.volOutrosM3 = nota.volM3; n.volFonte = nota.origem === 'ssw' ? 'SSW' : nota.origem === 'manual' ? 'informado' : 'planilha'; }
    else if (itens.length && !naoTubos.length) { n.volOutrosM3 = 0; n.volFonte = 'sem itens soltos'; }
    else if (itens.length && volItensCompleto) { n.volOutrosM3 = round(volItens, 4); n.volFonte = 'cadastro'; }
    else if (cfg.cubagemKgM3 > 0 && n.pesoKg) {
      const pesoTubos = itens.filter((i) => i.tubo && i.tubo.pesoUnit).reduce((s, i) => s + i.tubo.pesoUnit * i.tubo.barras, 0);
      n.volOutrosM3 = round(Math.max(0, n.pesoKg - pesoTubos) / cfg.cubagemKgM3, 4); n.volFonte = 'fator de cubagem';
      avisos.push({ cod: 'vol_cubagem', msg: 'Volume estimado pelo fator de cubagem (' + cfg.cubagemKgM3 + ' kg/m³)' });
    } else if (n.pesoKg > 0 || nota.origem === 'sobra') {
      // sem m³ mas com peso: não trava a nota, a carga é controlada só pelo peso
      n.volOutrosM3 = 0; n.volFonte = 'sem m³ (vale o peso)';
      avisos.push({ cod: 'vol_peso', msg: 'Sem volume (m³): a carga desta nota é controlada só pelo peso' });
    } else { n.volOutrosM3 = null; pend.push({ cod: 'volume', bloqueia: true, msg: 'Sem volume (m³): informe na nota ou cadastre os produtos' }); }
    // tubos
    n.tubos = [];
    itens.forEach((it, idx) => { if (it.tubo && it.tubo.de && it.tubo.compr && it.tubo.barras > 0) n.tubos.push({ item: idx, desc: it.desc, ...it.tubo }); });
    n.qtdTubos = n.tubos.reduce((s, t) => s + t.barras, 0);
    n.exigeTubo = (!!nota.exigeTubo && !n.tubos.length) || tuboSemMedida;
    n.volTubosM3 = round(n.tubos.reduce((s, t) => s + (t.de / 1000) ** 2 * t.compr * t.barras, 0), 4);
    // destino
    const e = nota.endereco || {};
    const mun = RE.findMun(e.cMun, e.cidade, e.uf);
    if (!mun) pend.push({ cod: 'cidade', bloqueia: true, msg: 'Cidade de entrega não reconhecida: ' + (e.cidade || '(vazia)') + '/' + (e.uf || '') });
    n.cidadeId = mun ? mun.cod : null;
    n.cidadeNome = mun ? mun.nome + '/' + mun.uf : (e.cidade || '') + '/' + (e.uf || '');
    if (!e.lgr && !nota.pdfParcial) avisos.push({ cod: 'endereco', msg: 'Endereço sem logradouro' });
    // nota lida do PDF: com cidade reconhecida e peso, entra na programação (só um aviso); faltando algo, trava
    if (nota.pdfParcial && !nota.pdfConferido) {
      if (mun && n.pesoKg > 0) avisos.push({ cod: 'pdf', msg: 'Nota lida do PDF: confira destinatário e endereço, ou importe o XML para o endereço exato' });
      else pend.push({ cod: 'pdf', bloqueia: true, msg: 'Nota lida do PDF sem ' + (!mun ? 'cidade reconhecida' : 'peso') + ': confira ou importe o XML' });
    }
    const cidadeCad = ctx.cidades && n.cidadeId ? ctx.cidades[n.cidadeId] : null;
    if (n.cidadeId && !cidadeCad) pend.push({ cod: 'cidade_sem_rota', bloqueia: true, msg: 'Cidade sem dias de rota cadastrados: ' + n.cidadeNome });
    // coordenadas
    const cli = ctx.clientes && ctx.clientes[RE.clienteKey(nota)];
    if (nota.lat != null && nota.lon != null) { n.lat = nota.lat; n.lon = nota.lon; n.coordFonte = 'confirmada'; }
    else if (cli && cli.lat != null) { n.lat = cli.lat; n.lon = cli.lon; n.coordFonte = 'confirmada'; if (cli.janelaIni) n.janela = { ini: cli.janelaIni, fim: cli.janelaFim }; }
    else if (mun) { n.lat = mun.lat; n.lon = mun.lon; n.coordFonte = 'centro da cidade'; }
    // frete
    if (nota.frete != null && nota.frete !== '') { n.freteValor = +nota.frete; n.freteFonte = nota.origem === 'ssw' ? 'CT-e' : 'operador'; }
    else if (nota.freteCte > 0) { n.freteValor = +nota.freteCte; n.freteFonte = 'CT-e'; }
    else if (RE.fretePctCliente(nota, cfg) && n.valorMerc > 0) {
      // antes do CT-e: frete combinado com o cliente, em % do valor da nota
      const r = RE.fretePctCliente(nota, cfg);
      n.freteValor = round(n.valorMerc * r.pct / 100, 2); n.freteFonte = r.nome + ' ' + String(r.pct).replace('.', ',') + '% da NF';
    }
    else if (nota.freteXml > 0) { n.freteValor = nota.freteXml; n.freteFonte = 'nota'; }
    else if (cidadeCad && (cidadeCad.freteKg > 0 || cidadeCad.freteMin > 0 || cidadeCad.fretePct > 0) && n.pesoKg) {
      n.freteValor = round(Math.max(cidadeCad.freteMin || 0, (cidadeCad.freteKg || 0) * n.pesoKg + (cidadeCad.fretePct || 0) / 100 * (n.valorMerc || 0)), 2);
      n.freteFonte = 'tabela da cidade';
    } else { n.freteValor = 0; n.freteFonte = 'sem frete'; avisos.push({ cod: 'frete', msg: 'Sem valor de frete: a receita desta nota entra como zero' }); }
    // prazo
    if (nota.prazo) n.prazoEfetivo = nota.prazo;
    else if (cfg.prazoPadraoDias > 0 && nota.emissao) { n.prazoEfetivo = RE.addDays(nota.emissao, cfg.prazoPadraoDias); avisos.push({ cod: 'prazo_padrao', msg: 'Prazo calculado pelo padrão de ' + cfg.prazoPadraoDias + ' dias após a emissão' }); }
    else n.prazoEfetivo = '';
    n.pendencias = pend; n.avisos = avisos;
    n.bloqueada = pend.some((p) => p.bloqueia);
    return n;
  };
  // % de frete sobre o valor da NF por cliente (remetente), usado enquanto não há CT-e
  RE.fretePctCliente = (nota, cfg) => {
    const lst = (cfg && cfg.fretePctClientes) || []; if (!lst.length) return null;
    const t = norm([nota.emitente, nota.remetente].filter(Boolean).join(' '));
    if (!t) return null;
    for (const r of lst) { const k = norm(r.nome || ''); if (k && r.pct > 0 && t.includes(k)) return r; }
    return null;
  };
  RE.clienteKey = (n) => {
    const e = n.endereco || {};
    // a cidade entra na chave: mesmo cliente sem CEP em cidades diferentes não pode virar uma parada só;
    // sem nome nem documento, cada nota é uma parada
    const quem = n.destDoc || norm(n.destNome) || ('nota-' + (n.id || n.numero || ''));
    return (quem + '-' + (n.cidadeId || e.cMun || norm(e.cidade)) + '-' + (e.cep || '') + '-' + norm(e.nro)).replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 120) || 'sem-cliente';
  };

  // ---------- geometria de círculos (encaixe e seção transversal) ----------
  // Empacota círculos (raio em mm) num contêiner: {tipo:'retangulo', w, h} com origem no canto inferior esquerdo,
  // ou {tipo:'circulo', r} com centro na origem. Gravidade para baixo. folga em mm entre peças e paredes.
  function Packer(cont, folga) {
    this.c = cont; this.g = folga || 0; this.list = []; this.cell = 0; this.grid = new Map();
  }
  Packer.prototype._key = function (x, y) { return Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell); };
  Packer.prototype._near = function (x, y, rad) {
    if (!this.cell) return this.list;
    const out = new Set();
    const k = Math.ceil(rad / this.cell) + 1;
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    for (let i = cx - k; i <= cx + k; i++) for (let j = cy - k; j <= cy + k; j++) { const b = this.grid.get(i + ',' + j); if (b) for (const o of b) out.add(o); }
    return [...out];
  };
  Packer.prototype._add = function (o) {
    this.list.push(o);
    if (!this.cell) { this.cell = Math.max(10, o.r * 2); }
    const k = this._key(o.x, o.y);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(o);
  };
  Packer.prototype._ok = function (x, y, r) {
    const g = this.g, e = 1e-6;
    if (this.c.tipo === 'retangulo') { if (x - r < g - e || x + r > this.c.w - g + e || y - r < g - e || y + r > this.c.h - g + e) return false; }
    else if (Math.hypot(x, y) + r > this.c.r - g + e) return false;
    for (const o of this._near(x, y, r + this.maxR + g)) {
      if (Math.hypot(x - o.x, y - o.y) < o.r + r + g - e) return false;
    }
    return true;
  };
  const circInter = (x1, y1, r1, x2, y2, r2) => {
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const xm = x1 + a * (x2 - x1) / d, ym = y1 + a * (y2 - y1) / d;
    return [[xm + h * (y2 - y1) / d, ym - h * (x2 - x1) / d], [xm - h * (y2 - y1) / d, ym + h * (x2 - x1) / d]];
  };
  Packer.prototype.place = function (r, data) {
    this.maxR = Math.max(this.maxR || 0, r);
    const g = this.g, c = this.c, cand = [];
    const rr = r + g; // distância centro-a-parede mínima = r+g ; centro-a-centro = r+o.r+g
    if (c.tipo === 'retangulo') {
      cand.push([rr, rr], [c.w - rr, rr]);
      for (const o of this.list) {
        const D = o.r + r + g;
        for (const y of [rr]) { const dy = y - o.y; if (Math.abs(dy) <= D) { const dx = Math.sqrt(D * D - dy * dy); cand.push([o.x - dx, y], [o.x + dx, y]); } }
        for (const x of [rr, c.w - rr]) { const dx = x - o.x; if (Math.abs(dx) <= D) { const dy = Math.sqrt(D * D - dx * dx); cand.push([x, o.y + dy], [x, o.y - dy]); } }
        for (const o2 of this._near(o.x, o.y, 2 * (this.maxR + g) + 2 * r)) {
          if (o2 === o || o2.i < o.i) continue;
          for (const p of circInter(o.x, o.y, D, o2.x, o2.y, o2.r + r + g)) cand.push(p);
        }
      }
      cand.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    } else {
      const R = c.r - rr;
      if (R < -1e-9) return null;
      cand.push([0, -R]);
      for (const o of this.list) {
        const D = o.r + r + g;
        for (const p of circInter(0, 0, R, o.x, o.y, D)) cand.push(p);
        for (const o2 of this._near(o.x, o.y, 2 * (this.maxR + g) + 2 * r)) {
          if (o2 === o || o2.i < o.i) continue;
          for (const p of circInter(o.x, o.y, D, o2.x, o2.y, o2.r + r + g)) cand.push(p);
        }
      }
      cand.sort((a, b) => (a[1] - b[1]) || (Math.abs(a[0]) - Math.abs(b[0])));
    }
    for (const [x, y] of cand) {
      if (this._ok(x, y, r)) { const o = { x, y, r, i: this.list.length, data }; this._add(o); return o; }
    }
    return null;
  };
  RE.Packer = Packer;

  // Monta conjuntos de tubos encaixados e a seção transversal.
  // tubos: [{id, de, di, compr, kg, ordem (posição de entrega, 0 = primeira), material, encaixavel, rotulo}]
  // opts: {secaoW, secaoH (mm), comprUtil (m), folga (mm entre tubos), folgaEncaixe (mm), niveis, cargaInternaKgM, ordemImporta}
  RE.encaixarTubos = (tubos, opts) => {
    const folgaEnc = opts.folgaEncaixe != null ? opts.folgaEncaixe : 10;
    const niveis = opts.niveis != null ? opts.niveis : 3;
    const limKgM = opts.cargaInternaKgM || 0;
    const L = opts.comprUtil;
    const pend = tubos.map((t, i) => Object.assign({ idx: i }, t)).sort((a, b) => (b.de - a.de) || (b.compr - a.compr));
    const erros = [];
    for (const t of pend) if (t.compr > L + 1e-9) erros.push({ tubo: t, msg: 'Tubo de ' + t.compr + ' m não cabe no comprimento útil de ' + L + ' m' });
    if (erros.length) return { ok: false, erros, motivo: erros[0].msg };
    const usado = new Set();
    let nEnc = 0;
    // Uma "coluna" é um espaço circular ao longo do comprimento que pode ter várias barras em sequência.
    const mkColuna = (t, comprDisp) => ({ de: t.de, di: t.di, pecas: [t], usadoCompr: t.compr, comprDisp, filhos: [], kg: t.kg });
    const podeEntrar = (c, host, nivel) => {
      if (usado.has(c.idx) || c.encaixavel === false) return false;
      if (nivel > niveis) return false;
      if (c.de > host.di - 2 * folgaEnc + 1e-9) return false;
      if (c.compr > host.comprInterno + 1e-9) return false;
      if (opts.ordemImporta && c.ordem > host.ordem) return false; // tubo de dentro sai antes ou junto do hospedeiro
      if (!opts.ordemImporta && c.ordem !== host.ordem) return false;
      return true;
    };
    const encherInterior = (col, nivel) => {
      // o interior do maior tubo da coluna (comprimento = menor peça da coluna, de forma conservadora)
      const host = col.pecas[0];
      if (!host.di || host.encaixavel === false) return;
      const comprInt = Math.min(...col.pecas.map((p) => p.compr));
      const hostInfo = { di: host.di, comprInterno: comprInt, ordem: Math.min(...col.pecas.map((p) => p.ordem)) };
      const R = host.di / 2 - folgaEnc;
      if (R <= 0) return;
      const pk = new Packer({ tipo: 'circulo', r: host.di / 2 }, folgaEnc);
      let kgDentro = 0;
      const limite = limKgM > 0 ? limKgM * comprInt : Infinity;
      for (const c of pend) {
        if (!podeEntrar(c, hostInfo, nivel)) continue;
        if (kgDentro + (c.kg || 0) > limite + 1e-9) continue;
        const o = pk.place(c.de / 2, null);
        if (!o) continue;
        usado.add(c.idx); nEnc++;
        kgDentro += c.kg || 0;
        const sub = mkColuna(c, comprInt);
        // barras menores em sequência no mesmo espaço
        for (const c2 of pend) {
          if (usado.has(c2.idx) || c2.de !== c.de || c2.di !== c.di || c2.material !== c.material) continue;
          if (!podeEntrar(c2, hostInfo, nivel)) continue;
          if (sub.usadoCompr + c2.compr > comprInt + 1e-9) continue;
          if (kgDentro + (c2.kg || 0) > limite + 1e-9) continue;
          usado.add(c2.idx); nEnc++; kgDentro += c2.kg || 0; sub.pecas.push(c2); sub.usadoCompr += c2.compr; sub.kg += c2.kg || 0;
        }
        o.data = sub;
        sub.x = o.x; sub.y = o.y;
        col.filhos.push(sub);
        encherInterior(sub, nivel + 1);
      }
      col.kgDentro = kgDentro;
    };
    const colunas = [];
    for (const t of pend) {
      if (usado.has(t.idx)) continue;
      usado.add(t.idx);
      const col = mkColuna(t, L);
      // barras iguais em sequência no comprimento útil
      for (const t2 of pend) {
        if (usado.has(t2.idx) || t2.de !== t.de || t2.di !== t.di || t2.material !== t.material) continue;
        if (opts.ordemImporta ? false : t2.ordem !== t.ordem) continue;
        if (col.usadoCompr + t2.compr > L + 1e-9) continue;
        usado.add(t2.idx); col.pecas.push(t2); col.usadoCompr += t2.compr; col.kg += t2.kg || 0;
      }
      // os maiores vêm primeiro: o interior é preenchido antes de os menores virarem colunas próprias
      encherInterior(col, 1);
      colunas.push(col);
    }
    const topo = colunas;
    if (opts.semSecao) return { ok: true, colunas: topo, encaixados: nEnc, kgTotal: tubos.reduce((a, t) => a + (t.kg || 0), 0) };
    // seção transversal
    const pk = new Packer({ tipo: 'retangulo', w: opts.secaoW, h: opts.secaoH }, opts.folga != null ? opts.folga : 5);
    const naoCouberam = [];
    topo.sort((a, b) => b.de - a.de);
    for (const col of topo) {
      const o = pk.place(col.de / 2, col);
      if (!o) { naoCouberam.push(col); continue; }
      col.x = o.x; col.y = o.y;
    }
    const kgTotal = tubos.reduce((s, t) => s + (t.kg || 0), 0);
    let alturaUsada = 0, areaUsada = 0;
    for (const o of pk.list) { alturaUsada = Math.max(alturaUsada, o.y + o.r); areaUsada += Math.PI * o.r * o.r; }
    const comprUsado = topo.length ? Math.max(...topo.map((c) => c.usadoCompr)) : 0;
    const contar = (c) => c.pecas.length + c.filhos.reduce((s, f) => s + contar(f), 0);
    return {
      ok: naoCouberam.length === 0,
      motivo: naoCouberam.length ? naoCouberam.length + ' coluna(s) de tubos não cabem na seção de ' + opts.secaoW + ' × ' + opts.secaoH + ' mm' : '',
      colunas: topo, naoCouberam,
      conjuntos: topo.filter((c) => c.filhos.length).length,
      encaixados: nEnc,
      totalTubos: tubos.length,
      alturaUsadaMm: round(alturaUsada, 0),
      ocupacaoSecao: round(areaUsada / (opts.secaoW * opts.secaoH), 4),
      ocupacaoAltura: round(alturaUsada / opts.secaoH, 4),
      comprUsadoM: round(comprUsado, 2),
      kgTotal: round(kgTotal, 2),
      pecasPorColuna: topo.map(contar),
    };
  };

  // ---------- carga do veículo ----------
  // paradas: [{key, ordem, kg, m3, tubos:[...]}]  (ordem só importa quando opts.ordemImporta)
  RE.verificarCarga = (veic, paradas, cfg, ordemImporta) => {
    const kg = paradas.reduce((s, p) => s + p.kg, 0);
    const m3Outros = paradas.reduce((s, p) => s + p.m3, 0);
    const res = { ok: true, motivos: [], kg: round(kg, 2), m3Outros: round(m3Outros, 4), tubos: null, m3Tubos: 0 };
    if (kg > veic.capKg + 1e-6) { res.ok = false; res.motivos.push('Peso ' + round(kg, 0) + ' kg acima da capacidade de ' + veic.capKg + ' kg'); }
    const tubos = [];
    for (const p of paradas) for (const t of p.tubos) {
      for (let b = 0; b < t.barras; b++) tubos.push({ de: t.de, di: t.di || null, compr: t.compr, kg: t.pesoUnit || 0, material: t.material || '', encaixavel: t.encaixavel !== false, ordem: p.ordem || 0, parada: p.key, rotulo: t.desc });
    }
    let volTuboZona = 0;
    if (tubos.length) {
      const tubeVan = veic.tipo === 'tubos';
      if (!tubeVan && veic.aceitaTubos === false) { res.ok = false; res.motivos.push('Veículo não aceita tubos'); }
      else {
        const secW = tubeVan ? (veic.secaoL || 1) * 1000 : (veic.larg || 1) * 1000;
        const secH = tubeVan ? (veic.secaoA || 1) * 1000 : (veic.alt || 1) * 1000;
        const comprUtil = tubeVan ? (veic.tuboCompr || veic.compr || 3) : (veic.compr || 2);
        const enc = RE.encaixarTubos(tubos, { secaoW: secW, secaoH: secH, comprUtil, folga: cfg.folgaSecaoMm, folgaEncaixe: cfg.folgaEncaixeMm, niveis: cfg.niveisEncaixe, cargaInternaKgM: cfg.cargaInternaKgM, ordemImporta });
        res.tubos = enc;
        if (!enc.ok) { res.ok = false; res.motivos.push(enc.motivo); }
        else {
          // zona ocupada pelos tubos dentro do baú (para o restante da carga)
          const comprNoBau = Math.min(enc.comprUsadoM, veic.compr || enc.comprUsadoM);
          volTuboZona = (secW / 1000) * (enc.alturaUsadaMm / 1000) * comprNoBau;
          res.m3Tubos = round(volTuboZona, 3);
        }
      }
    }
    const aprov = cfg.aproveitamento || 0.85;
    const livre = Math.max(0, veic.capM3 - volTuboZona) * aprov;
    res.m3Livre = round(livre, 3);
    res.m3Usado = round(m3Outros + volTuboZona, 3);
    res.ocupVol = round((m3Outros / aprov + volTuboZona) / veic.capM3, 4);
    res.ocupPeso = round(kg / veic.capKg, 4);
    if (m3Outros > livre + 1e-6) { res.ok = false; res.motivos.push('Volume ' + round(m3Outros, 2) + ' m³ acima do espaço útil de ' + round(livre, 2) + ' m³'); }
    return res;
  };

  // Verificação rápida usada durante a busca: encaixe dentro de cada parada (pré-calculado) e
  // ocupação da seção por área com densidade conservadora. O plano final passa pela verificação exata.
  RE.secaoVeic = (veic) => {
    const tubeVan = veic.tipo === 'tubos';
    return {
      w: (tubeVan ? (veic.secaoL || 1) : (veic.larg || 1)) * 1000,
      h: (tubeVan ? (veic.secaoA || 1) : (veic.alt || 1)) * 1000,
      compr: tubeVan ? (veic.tuboCompr || veic.compr || 3) : (veic.compr || 2),
    };
  };
  RE.colunasDaParada = (parada, comprUtil, cfg) => {
    const tubos = [];
    for (const t of parada.tubos) for (let b = 0; b < t.barras; b++) tubos.push({ de: t.de, di: t.di || null, compr: t.compr, kg: t.pesoUnit || 0, material: t.material || '', encaixavel: t.encaixavel !== false, ordem: 0 });
    if (!tubos.length) return { ok: true, area: 0, maxDe: 0, maxCompr: 0 };
    const enc = RE.encaixarTubos(tubos, { secaoW: 1e9, secaoH: 1e9, comprUtil, folgaEncaixe: cfg.folgaEncaixeMm, niveis: cfg.niveisEncaixe, cargaInternaKgM: cfg.cargaInternaKgM, semSecao: true });
    if (!enc.ok) return { ok: false, motivo: enc.motivo };
    const f = cfg.folgaSecaoMm != null ? cfg.folgaSecaoMm : 5;
    let area = 0, maxDe = 0, maxCompr = 0;
    for (const c of enc.colunas) { area += Math.PI / 4 * (c.de + f) ** 2; maxDe = Math.max(maxDe, c.de); maxCompr = Math.max(maxCompr, c.usadoCompr); }
    return { ok: true, area, maxDe, maxCompr, n: enc.colunas.length };
  };
  RE.cargaRapida = (veic, paradas, colsPorParada, cfg) => {
    const kg = paradas.reduce((s, p) => s + p.kg, 0);
    const m3Outros = paradas.reduce((s, p) => s + p.m3, 0);
    const res = { ok: true, motivos: [], kg, m3Outros };
    if (kg > veic.capKg + 1e-6) { res.ok = false; res.motivos.push('Peso ' + round(kg, 0) + ' kg acima da capacidade de ' + veic.capKg + ' kg'); return res; }
    let zona = 0;
    const temTubo = paradas.some((p) => p.tubos.length);
    if (temTubo) {
      if (veic.tipo !== 'tubos' && veic.aceitaTubos === false) { res.ok = false; res.motivos.push('Veículo não aceita tubos'); return res; }
      const sec = RE.secaoVeic(veic);
      let area = 0, maxDe = 0, maxCompr = 0;
      for (const c of colsPorParada) {
        if (!c.ok) { res.ok = false; res.motivos.push(c.motivo); return res; }
        area += c.area; maxDe = Math.max(maxDe, c.maxDe); maxCompr = Math.max(maxCompr, c.maxCompr);
      }
      const dens = cfg.densidadeSecao || 0.72;
      if (maxDe > Math.min(sec.w, sec.h) - 2 * (cfg.folgaSecaoMm || 0)) { res.ok = false; res.motivos.push('Tubo de ' + maxDe + ' mm não cabe na seção'); return res; }
      if (area > dens * sec.w * sec.h) { res.ok = false; res.motivos.push('Tubos ocupam mais que a seção disponível'); return res; }
      const h = Math.min(sec.h, Math.max(maxDe, area / dens / sec.w));
      zona = (sec.w / 1000) * (h / 1000) * Math.min(maxCompr, veic.compr || maxCompr);
    }
    const livre = Math.max(0, veic.capM3 - zona) * (cfg.aproveitamento || 0.85);
    if (m3Outros > livre + 1e-6) { res.ok = false; res.motivos.push('Volume ' + round(m3Outros, 2) + ' m³ acima do espaço útil de ' + round(livre, 2) + ' m³'); }
    return res;
  };

  // ---------- custos ----------
  // ---------- tabela de pagamento do motorista por região ----------
  // valor fixo por saída ou R$ por km, conforme o tipo de veículo e a região da rota. Rota que passa por
  // mais de uma região paga a região de maior valor. A região de cada cidade é a do cadastro (regiaoFrete)
  // ou, sem ela, a cidade-polo da tabela mais próxima.
  const v = (fixo) => ({ fixo }), k = (km) => ({ km });
  RE.TABELA_MOTORISTA_PADRAO = {
    regioes: ['Sorocaba', 'Itapetininga', 'Cotia', 'Piedade', 'Mogi Mirim', 'Bragança Paulista', 'Campinas', 'Jundiaí', 'Americana', 'Limeira', 'Piracicaba', 'Pirassununga'],
    valores: {
      tubos: { Sorocaba: v(900), Itapetininga: k(2.5), Cotia: k(2.5), Piedade: k(2.5), 'Mogi Mirim': v(900), 'Bragança Paulista': v(900), Campinas: v(800), 'Jundiaí': v(850), Americana: v(800), Limeira: v(800), Piracicaba: v(800), Pirassununga: v(900) },
      van: { Sorocaba: v(800), Itapetininga: v(1000), Cotia: v(800), Piedade: v(900), 'Mogi Mirim': v(800), 'Bragança Paulista': v(800), Campinas: v(700), 'Jundiaí': v(750), Americana: v(700), Limeira: v(700), Piracicaba: v(700), Pirassununga: v(800) },
      fiorino: { Sorocaba: v(400), Itapetininga: v(600), Cotia: v(550), Piedade: v(550), 'Mogi Mirim': v(450), 'Bragança Paulista': v(450), Campinas: v(350), 'Jundiaí': v(400), Americana: v(350), Limeira: v(350), Piracicaba: v(350), Pirassununga: v(450) },
    },
  };
  const POLOS = new Map();
  const poloCoord = (nome) => { if (!POLOS.has(nome)) POLOS.set(nome, RE.findMun(null, nome, 'SP')); return POLOS.get(nome); };
  RE.regiaoFrete = (cidadeId, ctx) => {
    const tab = ctx.cfg && ctx.cfg.tabelaMotorista; if (!tab || !tab.regioes || !tab.regioes.length) return '';
    const cad = ctx.cidades[cidadeId];
    if (cad && cad.regiaoFrete && tab.regioes.includes(cad.regiaoFrete)) return cad.regiaoFrete;
    const m = RE.findMun(cidadeId) || (cad ? RE.findMun(null, cad.nome, cad.uf) : null); if (!m) return '';
    let best = '', d = Infinity;
    for (const r of tab.regioes) { const c = poloCoord(r); if (!c) continue; const x = haversine(m, c); if (x < d) { d = x; best = r; } }
    return best;
  };
  RE.pagamentoTabela = (tipo, km, cidadesIds, ctx) => {
    const tab = ctx.cfg && ctx.cfg.tabelaMotorista; const vals = tab && tab.valores && tab.valores[tipo]; if (!vals) return null;
    let melhor = null;
    for (const r of new Set(cidadesIds.map((id) => RE.regiaoFrete(id, ctx)).filter(Boolean))) {
      const x = vals[r]; if (!x) continue;
      const valor = x.km ? round(x.km * km, 2) : +x.fixo || 0;
      if (!melhor || valor > melhor.valor) melhor = { valor, regiao: r, regra: x.km ? 'R$ ' + String(x.km).replace('.', ',') + '/km' : 'fixo' };
    }
    return melhor;
  };
  RE.custoRota = (veic, km, cidadesIds, ctx, extras) => {
    const cfg = ctx.cfg;
    const preco = veic.combustivel === 'gasolina' ? cfg.precoGasolina : veic.combustivel === 'etanol' ? cfg.precoEtanol : cfg.precoDiesel;
    const comb = veic.kmL > 0 ? km / veic.kmL * preco : 0;
    let ped = 0;
    for (const id of cidadesIds) { const c = ctx.cidades[id]; if (c && c.pedagio > ped) ped = c.pedagio; }
    ped *= veic.multPedagio || 1;
    // pagamento do motorista: diária + R$ por km (cadastro do motorista; sem motorista, o do veículo)
    const mc = ctx.motoristas && veic.motoristaId ? ctx.motoristas[veic.motoristaId] : null;
    const tabMot = RE.pagamentoTabela(veic.tipo, km, cidadesIds, ctx);
    const mot = tabMot ? tabMot.valor : round(mc ? (+mc.diaria || 0) + km * (+mc.valorKm || 0) : (+veic.diariaMotorista || 0) + km * (+veic.valorKmMotorista || 0), 2);
    const c = {
      // pela tabela da região, o valor pago já cobre carro, combustível e manutenção (motorista agregado)
      veiculo: tabMot ? 0 : +veic.custoDiaria || 0, motorista: mot, ajudante: +veic.custoAjudante || 0,
      combustivel: tabMot ? 0 : round(comb, 2), pedagio: round(ped, 2), manutencao: tabMot ? 0 : round(km * (+veic.custoKm || 0), 2), extras: +extras || 0,
    };
    c.total = round(Object.values(c).reduce((s, v) => s + v, 0), 2);
    return c;
  };

  // ---------- roteirização ----------
  // ctx: {cfg, cidades:{id:cidade}, motoristas, veiculos:[...], base:{lat,lon}}
  const veicDisponivel = (v, data) => {
    if (v.ativo === false) return false;
    if (v.manutIni && v.manutFim && data >= v.manutIni && data <= v.manutFim) return false;
    if (v.indisponivelEm && v.indisponivelEm.includes(data)) return false;
    if (v.motoristaIndisponivel) return false;
    if (v.indispDia) return false;
    return true;
  };
  RE.veicDisponivel = veicDisponivel;
  // motorista disponível na data: marcação geral + período de ausência (folga, férias, afastamento)
  RE.motoristaDisponivel = (m, data) => {
    if (!m || m.ativo === false || m.disponivel === false) return false;
    if (m.ausenteIni && data >= m.ausenteIni && (!m.ausenteFim || data <= m.ausenteFim)) return false;
    return true;
  };

  RE.dBR = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s || '');
  RE.proximoDiaPermitido = (cidade, apartir, limiteDias = 21) => {
    for (let i = 0; i <= limiteDias; i++) { const d = RE.addDays(apartir, i); if ((cidade.dias || []).includes(RE.weekday(d))) return d; }
    return null;
  };

  // Notas elegíveis para a data: cidade com dia permitido (ou dia forçado), não bloqueadas, não roteirizadas em outro plano
  RE.elegiveis = (notasEnr, data, ctx, filtroCidades) => {
    const wd = RE.weekday(data);
    const out = [], fora = [];
    for (const n of notasEnr) {
      if (n.status === 'entregue' || n.status === 'cancelada' || n.status === 'em_rota') continue;
      if (n.planoData && n.planoData !== data && n.status === 'roteirizada') continue;
      if (filtroCidades && filtroCidades.length && !filtroCidades.includes(n.cidadeId)) continue;
      if (n.bloqueioUsuario) continue;   // bloqueada pelo usuário: fica fora da programação sem aparecer nela
      if (n.bloqueada) { fora.push({ nota: n, motivo: 'Dados pendentes' }); continue; }
      // sem rua e número localizados não entra (a não ser que o usuário libere pelo centro da cidade)
      if (ctx.cfg && ctx.cfg.exigirEnderecoExato === true && n.coordFonte !== 'confirmada' && !n.aproximadoOk) { fora.push({ nota: n, motivo: 'Sem endereço exato' }); continue; }
      const cid = ctx.cidades[n.cidadeId];
      const forcado = n.diaForcado === data;
      if (!forcado && !(cid.dias || []).includes(wd)) { continue; }
      if (n.dataMinima && data < n.dataMinima) continue;
      let obrig = false, atrasada = false;
      if (n.prazoEfetivo) {
        if (n.prazoEfetivo < data) { atrasada = true; obrig = true; }
        else {
          const prox = RE.proximoDiaPermitido(cid, RE.addDays(data, 1));
          if (!prox || prox > n.prazoEfetivo) obrig = true;
        }
      }
      if (forcado) obrig = true;
      if (n.prioridade) obrig = true;
      out.push(Object.assign({}, n, { obrigatoria: obrig, atrasada, prioridade: !!n.prioridade }));
    }
    return { notas: out, fora };
  };

  // Alertas: notas que não chegam ao destino dentro do prazo com o calendário da cidade
  RE.alertasPrazo = (notasEnr, hoje, ctx) => {
    const al = [];
    for (const n of notasEnr) {
      if (['entregue', 'cancelada', 'roteirizada', 'em_rota'].includes(n.status) || n.bloqueioUsuario || !n.prazoEfetivo || !n.cidadeId) continue;
      const cid = ctx.cidades[n.cidadeId];
      if (!cid) continue;
      if (n.prazoEfetivo < hoje) { al.push({ nota: n, tipo: 'atrasada', msg: 'Prazo vencido em ' + RE.dBR(n.prazoEfetivo) }); continue; }
      const prox = RE.proximoDiaPermitido(cid, hoje);
      if (!prox || prox > n.prazoEfetivo) al.push({ nota: n, tipo: 'sem_dia', msg: 'Nenhum dia de rota de ' + cid.nome + ' até o prazo ' + RE.dBR(n.prazoEfetivo) + (prox ? ' (próximo: ' + RE.dBR(prox) + ')' : '') });
      else if (n.bloqueada) al.push({ nota: n, tipo: 'pendente', msg: 'Dados pendentes impedem a roteirização (prazo ' + RE.dBR(n.prazoEfetivo) + ')' });
    }
    return al;
  };

  // Agrupa notas no mesmo destino (cliente + endereço), preservando o vínculo com cada NF-e
  RE.consolidar = (notas) => {
    const m = new Map();
    for (const n of notas) {
      const k = RE.clienteKey(n);
      let p = m.get(k);
      if (!p) {
        p = { key: k, notas: [], kg: 0, m3: 0, tubos: [], receita: 0, cidadeId: n.cidadeId, cidadeNome: n.cidadeNome, lat: n.lat, lon: n.lon, coordFonte: n.coordFonte, dest: n.destNome, endereco: n.endereco, obrigatoria: false, atrasada: false, janela: n.janela || null, locks: null };
        m.set(k, p);
      }
      p.notas.push(n.id); p.kg += n.pesoKg || 0; p.m3 += n.volOutrosM3 || 0; p.receita += n.freteValor || 0;
      for (const t of n.tubos || []) p.tubos.push(Object.assign({ nota: n.id }, t));
      p.exigeTubo = p.exigeTubo || !!n.exigeTubo;
      p.obrigatoria = p.obrigatoria || n.obrigatoria; p.atrasada = p.atrasada || n.atrasada; p.prioridade = p.prioridade || !!n.prioridade;
      if (n.travaVeiculo) p.locks = n.travaVeiculo;
      if (n.janela && !p.janela) p.janela = n.janela;
    }
    return [...m.values()];
  };

  function Solver(stops, veiculos, ctx, opts) {
    this.S = stops; this.V = veiculos; this.ctx = ctx; this.cfg = ctx.cfg; this.opts = opts || {};
    this.base = ctx.base;
    this.cache = new Map(); this.colCache = new Map();
    this.n = stops.length;
    // matriz de distâncias (0 = base)
    const pts = [this.base].concat(stops);
    const F = this.cfg.fatorRodoviario || 1.25, urb = this.cfg.kmUrbano || 4;
    this.D = pts.map((a, i) => pts.map((b, j) => {
      if (i === j) return 0;
      if (i > 0 && j > 0 && a.cidadeId === b.cidadeId && (a.coordFonte !== 'confirmada' || b.coordFonte !== 'confirmada')) return urb;
      const h = haversine(a, b) * F;
      return Math.max(h, i > 0 && j > 0 && a.cidadeId === b.cidadeId ? 0.5 : 0);
    }));
    this.estimativa = stops.some((s) => s.coordFonte !== 'confirmada');
    // tipos de veículo distintos (dimensões iguais = mesmo comportamento de carga)
    const sig = (v) => [v.tipo, v.capKg, v.capM3, v.compr, v.larg, v.alt, v.secaoL, v.secaoA, v.tuboCompr, v.aceitaTubos].join('|');
    this.sig = sig;
    this.tipos = [];
    const seen = new Map();
    for (const v of veiculos) { const s = sig(v); if (!seen.has(s)) { seen.set(s, v); this.tipos.push(v); } }
  }
  Solver.prototype.colsParada = function (veic, i) {
    const sec = RE.secaoVeic(veic);
    const k = i + '@' + sec.compr;
    let c = this.colCache.get(k);
    if (!c) { c = RE.colunasDaParada(this.S[i], sec.compr, this.cfg); this.colCache.set(k, c); }
    return c;
  };
  Solver.prototype.cargaOk = function (veic, idxs) {
    const key = this.sig(veic) + '#' + idxs.slice().sort((a, b) => a - b).join(',');
    let r = this.cache.get(key);
    if (!r) {
      r = RE.cargaRapida(veic, idxs.map((i) => this.S[i]), idxs.map((i) => this.colsParada(veic, i)), this.cfg);
      if (this.cache.size > 200000) this.cache.clear();
      this.cache.set(key, r);
    }
    return r;
  };
  // verificação exata (geometria completa, considerando a ordem de entrega)
  Solver.prototype.cargaExata = function (veic, seq) {
    return RE.verificarCarga(veic, seq.map((i, k) => ({ key: this.S[i].key, kg: this.S[i].kg, m3: this.S[i].m3, tubos: this.S[i].tubos, ordem: k })), this.cfg, true);
  };
  // avalia uma sequência de paradas num veículo: viabilidade, tempo, custo e lucro
  Solver.prototype.avaliar = function (veic, seq, detalhe, semCarga) {
    const ctx = this.ctx, cfg = this.cfg;
    const out = { ok: true, motivos: [] };
    if (!seq.length) return { ok: true, km: 0, lucro: 0, custo: { total: 0 }, receita: 0, vazio: true };
    for (const i of seq) {
      const s = this.S[i];
      const cid = ctx.cidades[s.cidadeId];
      if (cid && cid.tiposPermitidos && cid.tiposPermitidos.length && !cid.tiposPermitidos.includes(veic.tipo)) { out.ok = false; out.motivos.push(veic.nome + ' não pode circular em ' + cid.nome); break; }
      if (s.locks && s.locks !== veic.id) { out.ok = false; out.motivos.push('Carga travada em outro veículo'); break; }
      if (s.exigeTubo && veic.tipo !== 'tubos') { out.ok = false; out.motivos.push('Carga com tubo exige van de tubos'); break; }
    }
    const carga = semCarga ? null : this.cargaOk(veic, seq);
    if (carga && !carga.ok) { out.ok = false; out.motivos.push(...carga.motivos); }
    // tempo
    const vel = cfg.velocidadeMedia || 55;
    let t = hm(veic.saida || cfg.inicioJornada || '07:00'), km = 0, prev = 0, espera = 0;
    const chegadas = [];
    for (const i of seq) {
      const d = this.D[prev][i + 1]; km += d; t += d / vel * 60;
      const s = this.S[i];
      const cid = ctx.cidades[s.cidadeId] || {};
      const ini = Math.max(hm(cid.horaIni) || 0, s.janela ? hm(s.janela.ini) || 0 : 0);
      const fimC = hm(cid.horaFim), fimJ = s.janela ? hm(s.janela.fim) : null;
      const fim = Math.min(fimC == null ? 1e9 : fimC, fimJ == null ? 1e9 : fimJ);
      if (t < ini) { espera += ini - t; t = ini; }
      const chegada = t;
      if (t > fim + 1e-6) { out.ok = false; out.motivos.push('Chegada em ' + (cid.nome || s.cidadeNome) + ' às ' + fmtHM(t) + ', depois do horário de entrega (' + fmtHM(fim) + ')'); }
      const desc = (cid.descargaMin != null ? +cid.descargaMin : 20) + (cfg.descargaPorNotaMin || 0) * (s.notas.length - 1);
      t += desc;
      chegadas.push({ chegada, saida: t });
      prev = i + 1;
    }
    const dv = this.D[prev][0]; km += dv; t += dv / vel * 60;
    const inicio = hm(veic.saida || cfg.inicioJornada || '07:00');
    const horas = (t - inicio) / 60;
    if (horas > (cfg.jornadaMaxHoras || 10) + 1e-6) { out.ok = false; out.motivos.push('Jornada de ' + round(horas, 1) + ' h acima do limite de ' + (cfg.jornadaMaxHoras || 10) + ' h'); }
    const receita = seq.reduce((s, i) => s + this.S[i].receita, 0);
    const cidadesIds = [...new Set(seq.map((i) => this.S[i].cidadeId))];
    const custo = RE.custoRota(veic, km, cidadesIds, this.ctx, 0);
    Object.assign(out, { km: round(km, 1), horas: round(horas, 2), retorno: t, espera, receita: round(receita, 2), custo, lucro: round(receita - custo.total, 2), carga });
    if (detalhe) out.chegadas = chegadas;
    return out;
  };
  // melhor tipo de veículo (ignora quantidade) para uma sequência; usado na construção
  Solver.prototype.melhorTipo = function (seq) {
    let best = null;
    for (const v of this.tipos) {
      const a = this.avaliar(v, seq);
      if (a.ok && (!best || a.custo.total < best.a.custo.total)) best = { v, a };
    }
    return best;
  };
  Solver.prototype.twoOpt = function (veic, seq) {
    if (seq.length < 3) return seq;
    let best = seq.slice(), bestA = this.avaliar(veic, best), melhorou = true, it = 0;
    const score = (a) => (a.ok ? 0 : 1e6) + a.km;
    while (melhorou && it++ < 50) {
      melhorou = false;
      for (let i = 0; i < best.length - 1; i++) for (let k = i + 1; k < best.length; k++) {
        const c = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const a = this.avaliar(veic, c);
        if (score(a) < score(bestA) - 1e-9) { best = c; bestA = a; melhorou = true; }
      }
    }
    return best;
  };
  // inserção mais barata de uma parada numa rota
  Solver.prototype.melhorInsercao = function (veic, seq, i) {
    let best = null;
    for (let p = 0; p <= seq.length; p++) {
      const c = seq.slice(0, p).concat([i], seq.slice(p));
      const a = this.avaliar(veic, c);
      if (a.ok && (!best || a.custo.total < best.a.custo.total)) best = { seq: c, a };
    }
    return best;
  };
  // distribui veículos às rotas (rotas maiores e mais restritas primeiro; veículo mais barato que atende)
  Solver.prototype.atribuir = function (rotas) {
    const livres = this.V.slice();
    const fixos = new Map();
    for (const r of rotas) { const lk = r.seq.map((i) => this.S[i].locks).find(Boolean); if (lk) fixos.set(r, lk); }
    const opcoes = rotas.map((r) => {
      const ops = [];
      for (const v of this.V) { if (fixos.has(r) && fixos.get(r) !== v.id) continue; const a = this.avaliar(v, r.seq); if (a.ok) ops.push({ v, a }); }
      ops.sort((x, y) => x.a.custo.total - y.a.custo.total);
      return { r, ops };
    });
    opcoes.sort((x, y) => (x.ops.length - y.ops.length) || (this.peso(y.r.seq) - this.peso(x.r.seq)));
    const semVeic = [];
    for (const o of opcoes) {
      const op = (this.ctx.maxMotoristas >= 0 && this.V.length - livres.length >= this.ctx.maxMotoristas) ? null : o.ops.find((p) => livres.includes(p.v));
      if (op) { o.r.veic = op.v; o.r.a = op.a; livres.splice(livres.indexOf(op.v), 1); }
      else { o.r.veic = null; semVeic.push(o.r); }
    }
    return { livres, semVeic };
  };
  Solver.prototype.pv = function () { const p = +this.cfg.pesoVeiculo || 0; return this.cfg.minimizarMotoristas === false ? p : Math.max(p, 30000); };
  Solver.prototype.cabeNova = function (rotas) { const mx = this.ctx.maxMotoristas; return !(mx >= 0) || rotas.filter((r) => r.veic && r.seq.length).length < mx; };
  Solver.prototype.peso = function (seq) { return seq.reduce((s, i) => s + this.S[i].kg + this.S[i].m3 * 300, 0); };
  Solver.prototype.penal = function (i) { const s = this.S[i]; return s.obrigatoria ? (s.atrasada || s.prioridade ? 2e6 : 1e6) : (this.opts.consolidar ? 0 : 5e4 + s.receita); };
  Solver.prototype.objetivo = function (rotas, fora) {
    let v = 0;
    for (const r of rotas) if (r.veic && r.seq.length) v += r.a.lucro - this.pv();
    for (const i of fora) v -= this.penal(i);
    return v;
  };

  Solver.prototype.resolver = function () {
    const t0 = Date.now(), limite = this.opts.tempoMs || 2500;
    const S = this.S, n = this.n;
    const decisoes = [];
    if (!this.V.length) return { rotas: [], fora: S.map((_, i) => i), decisoes: ['Nenhum veículo disponível na data'] };
    // 1) rotas iniciais: uma por parada (ou por trava)
    let rotas = [];
    const semTipo = [];
    const porTrava = new Map();
    for (let i = 0; i < n; i++) {
      if (S[i].locks) { if (!porTrava.has(S[i].locks)) porTrava.set(S[i].locks, []); porTrava.get(S[i].locks).push(i); continue; }
      if (!this.melhorTipo([i])) { semTipo.push(i); continue; }
      rotas.push({ seq: [i] });
    }
    for (const [vid, idxs] of porTrava) {
      const v = this.V.find((x) => x.id === vid);
      if (!v) { semTipo.push(...idxs); decisoes.push('Veículo travado indisponível na data: ' + vid); continue; }
      rotas.push({ seq: this.twoOpt(v, idxs), lock: vid });
    }
    for (const i of semTipo) decisoes.push(S[i].dest + ' (' + S[i].cidadeNome + '): nenhum veículo da frota comporta esta entrega — ' + (this.avaliar(this.tipos[0] || this.V[0], [i]).motivos || []).join('; '));
    // 2) economias (Clarke-Wright) com o melhor tipo de veículo viável
    const sav = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sav.push([this.D[0][i + 1] + this.D[0][j + 1] - this.D[i + 1][j + 1], i, j]);
    sav.sort((a, b) => b[0] - a[0]);
    const rotaDe = new Map();
    rotas.forEach((r) => r.seq.forEach((i) => rotaDe.set(i, r)));
    for (const [s, i, j] of sav) {
      if (Date.now() - t0 > limite * 0.5) break;
      const ri = rotaDe.get(i), rj = rotaDe.get(j);
      if (!ri || !rj || ri === rj || ri.lock || rj.lock) continue;
      let seq = null;
      const ei = ri.seq[ri.seq.length - 1] === i ? 'fim' : ri.seq[0] === i ? 'ini' : null;
      const ej = rj.seq[0] === j ? 'ini' : rj.seq[rj.seq.length - 1] === j ? 'fim' : null;
      if (!ei || !ej) continue;
      const a = ei === 'fim' ? ri.seq : ri.seq.slice().reverse();
      const b = ej === 'ini' ? rj.seq : rj.seq.slice().reverse();
      seq = a.concat(b);
      if (!this.melhorTipo(seq)) continue;
      const nova = { seq };
      rotas = rotas.filter((r) => r !== ri && r !== rj); rotas.push(nova);
      seq.forEach((k) => rotaDe.set(k, nova));
    }
    // 3) atribuição de veículos reais
    const ajustar = () => {
      for (const r of rotas) { const v = r.lock ? this.V.find((x) => x.id === r.lock) : (this.melhorTipo(r.seq) || {}).v; if (v) r.seq = this.twoOpt(v, r.seq); }
      return this.atribuir(rotas);
    };
    let { semVeic } = ajustar();
    let fora = semTipo.slice();
    // rotas sem veículo: desmontar e tentar encaixar paradas nas rotas com veículo
    if (semVeic.length) {
      const soltas = [];
      for (const r of semVeic) soltas.push(...r.seq);
      rotas = rotas.filter((r) => r.veic);
      soltas.sort((x, y) => this.penal(y) - this.penal(x));
      for (const i of soltas) {
        let best = null;
        for (const r of rotas) { const ins = this.melhorInsercao(r.veic, r.seq, i); if (ins && (!best || ins.a.custo.total - r.a.custo.total < best.delta)) best = { r, ins, delta: ins.a.custo.total - r.a.custo.total }; }
        if (best) { best.r.seq = best.ins.seq; best.r.a = best.ins.a; }
        else fora.push(i);
      }
      decisoes.push('A frota disponível não comporta todas as rotas montadas; paradas foram redistribuídas pelos veículos existentes.');
    }
    // 4) busca local: realocar paradas, eliminar rotas e trocar veículos
    let obj = this.objetivo(rotas, fora);
    const reatribuirTodos = () => {
      const copia = rotas.map((r) => ({ seq: r.seq.slice(), lock: r.lock }));
      const sv = this.atribuir(copia).semVeic;
      return { copia, sv };
    };
    let melhorou = true, voltas = 0;
    while (melhorou && Date.now() - t0 < limite && voltas++ < 30) {
      melhorou = false;
      // 4a) eliminar a rota de menor carga
      const ordem = rotas.slice().sort((a, b) => this.peso(a.seq) - this.peso(b.seq));
      for (const alvo of ordem) {
        if (alvo.lock || Date.now() - t0 > limite) continue;
        const outras = rotas.filter((r) => r !== alvo).map((r) => ({ seq: r.seq.slice(), veic: r.veic, a: r.a, lock: r.lock }));
        let falhou = false;
        for (const i of alvo.seq) {
          if (Date.now() - t0 > limite) { falhou = true; break; }
          let best = null;
          for (const r of outras) {
            // a rota receptora pode trocar de veículo pelo que ficará livre
            const cands = r.lock ? [r.veic] : [r.veic, alvo.veic];
            for (const v of cands) {
              if (!v) continue;
              const ins = this.melhorInsercao(v, r.seq, i);
              if (ins) { const d = ins.a.lucro - r.a.lucro; if (!best || d > best.d) best = { r, v, ins, d }; }
            }
          }
          if (!best) { falhou = true; break; }
          best.r.seq = best.ins.seq; best.r.veic = best.v; best.r.a = best.ins.a;
        }
        if (falhou) continue;
        // veículos duplicados após troca?
        const usados = outras.map((r) => r.veic);
        if (new Set(usados).size !== usados.length) continue;
        const novo = this.objetivo(outras, fora);
        if (novo > obj + 1e-6) { decisoes.push('Viagem de ' + (alvo.veic ? alvo.veic.nome : 'um veículo') + ' eliminada: ' + alvo.seq.length + ' parada(s) redistribuída(s), ' + (this.cfg.minimizarMotoristas === false ? '' : 'um motorista a menos no dia, ') + 'ganho de R$ ' + round(novo - obj - (this.pv() - (+this.cfg.pesoVeiculo || 0)), 2).toFixed(2).replace('.', ',') + '.'); rotas = outras; obj = novo; melhorou = true; break; }
      }
      if (melhorou) continue;
      // 4b) realocar uma parada para outra rota
      outer: for (const ra of rotas) {
        for (const i of ra.seq) {
          if (S[i].locks || Date.now() - t0 > limite) continue;
          const semI = ra.seq.filter((k) => k !== i);
          const aA = this.avaliar(ra.veic, semI);
          if (!aA.ok) continue;
          for (const rb of rotas) {
            if (rb === ra) continue;
            const ins = this.melhorInsercao(rb.veic, rb.seq, i);
            if (!ins) continue;
            const delta = (aA.vazio ? 0 : aA.lucro) + ins.a.lucro - ra.a.lucro - rb.a.lucro + (aA.vazio ? this.pv() : 0);
            if (delta > 0.5) {
              ra.seq = semI; ra.a = aA; rb.seq = ins.seq; rb.a = ins.a;
              if (!semI.length) rotas = rotas.filter((r) => r !== ra);
              obj = this.objetivo(rotas, fora); melhorou = true; break outer;
            }
          }
        }
      }
      if (melhorou) continue;
      // 4c) inserir paradas que ficaram de fora
      for (const i of fora.slice()) {
        let best = null;
        for (const r of rotas) { const ins = this.melhorInsercao(r.veic, r.seq, i); if (ins && (!best || ins.a.lucro - r.a.lucro > best.d)) best = { r, ins, d: ins.a.lucro - r.a.lucro }; }
        if (!best) {
          // abrir veículo livre
          const livres = this.cabeNova(rotas) ? this.V.filter((v) => !rotas.some((r) => r.veic === v)) : [];
          for (const v of livres) { const a = this.avaliar(v, [i]); if (a.ok && (!best || a.lucro > best.d)) best = { nova: { seq: [i], veic: v, a }, d: a.lucro - this.pv() }; }
        }
        if (best && best.d + this.penal(i) > 0) {
          if (best.nova) rotas.push(best.nova); else { best.r.seq = best.ins.seq; best.r.a = best.ins.a; }
          fora = fora.filter((k) => k !== i); obj = this.objetivo(rotas, fora); melhorou = true;
          continue;
        }
        // troca em cadeia: tirar uma parada j de uma rota para abrir espaço para i, e levar j para outra rota ou veículo livre
        let troca = null;
        const livres = this.cabeNova(rotas) ? this.V.filter((v) => !rotas.some((r) => r.veic === v)) : [];
        for (const r of rotas) {
          if (Date.now() - t0 > limite) break;
          for (const j of r.seq) {
            if (S[j].locks) continue;
            const semJ = r.seq.filter((k) => k !== j);
            const insI = this.melhorInsercao(r.veic, semJ, i);
            if (!insI) continue;
            let dest = null;
            for (const r2 of rotas) {
              if (r2 === r) continue;
              const insJ = this.melhorInsercao(r2.veic, r2.seq, j);
              if (insJ && (!dest || insJ.a.lucro - r2.a.lucro > dest.d)) dest = { r2, insJ, d: insJ.a.lucro - r2.a.lucro };
            }
            for (const v of livres) { const a = this.avaliar(v, [j]); if (a.ok && (!dest || a.lucro - this.pv() > dest.d)) dest = { nova: { seq: [j], veic: v, a }, d: a.lucro - this.pv() }; }
            if (!dest) continue;
            const ganho = insI.a.lucro - r.a.lucro + dest.d + this.penal(i);
            if (ganho > 0.5 && (!troca || ganho > troca.ganho)) troca = { r, insI, dest, ganho };
          }
        }
        if (troca) {
          troca.r.seq = troca.insI.seq; troca.r.a = troca.insI.a;
          if (troca.dest.nova) rotas.push(troca.dest.nova); else { troca.dest.r2.seq = troca.dest.insJ.seq; troca.dest.r2.a = troca.dest.insJ.a; }
          fora = fora.filter((k) => k !== i); obj = this.objetivo(rotas, fora); melhorou = true;
        }
      }
      // 4d) trocar veículo por um mais barato que também atende
      const { copia, sv } = reatribuirTodos();
      if (!sv.length) { const o2 = this.objetivo(copia, fora); if (o2 > obj + 0.5) { rotas = copia; obj = o2; melhorou = true; } }
    }
    // 4e) mínimo de entregas por veículo: rota abaixo do mínimo é desfeita; as paradas vão para outras rotas
    // ou aguardam o próximo dia. Paradas no limite do prazo seguram o veículo se a exceção estiver ligada.
    const minDe = (v) => (v && v.minEntregas != null && v.minEntregas !== '' ? +v.minEntregas : +(this.cfg.minEntregas || 0));
    const excecao = this.cfg.minExcecaoPrazo !== false;
    this.motivoFora = this.motivoFora || {};
    for (let volta = 0; volta < 50; volta++) {
      const curtas = rotas.filter((r) => r.veic && r.seq.length < minDe(r.veic) && !r.mantida).sort((a, b) => a.seq.length - b.seq.length);
      if (!curtas.length) break;
      const alvo = curtas[0];
      const min = minDe(alvo.veic);
      const outras = rotas.filter((r) => r !== alvo);
      const ficam = [];
      const movidas = [];
      // tenta primeiro levar as paradas para rotas que já atingem ou podem atingir o mínimo
      const ordem = alvo.seq.slice().sort((x, y) => this.penal(x) - this.penal(y));
      for (const i of ordem) {
        if (S[i].locks) { ficam.push(i); continue; }
        let best = null;
        for (const r of outras) {
          const ins = this.melhorInsercao(r.veic, r.seq, i);
          if (ins && (!best || ins.a.lucro - r.a.lucro > best.d)) best = { r, ins, d: ins.a.lucro - r.a.lucro };
        }
        if (best) { best.r.seq = best.ins.seq; best.r.a = best.ins.a; movidas.push(i); }
        else ficam.push(i);
      }
      const seguram = ficam.filter((i) => S[i].locks || (excecao && S[i].obrigatoria));
      const nome = alvo.veic.nome;
      if (movidas.length) decisoes.push(nome + ' tinha ' + alvo.seq.length + ' entrega(s), abaixo do mínimo de ' + min + ': ' + movidas.length + ' passaram para outros veículos.');
      if (seguram.length) {
        alvo.seq = ficam; alvo.mantida = true; alvo.a = this.avaliar(alvo.veic, alvo.seq);
        decisoes.push(nome + ' sai abaixo do mínimo (' + ficam.length + ' de ' + min + ') porque leva ' + seguram.length + ' entrega(s) ' + (seguram.some((i) => S[i].locks) ? 'travada(s) ou ' : '') + 'no limite do prazo.');
      } else {
        rotas = outras;
        for (const i of ficam) { fora.push(i); this.motivoFora[i] = 'Aguardando volume: ' + nome + ' não atingiria o mínimo de ' + min + ' entregas'; }
        if (ficam.length) decisoes.push(nome + ' não sai: ' + ficam.length + ' entrega(s) aguardam o próximo dia de rota (mínimo de ' + min + ' por veículo).');
      }
    }
    // rota que ficou mantida por exceção ainda pode receber paradas que estão fora
    for (const r of rotas.filter((x) => x.mantida)) {
      for (const i of fora.slice()) {
        const ins = this.melhorInsercao(r.veic, r.seq, i);
        if (ins) { r.seq = ins.seq; r.a = ins.a; fora = fora.filter((k) => k !== i); delete this.motivoFora[i]; }
      }
    }
    // 5) consolidar: notas opcionais que sozinhas abrem um veículo podem esperar o próximo dia permitido
    if (this.opts.consolidar) {
      for (const r of rotas.slice()) {
        if (r.lock) continue;
        if (r.seq.every((i) => !S[i].obrigatoria)) {
          rotas = rotas.filter((x) => x !== r); fora.push(...r.seq);
          decisoes.push((r.veic ? r.veic.nome : 'Veículo') + ' não sairia só com entregas que podem esperar: ' + r.seq.length + ' parada(s) adiadas.');
        }
      }
    }
    // refino final de sequência
    for (const r of rotas) r.seq = this.twoOpt(r.veic, r.seq);
    // verificação exata da carga (geometria completa com a ordem de entrega); retira paradas se preciso
    const soltas = [];
    for (const r of rotas) {
      let ex = this.cargaExata(r.veic, r.seq);
      while (!ex.ok && r.seq.length) {
        const cand = r.seq.filter((i) => !S[i].locks);
        if (!cand.length) break;
        cand.sort((x, y) => this.penal(x) - this.penal(y) || (S[y].kg - S[x].kg));
        const i = cand[0];
        r.seq = r.seq.filter((k) => k !== i); soltas.push(i);
        decisoes.push(S[i].dest + ' saiu de ' + r.veic.nome + ' na conferência da carga: ' + ex.motivos.join('; '));
        ex = this.cargaExata(r.veic, r.seq);
      }
    }
    rotas = rotas.filter((r) => r.seq.length);
    for (const i of soltas) {
      let best = null;
      for (const r of rotas) {
        const ins = this.melhorInsercao(r.veic, r.seq, i);
        if (ins && this.cargaExata(r.veic, ins.seq).ok && (!best || ins.a.lucro - r.a.lucro > best.d)) best = { r, ins, d: ins.a.lucro - r.a.lucro };
      }
      if (best) { best.r.seq = best.ins.seq; } else fora.push(i);
    }
    for (const r of rotas) r.a = this.avaliar(r.veic, r.seq, true);
    rotas.sort((a, b) => (a.veic.nome || '').localeCompare(b.veic.nome || ''));
    return { rotas, fora, decisoes, tempoMs: Date.now() - t0 };
  };
  RE.Solver = Solver;

  // Monta o resultado final de uma rota: sequência, horários, carga com ordem de descarga, custos
  RE.detalharRota = (solver, r, extras) => {
    const S = solver.S, ctx = solver.ctx, cfg = solver.cfg;
    const a = solver.avaliar(r.veic, r.seq, true, true);
    const paradasCarga = r.seq.map((i, k) => ({ key: S[i].key, kg: S[i].kg, m3: S[i].m3, tubos: S[i].tubos, ordem: k }));
    const carga = RE.verificarCarga(r.veic, paradasCarga, cfg, true);
    const custo = RE.custoRota(r.veic, a.km, [...new Set(r.seq.map((i) => S[i].cidadeId))], ctx, extras || 0);
    const receita = round(r.seq.reduce((s, i) => s + S[i].receita, 0), 2);
    const lucro = round(receita - custo.total, 2);
    const pagTab = RE.pagamentoTabela(r.veic.tipo, a.km, [...new Set(r.seq.map((i) => S[i].cidadeId))], ctx);
    return {
      pagamento: pagTab ? { regiao: pagTab.regiao, regra: pagTab.regra } : null,
      veiculoId: r.veic.id, veiculoNome: r.veic.nome, veiculoTipo: r.veic.tipo, placa: r.veic.placa || '',
      motoristaId: r.veic.motoristaId || '',
      paradas: r.seq.map((i, k) => ({
        key: S[i].key, notas: S[i].notas, dest: S[i].dest, cidadeId: S[i].cidadeId, cidadeNome: S[i].cidadeNome, endereco: S[i].endereco,
        lat: S[i].lat, lon: S[i].lon, coordFonte: S[i].coordFonte, kg: round(S[i].kg, 2), m3: round(S[i].m3, 3), receita: round(S[i].receita, 2),
        qtdTubos: S[i].tubos.reduce((s, t) => s + t.barras, 0),
        chegada: a.chegadas ? fmtHM(a.chegadas[k].chegada) : '', saida: a.chegadas ? fmtHM(a.chegadas[k].saida) : '',
        obrigatoria: S[i].obrigatoria, atrasada: S[i].atrasada, prioridade: !!S[i].prioridade, travada: !!S[i].locks,
      })),
      km: a.km, horas: a.horas, retorno: fmtHM(a.retorno || 0), ok: a.ok && carga.ok, motivos: (a.motivos || []).concat(carga.ok ? [] : carga.motivos),
      minEntregas: (r.veic.minEntregas != null && r.veic.minEntregas !== '' ? +r.veic.minEntregas : +(cfg.minEntregas || 0)),
      cargaOk: carga.ok, motivosCarga: carga.ok ? [] : carga.motivos, m3Outros: carga.m3Outros, m3Livre: carga.m3Livre, m3Tubos: carga.m3Tubos,
      receita, custo, lucro, margem: receita > 0 ? round(lucro / receita * 100, 1) : null,
      kg: carga.kg, m3: carga.m3Usado, ocupPeso: carga.ocupPeso, ocupVol: carga.ocupVol,
      custoPorEntrega: r.seq.length ? round(custo.total / r.seq.length, 2) : 0, custoPorKm: a.km ? round(custo.total / a.km, 2) : 0,
      tubos: carga.tubos ? RE.resumoTubos(carga.tubos) : null,
      estimativa: solver.estimativa || r.seq.some((i) => S[i].coordFonte !== 'confirmada'),
    };
  };
  // versão serializável do encaixe (para salvar e desenhar)
  RE.resumoTubos = (enc) => {
    const ser = (c) => ({ de: c.de, di: c.di || null, x: round(c.x || 0, 1), y: round(c.y || 0, 1), n: c.pecas.length, compr: round(c.usadoCompr, 2), kg: round(c.kg || 0, 1), parada: c.pecas[0].parada, mat: c.pecas[0].material, rot: c.pecas[0].rotulo, f: c.filhos.map(ser) });
    return { ok: enc.ok, motivo: enc.motivo, colunas: enc.colunas.map(ser), conjuntos: enc.conjuntos, encaixados: enc.encaixados, total: enc.totalTubos, alturaMm: enc.alturaUsadaMm, ocupSecao: enc.ocupacaoSecao, comprM: enc.comprUsadoM, kg: enc.kgTotal };
  };

  // Plano completo para uma data
  RE.planejar = (notasEnr, data, ctx, opts) => {
    opts = opts || {};
    const veics = ctx.veiculos.filter((v) => veicDisponivel(v, data) && (!opts.tipos || opts.tipos.includes(v.tipo)));
    const { notas, fora: pendentes } = RE.elegiveis(notasEnr, data, ctx, opts.cidades);
    const stops = RE.consolidar(notas);
    const solver = new Solver(stops, veics, ctx, { consolidar: opts.consolidar, tempoMs: opts.tempoMs });
    const res = solver.resolver();
    const rotas = res.rotas.map((r) => RE.detalharRota(solver, r, (opts.extras || {})[r.veic.id]));
    const naoRoteirizadas = res.fora.map((i) => {
      const s = stops[i];
      let motivo = (solver.motivoFora && solver.motivoFora[i]) || (s.obrigatoria ? 'Sem veículo ou capacidade disponível' : 'Pode aguardar o próximo dia de rota');
      if (!veics.length) motivo = 'Nenhum veículo disponível';
      else if (ctx.maxMotoristas === 0) motivo = 'Nenhum motorista marcado como disponível no dia';
      else {
        const viavel = (solver.motivoFora && solver.motivoFora[i]) || solver.tipos.some((v) => solver.avaliar(v, [i]).ok);
        if (!viavel) motivo = (solver.avaliar(solver.tipos[0], [i]).motivos || ['Não cabe em nenhum veículo']).join('; ');
      }
      return { key: s.key, notas: s.notas, dest: s.dest, cidadeNome: s.cidadeNome, obrigatoria: s.obrigatoria, atrasada: s.atrasada, prioridade: !!s.prioridade, motivo };
    });
    const tot = RE.totais(rotas);
    return {
      data, criadoEm: new Date().toISOString(), rotas, naoRoteirizadas,
      pendentes: pendentes.map((p) => ({ nota: p.nota.id, motivo: p.motivo })),
      decisoes: res.decisoes, totais: tot, estimativa: rotas.some((r) => r.estimativa),
      veiculosDisponiveis: veics.length, motoristasDisponiveis: ctx.maxMotoristas >= 0 ? ctx.maxMotoristas : null, tempoMs: res.tempoMs, opcoes: { consolidar: !!opts.consolidar, tipos: opts.tipos || null, cidades: opts.cidades || null },
    };
  };
  RE.totais = (rotas) => {
    const t = { veiculos: rotas.length, entregas: 0, notas: 0, km: 0, receita: 0, custo: 0, lucro: 0, kg: 0, tubos: 0 };
    for (const r of rotas) { t.entregas += r.paradas.length; t.notas += r.paradas.reduce((s, p) => s + p.notas.length, 0); t.km += r.km; t.receita += r.receita; t.custo += r.custo.total; t.kg += r.kg; t.tubos += r.paradas.reduce((s, p) => s + p.qtdTubos, 0); }
    t.lucro = t.receita - t.custo;
    for (const k of ['km', 'receita', 'custo', 'lucro', 'kg']) t[k] = round(t[k], 2);
    t.margem = t.receita > 0 ? round(t.lucro / t.receita * 100, 1) : null;
    return t;
  };

  // Cenários comparativos com conjuntos de veículos diferentes
  RE.cenarios = (notasEnr, data, ctx, opts) => {
    const disp = ctx.veiculos.filter((v) => veicDisponivel(v, data));
    const porTipo = { fiorino: disp.filter((v) => v.tipo === 'fiorino'), van: disp.filter((v) => v.tipo === 'van'), tubos: disp.filter((v) => v.tipo === 'tubos') };
    const nomes = { fiorino: 'Fiorino', van: 'Van convencional', tubos: 'Van de tubos' };
    const lista = [{ nome: 'Frota disponível (otimizado)', frota: disp }];
    for (const t of ['fiorino', 'van', 'tubos']) {
      const vs = porTipo[t];
      for (let k = 1; k <= vs.length; k++) lista.push({ nome: k + ' ' + (k > 1 ? { fiorino: 'Fiorinos', van: 'Vans convencionais', tubos: 'Vans de tubos' }[t] : nomes[t]), frota: vs.slice(0, k) });
    }
    if (porTipo.fiorino.length && porTipo.van.length) lista.push({ nome: '1 Fiorino e 1 Van convencional', frota: [porTipo.fiorino[0], porTipo.van[0]] });
    if (porTipo.tubos.length && porTipo.fiorino.length) lista.push({ nome: '1 Van de tubos e 1 Fiorino', frota: [porTipo.tubos[0], porTipo.fiorino[0]] });
    const vistos = new Set();
    const res = [];
    for (const c of lista) {
      const sig = c.frota.map((v) => v.id).sort().join(',');
      if (!c.frota.length || vistos.has(sig)) continue;
      vistos.add(sig);
      const p = RE.planejar(notasEnr, data, Object.assign({}, ctx, { veiculos: c.frota }), Object.assign({}, opts, { tempoMs: Math.min((opts && opts.tempoMs) || 1200, 1200) }));
      const obrigFora = p.naoRoteirizadas.filter((x) => x.obrigatoria).length;
      res.push({ nome: c.nome, veiculos: p.totais.veiculos, entregas: p.totais.entregas, foraTotal: p.naoRoteirizadas.length, obrigFora, km: p.totais.km, receita: p.totais.receita, custo: p.totais.custo, lucro: p.totais.lucro, margem: p.totais.margem, frota: c.frota.map((v) => v.nome) });
    }
    // ordenação: atende todas as obrigatórias, depois mais entregas, depois lucro, depois menos veículos
    const menosMot = !ctx.cfg || ctx.cfg.minimizarMotoristas !== false;
    res.sort((a, b) => (a.obrigFora - b.obrigFora) || (b.entregas - a.entregas) || (menosMot ? (a.veiculos - b.veiculos) || (b.lucro - a.lucro) : (b.lucro - a.lucro) || (a.veiculos - b.veiculos)));
    if (res.length) {
      const m = res[0];
      m.melhor = true;
      const motivos = [];
      for (const o of res.slice(1)) {
        if (o.obrigFora > m.obrigFora) motivos.push(o.nome + ': deixa ' + o.obrigFora + ' entrega(s) obrigatória(s) sem rota');
        else if (o.entregas < m.entregas) motivos.push(o.nome + ': atende ' + (m.entregas - o.entregas) + ' entrega(s) a menos');
        else if (menosMot && o.veiculos > m.veiculos) motivos.push(o.nome + ': usa ' + (o.veiculos - m.veiculos) + ' motorista(s) a mais');
        else if (o.lucro < m.lucro) motivos.push(o.nome + ': lucro R$ ' + round(m.lucro - o.lucro, 2).toFixed(2).replace('.', ',') + ' menor');
      }
      m.porque = 'Atende ' + m.entregas + ' entrega(s) com ' + m.veiculos + ' veículo(s), lucro de R$ ' + m.lucro.toFixed(2).replace('.', ',') + (m.margem != null ? ' (margem ' + String(m.margem).replace('.', ',') + '%)' : '') + '.';
      m.comparacao = motivos.slice(0, 6);
    }
    return res;
  };

  // Recalcula um plano após edição manual (mover, reordenar). Mantém a ordem dada.
  RE.recalcularPlano = (plano, notasEnr, ctx) => {
    const byId = new Map(notasEnr.map((n) => [n.id, n]));
    const rotas = [];
    for (const r of plano.rotas) {
      const base = ctx.veiculos.find((v) => v.id === r.veiculoId);
      if (!base) continue;
      const veic = r.motoristaId ? Object.assign({}, base, { motoristaId: r.motoristaId }) : base;
      const ns = [];
      for (const p of r.paradas) for (const id of p.notas) { const n = byId.get(id); if (n) ns.push(Object.assign({}, n, { obrigatoria: !!p.obrigatoria, atrasada: !!p.atrasada, travaVeiculo: p.travada ? veic.id : null })); }
      const stops = RE.consolidar(ns);
      // manter a ordem das paradas editada
      const ordem = r.paradas.map((p) => p.key);
      stops.sort((a, b) => ordem.indexOf(a.key) - ordem.indexOf(b.key));
      const solver = new Solver(stops, [veic], ctx, {});
      const det = RE.detalharRota(solver, { veic, seq: stops.map((_, i) => i) }, r.custo && r.custo.extras);
      det.motoristaId = r.motoristaId || veic.motoristaId || '';
      const entregues = new Set((r.paradas || []).filter((p) => p.entregue).map((p) => p.key));
      det.paradas.forEach((p) => { if (entregues.has(p.key)) p.entregue = true; });
      rotas.push(det);
    }
    const p = Object.assign({}, plano, { rotas, totais: RE.totais(rotas), editadoEm: new Date().toISOString(), estimativa: rotas.some((r) => r.estimativa) });
    return p;
  };

  // ---------- padrões ----------
  RE.CFG_PADRAO = {
    base: { nome: 'Americana/SP', lat: -22.7374, lon: -47.3331 },
    fatorRodoviario: 1.25, velocidadeMedia: 55, kmUrbano: 4, inicioJornada: '07:00', jornadaMaxHoras: 10,
    descargaPorNotaMin: 5, precoDiesel: 6.19, precoGasolina: 6.29, precoEtanol: 4.39,
    folgaEncaixeMm: 10, folgaSecaoMm: 5, niveisEncaixe: 3, cargaInternaKgM: 25, aproveitamento: 0.85,
    tabelaMotorista: RE.TABELA_MOTORISTA_PADRAO,
    // ordem importa: Leal Dutra antes de Comercial Leal
    fretePctClientes: [{ nome: 'Leal Dutra', pct: 5.5 }, { nome: 'Comercial Leal', pct: 5.25 }, { nome: 'Conasid', pct: 6 }, { nome: 'Navas', pct: 5 }],
    cubagemKgM3: 0, prazoPadraoDias: 0, pesoVeiculo: 50, consolidar: false, combos: [], minEntregas: 20, minExcecaoPrazo: true, minimizarMotoristas: true,
  };
  RE.VEICULOS_PADRAO = [
    { id: 'fiorino-1', nome: 'Fiorino 1', tipo: 'fiorino', placa: '', capKg: 600, capM3: 3, custoDiaria: 400, kmL: 11, combustivel: 'gasolina', compr: 1.9, larg: 1.3, alt: 1.2, aceitaTubos: true, custoKm: 0, custoAjudante: 0, diariaMotorista: 0, multPedagio: 1, ativo: true },
    { id: 'van-1', nome: 'Van 1', tipo: 'van', placa: '', capKg: 1500, capM3: 10, custoDiaria: 700, kmL: 9, combustivel: 'diesel', compr: 3.3, larg: 1.75, alt: 1.75, aceitaTubos: true, custoKm: 0, custoAjudante: 0, diariaMotorista: 0, multPedagio: 1, ativo: true },
    { id: 'tubos-1', nome: 'Van Tubos 1', tipo: 'tubos', placa: '', capKg: 1500, capM3: 15, custoDiaria: 800, kmL: 8, combustivel: 'diesel', compr: 4.2, larg: 1.8, alt: 2.0, secaoL: 1, secaoA: 1, tuboCompr: 6, aceitaTubos: true, custoKm: 0, custoAjudante: 0, diariaMotorista: 0, multPedagio: 1, ativo: true },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = RE; else G.RE = RE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
