/* Interface do Roteirizador. Depende de RE (motor), DEMO e MUN_DATA. */
(function () {
  'use strict';
  RE.loadMunicipios(MUN_DATA);

  // ---------------- utilidades ----------------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (v) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const nf = (v, d = 1) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 0) => (v == null || isNaN(v) ? '—' : nf(v * 100, d) + '%');
  // toda data na tela como dd/mm/aaaa (aceita ISO, dd/mm/aa e dd/mm)
  const dBR = (s) => {
    s = String(s || '').trim(); if (!s) return '—';
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[3] + '/' + m[2] + '/' + m[1];
    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (m) { const y = !m[3] ? String(new Date().getFullYear()) : m[3].length === 2 ? '20' + m[3] : m[3]; return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + y; }
    return s;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));
  const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const agoraISO = () => new Date().toISOString();
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const COR = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)', 'var(--r5)', 'var(--r6)', 'var(--r7)', 'var(--r8)'];
  const TIPO = { fiorino: 'Fiorino', van: 'Van convencional', tubos: 'Van de tubos' };
  const TIPO_CURTO = { fiorino: 'Fiorino', van: 'Van', tubos: 'Van com tubo' };
  // trocar o tipo aplica capacidade, medidas e custo padrão do novo tipo
  async function trocarTipoVeic(id, tipo) {
    const v = ST.veiculos.get(id); if (!v || !TIPO[tipo]) return;
    if (v.tipo === tipo) { if (v.conferir) { const q = Object.assign({}, v); delete q.conferir; await salvar('veiculos', id, q); render(); } return; }
    const base = RE.VEICULOS_PADRAO.find((x) => x.tipo === tipo) || {};
    const q = Object.assign({}, v, { tipo, capKg: base.capKg, capM3: base.capM3, compr: base.compr, larg: base.larg, alt: base.alt, custoDiaria: base.custoDiaria, kmL: base.kmL, combustivel: base.combustivel, aceitaTubos: base.aceitaTubos });
    if (tipo === 'tubos') Object.assign(q, { secaoL: base.secaoL, secaoA: base.secaoA, tuboCompr: base.tuboCompr }); else { delete q.secaoL; delete q.secaoA; delete q.tuboCompr; }
    if (v.nome && TIPO[v.tipo] && v.nome.startsWith(TIPO[v.tipo])) q.nome = TIPO[tipo] + v.nome.slice(TIPO[v.tipo].length);
    delete q.conferir;
    await salvar('veiculos', id, q);
    registrar('Alteração', 'Veículo ' + (v.placa || v.nome) + ': ' + TIPO_CURTO[v.tipo] + ' → ' + TIPO_CURTO[tipo]);
    render();
  }
  const DIAS = RE.DIAS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const I = {
    painel: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 3v8h8V3z"/></svg>',
    notas: '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/></svg>',
    rotas: '<svg viewBox="0 0 24 24"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
    carga: '<svg viewBox="0 0 24 24"><path d="M2 7h12v10H2zM14 10h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    rel: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    cad: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h3M8 17h6"/></svg>',
    cfg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>',
    up2: '<svg viewBox="0 0 24 24"><path d="M12 3v13M6 9l6-6 6 6M4 21h16"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 3v13M6 11l6 6 6-6M4 21h16"/></svg>',
    wa: '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-4A8 8 0 1 1 8 19z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    sobra: '<svg viewBox="0 0 24 24"><path d="M3 7h13v10H3zM16 10h3l2 3v4h-5"/><path d="M9 3v4M6 12l6 0"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  };

  // ---------------- estado ----------------
  const ST = {
    cfg: Object.assign({}, RE.CFG_PADRAO), veiculos: new Map(), motoristas: new Map(), cidades: new Map(), produtos: new Map(),
    clientes: new Map(), notas: new Map(), planos: new Map(), log: new Map(), sobras: new Map(), disponibilidade: new Map(), ssw: new Map(), carregado: {}, admin: true, uid: 'local', nomes: {},
  };
  let ui = { tab: 'painel', data: null, notasFiltro: { status: 'ativas', cidade: '', q: '' }, notasPag: 0, cadTab: 'veiculos', notaAberta: null, relTipo: 'romaneio', cargaVeic: null, imp: null, cenarios: null, calc: null, confirmar: null, notasSub: 'lista', mapaFoco: null, filtroCombo: '' };
  try { const s = JSON.parse(localStorage.getItem('rot-ui') || 'null'); if (s) { ui.tab = s.tab || ui.tab; ui.cadTab = s.cadTab || ui.cadTab; ui.relTipo = s.relTipo || ui.relTipo; } } catch (e) { /* sem armazenamento */ }
  const lembrarUI = () => { try { localStorage.setItem('rot-ui', JSON.stringify({ tab: ui.tab, cadTab: ui.cadTab, relTipo: ui.relTipo })); } catch (e) { /* ok */ } };
  let VER = 0;
  const PATH = { cfg: 'cad/main', veiculos: 'cad/main/veiculos', motoristas: 'cad/main/motoristas', cidades: 'cad/main/cidades', produtos: 'op/main/produtos', clientes: 'op/main/clientes', notas: 'op/main/notas', planos: 'op/main/planos', log: 'op/main/log', sobras: 'op/main/sobras', disponibilidade: 'op/main/disponibilidade', ssw: 'op/main/ssw' };
  const COLS = ['veiculos', 'motoristas', 'cidades', 'produtos', 'clientes', 'notas', 'planos', 'log', 'sobras', 'disponibilidade', 'ssw'];
  const DB = { db: null, local: false };

  const salvarLocal = () => {
    if (!DB.local) return;
    try {
      const o = { cfg: ST.cfg };
      for (const c of COLS) o[c] = [...ST[c].entries()];
      localStorage.setItem('rot-dados', JSON.stringify(o));
    } catch (e) { /* armazenamento cheio ou bloqueado */ }
  };
  const carregarLocal = () => {
    try {
      const o = JSON.parse(localStorage.getItem('rot-dados') || 'null');
      if (!o) return;
      ST.cfg = Object.assign({}, RE.CFG_PADRAO, o.cfg || {});
      for (const c of COLS) ST[c] = new Map(o[c] || []);
    } catch (e) { /* ok */ }
  };

  async function salvar(col, id, data) {
    data = clean(data);
    if (col === 'cfg') { ST.cfg = Object.assign({}, RE.CFG_PADRAO, data); }
    else ST[col].set(id, data);
    VER++;
    if (DB.local) { salvarLocal(); agendar(); return true; }
    const ref = col === 'cfg' ? DB.db.doc(PATH.cfg) : DB.db.collection(PATH[col]).doc(id);
    for (let t = 0; t < 4; t++) {
      try { await ref.set(data); return true; }
      catch (e) {
        if (e && (e.code === 'unavailable' || e.code === 'resource_exhausted') && t < 3) { await sleep(400 * (t + 1) + Math.random() * 300); continue; }
        if (e && e.code === 'invalid_argument') toast('Sem permissão para alterar este dado (' + (col === 'cfg' || PATH[col].startsWith('cad') ? 'somente administradores' : 'perfil sem escrita') + ').', true);
        else if (e && e.code === 'quota_exceeded') toast('O banco atingiu o limite de documentos. Exclua notas antigas em Ajustes para liberar espaço.', true);
        else toast('Não foi possível salvar: ' + ((e && e.message) || e), true);
        return false;
      }
    }
    return false;
  }
  async function remover(col, id) {
    ST[col].delete(id); VER++;
    if (DB.local) { salvarLocal(); agendar(); return; }
    try { await DB.db.collection(PATH[col]).doc(id).delete(); } catch (e) { toast('Não foi possível excluir: ' + ((e && e.message) || e), true); }
  }
  // gravação em lote com poucas chamadas simultâneas
  async function salvarVarios(col, itens, onProg) {
    let feitos = 0, i = 0;
    const worker = async () => { while (i < itens.length) { const it = itens[i++]; await salvar(col, it.id, it.data); feitos++; if (onProg) onProg(feitos); } };
    await Promise.all(Array.from({ length: DB.local ? 1 : 4 }, worker));
  }
  async function registrar(acao, det) {
    const d = hoje();
    const doc = ST.log.get(d) || { data: d, entradas: [] };
    const ent = (doc.entradas || []).concat([{ t: agoraISO(), u: ST.uid, acao, det: String(det || '').slice(0, 400) }]).slice(-400);
    await salvar('log', d, { data: d, entradas: ent });
  }

  // ---------------- dados derivados ----------------
  // disponibilidade marcada no Painel para cada dia (operadores podem alterar)
  const dispDia = (d) => { const x = ST.disponibilidade.get(d) || {}; return { veiculos: x.veiculos || {}, motoristas: x.motoristas || {} }; };
  const motRecente = (m, d) => (m.ultimoUso ? m.ultimoUso >= RE.addDays(d, -30) : !m.origem);
  const motDisp = (m, d) => { const x = dispDia(d).motoristas[m.id]; return x === true ? true : x === false ? false : RE.motoristaDisponivel(m, d) && motRecente(m, d); };
  const cidadeCoord = (c) => { const m = RE.findMun(c.id); return Object.assign({}, c, { lat: c.lat != null ? c.lat : m && m.lat, lon: c.lon != null ? c.lon : m && m.lon }); };
  let CTX = null, CTX_V = -1;
  // Motoristas com a mesma placa contam como um só: fica o que tem o veículo fixo ou o que rodou por último.
  let MOTU_V = -1, MOTU = [];
  function motoristasUnicos() {
    if (MOTU_V === VER) return MOTU;
    const placa = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fixa = new Map(); for (const v of ST.veiculos.values()) if (v.motoristaId && v.placa) fixa.set(v.motoristaId, placa(v.placa));
    const porPlaca = new Map(), soltos = [];
    for (const m of ST.motoristas.values()) {
      const p = fixa.get(m.id) || placa(m.ultimaPlaca);
      if (!p) { soltos.push(m); continue; }
      const cur = porPlaca.get(p);
      const melhor = (x) => [fixa.has(x.id) ? 1 : 0, x.ultimoUso || '', x.telefone ? 1 : 0];
      if (!cur) { porPlaca.set(p, m); continue; }
      const a2 = melhor(m), b2 = melhor(cur);
      if (a2[0] > b2[0] || (a2[0] === b2[0] && (a2[1] > b2[1] || (a2[1] === b2[1] && a2[2] > b2[2])))) porPlaca.set(p, m);
    }
    MOTU = [...porPlaca.values(), ...soltos]; MOTU_V = VER; return MOTU;
  }
  // Cada motorista marcado no dia leva um veículo: o fixo dele, ou um veículo livre (de preferência a última placa que ele usou)
  function veiculosComMotorista(d) {
    const vs = [...ST.veiculos.values()].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { numeric: true }));
    const dd = dispDia(d);
    const usavel = (v) => RE.veicDisponivel(v, d) && dd.veiculos[v.id] !== false;
    if (!ST.motoristas.size) return vs.map((v) => (dd.veiculos[v.id] === false ? Object.assign({}, v, { indispDia: true }) : v));
    const disp = motoristasUnicos().filter((m) => motDisp(m, d));
    const comVeic = new Set(vs.filter((v) => usavel(v) && v.motoristaId && disp.some((m) => m.id === v.motoristaId)).map((v) => v.motoristaId));
    const pool = disp.filter((m) => !comVeic.has(m.id));
    const placa = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const out = new Map();
    for (const v of vs) {
      if (!usavel(v)) { out.set(v.id, dd.veiculos[v.id] === false ? Object.assign({}, v, { indispDia: true }) : v); continue; }
      if (v.motoristaId && comVeic.has(v.motoristaId)) out.set(v.id, v);
    }
    const livres = vs.filter((v) => usavel(v) && !out.has(v.id));
    for (const m of pool.slice()) {
      const k = livres.findIndex((v) => m.ultimaPlaca && placa(v.placa) === placa(m.ultimaPlaca));
      if (k >= 0) { const v = livres.splice(k, 1)[0]; out.set(v.id, Object.assign({}, v, { motoristaId: m.id, motoristaDoDia: true })); pool.splice(pool.indexOf(m), 1); }
    }
    for (const m of pool) { if (!livres.length) break; const v = livres.shift(); out.set(v.id, Object.assign({}, v, { motoristaId: m.id, motoristaDoDia: true })); }
    for (const v of livres) out.set(v.id, Object.assign({}, v, { motoristaIndisponivel: (v.motoristaId && (ST.motoristas.get(v.motoristaId) || {}).nome) || 'sem motorista no dia' }));
    return vs.map((v) => out.get(v.id));
  }
  function ctx() {
    if (CTX_V === VER && CTX && CTX.data === ui.data) return CTX;
    const cidades = {};
    for (const [id, c] of ST.cidades) cidades[id] = cidadeCoord(c);
    CTX = {
      cfg: ST.cfg, cidades, motoristas: Object.fromEntries(ST.motoristas), clientes: Object.fromEntries(ST.clientes),
      produtos: [...ST.produtos.values()],
      veiculos: veiculosComMotorista(ui.data),
      base: ST.cfg.base, data: ui.data,
      maxMotoristas: ST.motoristas.size ? motoristasUnicos().filter((m) => motDisp(m, ui.data)).length : undefined,
    };
    CTX_V = VER;
    return CTX;
  }
  let ENR = [], ENR_V = -1, ENR_MAP = new Map();
  function notasEnr() {
    if (ENR_V === VER) return ENR;
    const c = ctx();
    const ign = ignoradas();
    ENR = [...ST.notas.values()].filter((n) => n.origem === 'manual' || !ign[nfChave(n.numero)]).map((n) => RE.enriquecer(n, c));
    // cruzamento com as sobras ainda não baixadas (de hoje e de dias anteriores): a nota vira prioridade
    // nota criada a partir de uma sobra segue a situação da sobra (em rota / entregue pelo SSW ou marcada à mão)
    for (const n of ENR) if (n.origem === 'sobra' && /^sb-/.test(n.id)) { const x = ST.sobras.get(n.id.slice(3)); const st = x ? sobraSituacao(x).st : 'entregue'; if (st === 'entregue' || st === 'em_rota') n.status = st; }
    const sb = sobrasAbertas(), porId = new Map(), porNum = new Map();
    for (const x of sb) { if (x.notaId) porId.set(x.notaId, x); const k = nfChave(x.numero); if (k && (!porNum.has(k) || x.data < porNum.get(k).data)) porNum.set(k, x); }
    for (const n of ENR) { const x = porId.get(n.id) || porNum.get(nfChave(n.numero)); if (x && !['entregue', 'cancelada', 'em_rota'].includes(n.status) && !n.bloqueioUsuario) { n.sobraDe = x.data; n.sobraId = x.id; n.prioridade = true; } }
    ENR_MAP = new Map(ENR.map((n) => [n.id, n]));
    ENR_V = VER;
    return ENR;
  }
  const notaE = (id) => { notasEnr(); return ENR_MAP.get(id); };
  const plano = () => ST.planos.get(ui.data);
  const veic = (id) => ST.veiculos.get(id);
  const corRota = (plan, vid) => { const i = plan ? plan.rotas.findIndex((r) => r.veiculoId === vid) : 0; return COR[(i < 0 ? 0 : i) % COR.length]; };
  const nfsTxt = (ids) => ids.map((id) => { const n = ST.notas.get(id); return n ? n.numero || id.slice(-6) : id.slice(-6); }).join(', ');

  // situação do plano frente às notas atuais
  function frescor(plan) {
    if (!plan) return null;
    const noPlano = new Set();
    for (const r of plan.rotas) for (const p of r.paradas) p.notas.forEach((id) => noPlano.add(id));
    for (const u of plan.naoRoteirizadas || []) u.notas.forEach((id) => noPlano.add(id));
    const { notas } = RE.elegiveis(notasEnr(), plan.data, ctx());
    const novas = notas.filter((n) => !noPlano.has(n.id));
    const canceladas = [...noPlano].filter((id) => { const n = ST.notas.get(id); return !n || n.status === 'cancelada'; });
    return { novas, canceladas };
  }

  // ---------------- toast e agendamento ----------------
  let toastT = null;
  function toast(msg, bad) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, bad ? 6500 : 3200);
  }
  let rT = null, pend = false;
  function agendar() {
    clearTimeout(rT);
    rT = setTimeout(() => {
      const a = document.activeElement;
      if (a && a.closest && a.closest('#main') && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file') { pend = true; return; }
      render();
    }, 120);
  }
  document.addEventListener('focusout', () => { if (pend) { pend = false; setTimeout(() => { const a = document.activeElement; if (!(a && a.closest && a.closest('#main') && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) render(); else pend = true; }, 60); } });

  // ---------------- bibliotecas sob demanda ----------------
  const LIBS = {
    jszip: ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip'],
    xlsx: ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX'],
    jspdf: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf'],
    pdfjs: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib'],
  };
  const libP = {};
  function lib(nome) {
    const [url, g] = LIBS[nome];
    if (window[g]) return Promise.resolve(window[g]);
    if (!libP[nome]) libP[nome] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = () => (window[g] ? res(window[g]) : rej(new Error('Biblioteca ' + nome + ' não carregou')));
      s.onerror = () => { delete libP[nome]; rej(new Error('Sem conexão para carregar ' + nome)); };
      document.head.appendChild(s);
    });
    return libP[nome];
  }

  // ---------------- importação ----------------
  async function lerPDF(buf, nomeArq) {
    const pdfjs = await lib('pdfjs');
    try { pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (e) { /* ok */ }
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      pages.push(tc.items.map((it) => it.str).join(' '));
    }
    const temTexto = pages.some((t) => t.replace(/\s/g, '').length > 40);
    if (!temTexto) return { erro: nomeArq + ': PDF sem texto (digitalizado). O reconhecimento por imagem não roda nesta página; importe o XML da nota.' };
    const notas = RE.parseDanfeText(pages);
    if (!notas.length) return { erro: nomeArq + ': nenhuma chave de acesso válida encontrada no PDF' };
    return { notas };
  }
  async function lerArquivo(nome, obter, out) {
    const ext = (nome.split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'xml') {
        const r = RE.parseNFeXML(await obter('text'));
        if (r.tipo === 'nfe') out.notas.push(r.nota);
        else if (r.tipo === 'cancelamento') out.cancel.push(r.chave);
        else out.ign.push(nome + ': ' + r.motivo);
      } else if (ext === 'zip') {
        const JSZip = await lib('jszip');
        const z = await JSZip.loadAsync(await obter('arraybuffer'));
        const ents = Object.values(z.files).filter((f) => !f.dir);
        ui.imp.total += ents.length - 1;
        for (const f of ents) { await lerArquivo(f.name.split('/').pop(), (t) => f.async(t === 'text' ? 'string' : 'arraybuffer'), out); ui.imp.lidos++; if (ui.imp.lidos % 25 === 0) atualizarProg(); }
        return;
      } else if (ext === 'pdf') {
        const r = await lerPDF(await obter('arraybuffer'), nome);
        if (r.erro) out.ign.push(r.erro); else out.notas.push(...r.notas);
      } else if (ext === 'csv' || ext === 'txt') {
        out.notas.push(...RE.rowsToNotas(RE.parseCSV(await obter('text'))));
      } else if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
        const X = await lib('xlsx');
        const wb = X.read(await obter('arraybuffer'), { type: 'array', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        out.notas.push(...RE.rowsToNotas(X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })));
      } else out.ign.push(nome + ': formato não suportado');
    } catch (e) { out.ign.push(nome + ': ' + ((e && e.message) || e)); }
  }
  const idDaNota = (n) => (n.chave && n.chave.length === 44 ? n.chave : 'n-' + hash([n.numero, n.serie, n.emitenteDoc || n.emitente, n.destDoc || n.destNome].join('|')));
  async function importar(files) {
    files = [...files];
    if (!files.length) return;
    ui.imp = { total: files.length, lidos: 0, gravados: 0, aGravar: 0, fase: 'Lendo arquivos', res: null };
    render();
    const out = { notas: [], cancel: [], ign: [] };
    for (const f of files) {
      await lerArquivo(f.name, (t) => (t === 'text' ? f.text() : f.arrayBuffer()), out);
      ui.imp.lidos++; atualizarProg();
    }
    const res = { novas: 0, atualizadas: 0, duplicadas: 0, canceladas: 0, ign: out.ign };
    const gravar = [];
    const vistos = new Set();
    for (const n of out.notas) {
      const id = idDaNota(n);
      if (vistos.has(id)) { res.duplicadas++; continue; }
      vistos.add(id);
      const ex = ST.notas.get(id);
      const k = nfChave(n.numero);
      const doSSW = !ex && k ? [...ST.notas.values()].find((o) => o.origem === 'ssw' && nfChave(o.numero) === k && !['entregue', 'cancelada'].includes(o.status)) : null;
      if (doSSW && !doSSW.chaveNota) {
        // mesma NF já veio do SSW (CTRC): a nota do SSW fica, com destinatário e endereço do arquivo
        const q = Object.assign({}, doSSW, { chaveNota: n.chave || '', destNome: n.destNome || doSSW.destNome, destDoc: n.destDoc || doSSW.destDoc, emitente: doSSW.emitente || n.emitente, emitenteDoc: n.emitenteDoc || doSSW.emitenteDoc, itens: (n.itens && n.itens.length) ? n.itens : doSSW.itens, atualizadoEm: agoraISO() });
        if (n.origem === 'xml' && n.endereco && n.endereco.lgr) q.endereco = Object.assign({}, doSSW.endereco, n.endereco);
        if (!(doSSW.pesoB > 0) && n.pesoB > 0) q.pesoB = n.pesoB;
        gravar.push({ id: doSSW.id, data: q }); vistos.add(doSSW.id); res.atualizadas++; res.comSSW = (res.comSSW || 0) + 1; continue;
      }
      if (ex) {
        if (ex.origem === 'pdf' && n.origem === 'xml') {
          const keep = {}; for (const k of ['pesoOperador', 'volOperador', 'frete', 'prazo', 'janela', 'diaForcado', 'travaVeiculo', 'status', 'planoData', 'lat', 'lon']) if (ex[k] != null) keep[k] = ex[k];
          gravar.push({ id, data: Object.assign({}, n, keep, { id, importadoEm: ex.importadoEm, atualizadoEm: agoraISO() }) }); res.atualizadas++;
        } else res.duplicadas++;
        continue;
      }
      gravar.push({ id, data: Object.assign({}, n, { id, status: 'pronta', importadoEm: agoraISO(), importadoPor: ST.uid }) }); res.novas++;
    }
    for (const ch of out.cancel) {
      const ex = ST.notas.get(ch);
      if (ex && ex.status !== 'cancelada') { gravar.push({ id: ch, data: Object.assign({}, ex, { status: 'cancelada', canceladaEm: agoraISO(), motivoCancel: 'Evento de cancelamento importado' }) }); res.canceladas++; }
      else if (!ex) res.ign.push('Cancelamento da chave ' + ch + ': nota não está no sistema');
    }
    { const ign = Object.assign({}, ignoradas()); let mud = false; for (const g of gravar) { const kk = nfChave(g.data.numero); if (kk && ign[kk]) { delete ign[kk]; mud = true; } } if (mud) await salvar('ssw', 'ignoradas', { id: 'ignoradas', nfs: ign }); }
    ui.imp.fase = 'Gravando'; ui.imp.aGravar = gravar.length; atualizarProg();
    await salvarVarios('notas', gravar, (k) => { ui.imp.gravados = k; if (k % 10 === 0 || k === gravar.length) atualizarProg(); });
    ui.imp.res = res; ui.imp.fase = 'Concluído';
    await registrar('Importação', res.novas + ' novas, ' + res.atualizadas + ' atualizadas, ' + res.duplicadas + ' duplicadas, ' + res.canceladas + ' canceladas, ' + res.ign.length + ' ignoradas');
    render();
  }
  function atualizarProg() {
    const el = $('#impProg');
    if (!el || !ui.imp) return;
    const i = ui.imp;
    const p = i.aGravar ? i.gravados / i.aGravar : Math.min(1, i.lidos / Math.max(1, i.total));
    el.innerHTML = '<div class="row small"><b>' + esc(i.fase) + '</b><span class="muted">' + (i.aGravar ? i.gravados + ' de ' + i.aGravar + ' notas' : i.lidos + ' de ' + i.total + ' arquivos') + '</span></div><div class="prog"><i style="width:' + Math.round(p * 100) + '%"></i></div>';
  }

  // ---------------- demonstração ----------------
  async function carregarDemo() {
    const d = hoje();
    if (ST.admin) {
      if (!ST.carregado.cfgDoc) await salvar('cfg', 'main', ST.cfg);
      if (!ST.veiculos.size) {
        const vs = [RE.VEICULOS_PADRAO[0], Object.assign({}, RE.VEICULOS_PADRAO[0], { id: 'fiorino-2', nome: 'Fiorino 2' }), RE.VEICULOS_PADRAO[1], RE.VEICULOS_PADRAO[2], Object.assign({}, RE.VEICULOS_PADRAO[2], { id: 'tubos-2', nome: 'Van Tubos 2' })];
        await salvarVarios('veiculos', vs.map((v) => ({ id: v.id, data: Object.assign({}, v, { exemplo: true }) })));
      }
      const cs = DEMO.CIDADES.filter((c) => !ST.cidades.has(c.id));
      await salvarVarios('cidades', cs.map((c) => ({ id: c.id, data: Object.assign({}, c, { exemplo: true }) })));
    }
    const ps = DEMO.PRODUTOS.filter((p) => !ST.produtos.has(p.id));
    await salvarVarios('produtos', ps.map((p) => ({ id: p.id, data: Object.assign({}, p, { exemplo: true }) })));
    const xs = DEMO.notasXML(d);
    const it = [];
    xs.forEach((x, k) => { const n = RE.parseNFeXML(x.xml).nota; const id = n.chave; if (!ST.notas.has(id)) it.push({ id, data: Object.assign(n, { id, status: 'pronta', demo: true, prazo: RE.addDays(d, 2 + (k % 5)), importadoEm: agoraISO(), importadoPor: ST.uid }) }); });
    await salvarVarios('notas', it);
    await registrar('Demonstração', it.length + ' notas de exemplo carregadas');
    toast(it.length + ' notas de demonstração carregadas');
    render();
  }
  async function removerDemo() {
    const ids = [...ST.notas.values()].filter((n) => n.demo).map((n) => n.id);
    for (const id of ids) await remover('notas', id);
    for (const [d, p] of ST.planos) if (p.rotas.some((r) => r.paradas.some((x) => x.notas.some((id) => ids.includes(id))))) await remover('planos', d);
    await registrar('Demonstração', ids.length + ' notas de exemplo removidas');
    toast(ids.length + ' notas de demonstração removidas');
    render();
  }

  // ---------------- planejamento ----------------
  const filtroCidades = () => { const c = (ST.cfg.combos || []).find((x) => x.id === ui.filtroCombo); return c ? c.cidades : null; };
  async function otimizar(modo) {
    const d = ui.data;
    const atual = plano();
    ui.calc = 'Otimizando rotas de ' + dBR(d) + '…'; render();
    await sleep(30);
    try {
      let notas = notasEnr();
      if (modo === 'encaixar' && atual) {
        const trava = new Map();
        for (const r of atual.rotas) for (const p of r.paradas) for (const id of p.notas) trava.set(id, r.veiculoId);
        notas = notas.map((n) => (trava.has(n.id) ? Object.assign({}, n, { travaVeiculo: trava.get(n.id) }) : n));
      }
      const p = RE.planejar(notas, d, ctx(), { consolidar: !!ST.cfg.consolidar, cidades: filtroCidades(), tempoMs: 3500 });
      // motoristas padrão
      { const cv = new Map(ctx().veiculos.map((x) => [x.id, x])); for (const r of p.rotas) { const v = cv.get(r.veiculoId) || veic(r.veiculoId); r.motoristaId = (v && v.motoristaId) || ''; } }
      const semMot = ctx().veiculos.filter((v) => (v.motoristaIndisponivel || v.indispDia) && v.ativo !== false);
      if (semMot.length) p.decisoes = semMot.map((v) => v.nome + ' fora do plano: ' + (v.indispDia ? 'marcado como indisponível no Painel' : 'motorista ' + v.motoristaIndisponivel + ' indisponível') + ' em ' + dBR(d) + '.').concat(p.decisoes || []);
      p.status = 'rascunho'; p.autor = ST.uid; p.versao = ((atual && atual.versao) || 0) + 1;
      if (atual && atual.status === 'aprovado') p.substituiuAprovado = true;
      p.historico = ((atual && atual.historico) || []).concat(atual ? [{ versao: atual.versao || 1, status: atual.status, em: atual.criadoEm, totais: atual.totais }] : []).slice(-10);
      await salvar('planos', d, p);
      if (atual && atual.status === 'aprovado') await sincronizarStatus(p, atual);
      await registrar('Otimização', dBR(d) + ': ' + p.totais.veiculos + ' veículo(s), ' + p.totais.entregas + ' entrega(s), lucro ' + brl(p.totais.lucro) + (modo === 'encaixar' ? ' (rotas anteriores mantidas)' : ''));
      ui.cenarios = null;
    } catch (e) { console.error(e); toast('Falha na otimização: ' + e.message, true); }
    ui.calc = null; ui.escalaSuja = false; render();
  }
  async function compararCenarios() {
    ui.calc = 'Comparando cenários de frota…'; render();
    await sleep(30);
    try {
      const c = RE.cenarios(notasEnr(), ui.data, ctx(), { consolidar: !!ST.cfg.consolidar, cidades: filtroCidades(), tempoMs: 1200 });
      ui.cenarios = { data: ui.data, lista: c };
      const p = plano();
      if (p) await salvar('planos', ui.data, Object.assign({}, p, { cenarios: c }));
    } catch (e) { console.error(e); toast('Falha nos cenários: ' + e.message, true); }
    ui.calc = null; render();
  }
  // grava status das notas conforme o plano aprovado
  async function sincronizarStatus(p, anterior) {
    const ids = new Set();
    for (const r of p.rotas) for (const s of r.paradas) s.notas.forEach((id) => ids.add(id));
    const gravar = [];
    if (p.status === 'aprovado') {
      for (const id of ids) { const n = ST.notas.get(id); if (n && n.status !== 'entregue' && (n.status !== 'roteirizada' || n.planoData !== p.data)) gravar.push({ id, data: Object.assign({}, n, { status: 'roteirizada', planoData: p.data }) }); }
    }
    for (const n of ST.notas.values()) {
      if (n.status === 'roteirizada' && n.planoData === p.data && (!ids.has(n.id) || p.status !== 'aprovado')) gravar.push({ id: n.id, data: Object.assign({}, n, { status: 'pronta', planoData: null }) });
    }
    await salvarVarios('notas', gravar);
  }
  async function editarPlano(mut, alvoVid) {
    const p = clone(plano());
    if (mut(p) === false) return;
    p.rotas = p.rotas.filter((r) => r.paradas.length);
    const rec = RE.recalcularPlano(p, notasEnr(), ctx());
    if (alvoVid) {
      const a = rec.rotas.find((r) => r.veiculoId === alvoVid);
      if (a && !a.cargaOk) { toast('Alteração recusada: ' + a.motivosCarga.join('; '), true); return; }
    }
    rec.editadoManual = true;
    await salvar('planos', ui.data, rec);
    if (rec.status === 'aprovado') await sincronizarStatus(rec);
    render();
  }
  function tirarParada(p, vid, key) {
    if (vid === 'fora') { const i = p.naoRoteirizadas.findIndex((x) => x.key === key); return i < 0 ? null : p.naoRoteirizadas.splice(i, 1)[0]; }
    const r = p.rotas.find((x) => x.veiculoId === vid); if (!r) return null;
    const i = r.paradas.findIndex((x) => x.key === key); return i < 0 ? null : r.paradas.splice(i, 1)[0];
  }
  async function moverParada(de, key, para) {
    if (de === para) return;
    let movida = null;
    await editarPlano((p) => {
      const s = tirarParada(p, de, key);
      if (!s) return false;
      movida = s;
      if (para === 'fora') { p.naoRoteirizadas = (p.naoRoteirizadas || []).concat([{ key, notas: s.notas, dest: s.dest, cidadeNome: s.cidadeNome, obrigatoria: !!s.obrigatoria, atrasada: !!s.atrasada, motivo: 'Retirada manualmente' }]); return; }
      let r = p.rotas.find((x) => x.veiculoId === para);
      if (!r) { const v = veic(para); r = { veiculoId: para, paradas: [], custo: { extras: 0 }, motoristaId: (v && v.motoristaId) || '' }; p.rotas.push(r); }
      s.travada = false;
      r.paradas.push(s);
    }, para === 'fora' ? null : para);
    if (movida) registrar('Edição manual', dBR(ui.data) + ': ' + (movida.dest || key) + ' de ' + (de === 'fora' ? 'sem rota' : (veic(de) || {}).nome) + ' para ' + (para === 'fora' ? 'sem rota' : (veic(para) || {}).nome));
  }
  async function travar(vid, key) {
    const p = plano();
    const r = p.rotas.find((x) => x.veiculoId === vid);
    const s = r && r.paradas.find((x) => x.key === key);
    if (!s) return;
    const nova = !s.travada;
    await salvarVarios('notas', s.notas.map((id) => ST.notas.get(id)).filter(Boolean).map((n) => ({ id: n.id, data: Object.assign({}, n, { travaVeiculo: nova ? vid : null }) })));
    await editarPlano((pp) => { const rr = pp.rotas.find((x) => x.veiculoId === vid); const ss = rr.paradas.find((x) => x.key === key); ss.travada = nova; });
    registrar(nova ? 'Carga travada' : 'Carga destravada', (s.dest || key) + ' em ' + ((veic(vid) || {}).nome || vid));
  }

  // ---------------- mapa ----------------
  function proj(lat0) { const k = Math.cos(lat0 * Math.PI / 180); return (p) => [p.lon * k * 100, -p.lat * 100]; }
  function mapaHTML(plan, foco) {
    const base = ST.cfg.base;
    const pts = [base];
    const rotas = plan ? plan.rotas.filter((r) => !foco || r.veiculoId === foco) : [];
    for (const r of rotas) for (const p of r.paradas) if (p.lat != null) pts.push(p);
    const pend = plan ? (plan.naoRoteirizadas || []) : [];
    if (pts.length === 1) for (const c of ST.cidades.values()) { const m = cidadeCoord(c); if (m.lat != null) pts.push(m); }
    const P = proj(base.lat);
    const xy = pts.map(P);
    let x0 = Math.min(...xy.map((p) => p[0])), x1 = Math.max(...xy.map((p) => p[0])), y0 = Math.min(...xy.map((p) => p[1])), y1 = Math.max(...xy.map((p) => p[1]));
    let w = Math.max(x1 - x0, 20), h = Math.max(y1 - y0, 12);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (w / h > 1.6) h = w / 1.6; else w = h * 1.6;
    w *= 1.35; h *= 1.4;
    const vb = [cx - w / 2, cy - h / 2, w, h];
    // municípios ao fundo
    let dots = '';
    const marg = 1.5;
    for (const m of RE.munList()) {
      const [x, y] = P(m);
      if (x < vb[0] - w * marg || x > vb[0] + w * (1 + marg) || y < vb[1] - h * marg || y > vb[1] + h * (1 + marg)) continue;
      dots += '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="0.5"><title>' + esc(m.nome + '/' + m.uf) + '</title></circle>';
    }
    let linhas = '', marcas = '', rot = '';
    const cidRot = new Map();
    rotas.forEach((r) => {
      const cor = corRota(plan, r.veiculoId);
      const seq = (r.tracado && r.tracado.length > 1 ? r.tracado.map(([lat, lon]) => ({ lat, lon })) : [base].concat(r.paradas.filter((p) => p.lat != null)).concat([base])).map(P);
      linhas += '<polyline points="' + seq.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') + '" fill="none" stroke="' + cor + '" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity=".9"/>';
      r.paradas.forEach((p, i) => {
        if (p.lat == null) return;
        const [x, y] = P(p);
        // paradas na mesma coordenada ficam lado a lado
        const k = x.toFixed(1) + ',' + y.toFixed(1); const n = cidRot.get(k) || 0; cidRot.set(k, n + 1);
        const ang = n * 2.39996, rad = n ? 12 * Math.sqrt(n) : 0, ox = (Math.cos(ang) * rad).toFixed(1), oy = (Math.sin(ang) * rad).toFixed(1);
        marcas += '<g transform="translate(' + x.toFixed(2) + ',' + y.toFixed(2) + ')"><g class="mk" data-off="' + n + '"><circle r="9" cx="' + ox + '" cy="' + oy + '" fill="' + cor + '" stroke="var(--surface)" stroke-width="2"/><text x="' + ox + '" y="' + (+oy + 4).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Barlow Condensed,Arial">' + (i + 1) + '</text><title>' + esc((i + 1) + '. ' + p.dest + ' — ' + p.cidadeNome + (p.chegada ? ' · ' + p.chegada : '') + (p.coordFonte !== 'confirmada' ? ' (posição aproximada: centro da cidade)' : '')) + '</title></g></g>';
        if (!rot.includes('data-c="' + p.cidadeId + '"')) rot += '<g transform="translate(' + x.toFixed(2) + ',' + y.toFixed(2) + ')" data-c="' + esc(p.cidadeId) + '"><g class="mk"><text x="0" y="-15" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)" stroke="var(--map-bg)" stroke-width="3" paint-order="stroke" font-family="Barlow,Arial">' + esc((p.cidadeNome || '').split('/')[0]) + '</text></g></g>';
      });
    });
    if (!rotas.length && pts.length > 1) {
      for (const c of ST.cidades.values()) { const m = cidadeCoord(c); if (m.lat == null) continue; const [x, y] = P(m); rot += '<g transform="translate(' + x.toFixed(2) + ',' + y.toFixed(2) + ')"><g class="mk"><circle r="4" fill="var(--ink-3)"/><text x="0" y="-8" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--ink-2)" stroke="var(--map-bg)" stroke-width="3" paint-order="stroke" font-family="Barlow,Arial">' + esc(c.nome) + '</text></g></g>'; }
    }
    const [bx, by] = P(base);
    const baseMk = '<g transform="translate(' + bx.toFixed(2) + ',' + by.toFixed(2) + ')"><g class="mk"><rect x="-8" y="-8" width="16" height="16" rx="3" fill="var(--accent)" stroke="#1A1300" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="10" font-weight="700" fill="#1A1300" font-family="Barlow Condensed,Arial">B</text><text y="24" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink)" stroke="var(--map-bg)" stroke-width="3" paint-order="stroke" font-family="Barlow,Arial">Base</text><title>Base: ' + esc(base.nome || '') + '</title></g></g>';
    const legenda = rotas.map((r) => '<span><i style="background:' + corRota(plan, r.veiculoId) + '"></i>' + esc(r.veiculoNome) + ' · ' + r.paradas.length + ' parada(s)</span>').join('');
    return '<div class="map" data-map><svg viewBox="' + vb.map((v) => v.toFixed(2)).join(' ') + '" data-vb0="' + vb.join(',') + '" role="img" aria-label="Mapa das rotas"><g fill="var(--map-dot)">' + dots + '</g>' + linhas + rot + marcas + baseMk + '</svg>' +
      '<div class="ctl"><button type="button" data-z="1.4" aria-label="Aproximar">+</button><button type="button" data-z="0.7" aria-label="Afastar">−</button><button type="button" data-z="0" aria-label="Enquadrar">⟲</button></div>' +
      '<div class="tag">' + (plan && plan.rotas && plan.rotas.some((r) => r.tracado) ? 'Traçado pelas estradas' : plan && plan.estimativa ? 'Traçado em linha reta entre paradas · posições sem coordenada confirmada usam o centro da cidade' : 'Pontos: municípios do IBGE') + '</div></div>' +
      (legenda ? '<div class="legend">' + legenda + '</div>' : '');
  }
  function ativarMapas() {
    for (const box of $$('[data-map]')) {
      const svg = $('svg', box);
      const vb0 = svg.dataset.vb0.split(',').map(Number);
      let vb = svg.getAttribute('viewBox').split(' ').map(Number);
      const setVB = () => {
        svg.setAttribute('viewBox', vb.map((v) => v.toFixed(3)).join(' '));
        const s = vb[2] / Math.max(1, svg.clientWidth);
        for (const g of $$('.mk', svg)) g.setAttribute('transform', 'scale(' + s.toFixed(4) + ')');
      };
      setVB();
      const zoom = (f, cx, cy) => {
        if (!f) { vb = vb0.slice(); setVB(); return; }
        if (cx == null) { cx = vb[0] + vb[2] / 2; cy = vb[1] + vb[3] / 2; }
        const nw = vb[2] / f, nh = vb[3] / f;
        vb = [cx - (cx - vb[0]) / f, cy - (cy - vb[1]) / f, nw, nh];
        setVB();
      };
      $$('[data-z]', box).forEach((b) => b.addEventListener('click', () => zoom(+b.dataset.z)));
      svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); const cx = vb[0] + (e.clientX - r.left) / r.width * vb[2], cy = vb[1] + (e.clientY - r.top) / r.height * vb[3]; zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy); }, { passive: false });
      let drag = null;
      svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vb: vb.slice() }; svg.setPointerCapture(e.pointerId); });
      svg.addEventListener('pointermove', (e) => { if (!drag) return; const r = svg.getBoundingClientRect(); vb[0] = drag.vb[0] - (e.clientX - drag.x) / r.width * vb[2]; vb[1] = drag.vb[1] - (e.clientY - drag.y) / r.height * vb[3]; setVB(); });
      svg.addEventListener('pointerup', () => { drag = null; });
      new ResizeObserver(setVB).observe(svg);
    }
  }
  // link do Google Maps (até 9 paradas intermediárias por trecho)
  function linksMaps(r) {
    const b = ST.cfg.base;
    const pt = (p) => (p.coordFonte === 'confirmada' ? p.lat + ',' + p.lon : [p.endereco && p.endereco.lgr, p.endereco && p.endereco.nro, (p.cidadeNome || '').replace('/', ' - '), p.endereco && p.endereco.cep].filter(Boolean).join(', '));
    const seq = r.paradas.map(pt);
    const links = [];
    let cur = b.lat + ',' + b.lon;
    const resto = seq.slice();
    while (resto.length > 9) { const tk = resto.splice(0, 10); links.push(urlMaps(cur, tk[9], tk.slice(0, 9))); cur = tk[9]; }
    links.push(urlMaps(cur, b.lat + ',' + b.lon, resto));
    return links;
  }
  const urlMaps = (o, d, w) => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(o) + '&destination=' + encodeURIComponent(d) + (w.length ? '&waypoints=' + w.map(encodeURIComponent).join('%7C') : '');

  // ---------------- desenho da carga ----------------
  function corParada(r, key) { const i = r.paradas.findIndex((p) => p.key === key); return { i, cor: COR[(i < 0 ? 0 : i) % COR.length] }; }
  function secaoSVG(r) {
    const v = veic(r.veiculoId) || {};
    const sec = RE.secaoVeic(v);
    const W = sec.w, H = sec.h, S = 340 / Math.max(W, H);
    let g = '';
    const desenhar = (c, ox, oy, nivel) => {
      const { cor, i } = corParada(r, c.parada);
      const x = ox + c.x, y = oy + c.y;
      const sx = x * S + 30, sy = (H - y) * S + 14;
      g += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + (c.de / 2 * S).toFixed(1) + '" fill="' + cor + '" fill-opacity="' + (nivel ? 0.55 : 0.3) + '" stroke="' + cor + '" stroke-width="' + (nivel ? 1 : 1.6) + '"><title>' + esc((c.rot || 'Tubo') + ' — Ø ' + c.de + ' mm, ' + c.n + ' barra(s) em sequência, parada ' + (i + 1)) + '</title></circle>';
      if (c.di && c.f.length) g += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + (c.di / 2 * S).toFixed(1) + '" fill="var(--surface)" fill-opacity=".85" stroke="none"/>';
      for (const f of c.f) desenhar(f, x, y, nivel + 1);
    };
    for (const c of r.tubos.colunas) desenhar(c, 0, 0, 0);
    const lw = W * S, lh = H * S;
    return '<svg viewBox="0 0 ' + (lw + 60) + ' ' + (lh + 50) + '" role="img" aria-label="Seção transversal dos tubos"><rect x="30" y="14" width="' + lw + '" height="' + lh + '" fill="var(--surface-2)" stroke="var(--ink-2)" stroke-width="1.5"/>' +
      '<line x1="30" y1="' + (14 + (H - r.tubos.alturaMm) * S).toFixed(1) + '" x2="' + (30 + lw) + '" y2="' + (14 + (H - r.tubos.alturaMm) * S).toFixed(1) + '" stroke="var(--warn)" stroke-dasharray="4 3"/>' +
      '<text x="' + (32 + lw) + '" y="' + (18 + (H - r.tubos.alturaMm) * S).toFixed(1) + '" font-size="10" fill="var(--warn)" font-family="IBM Plex Mono,monospace">' + r.tubos.alturaMm + '</text>' +
      g + '<text x="' + (30 + lw / 2) + '" y="' + (lh + 34) + '" text-anchor="middle" font-size="12" fill="var(--ink-2)" font-family="Barlow,Arial">' + W + ' mm de largura × ' + H + ' mm de altura · comprimento útil ' + nf(sec.compr, 1) + ' m</text></svg>';
  }
  function bauSVG(r) {
    const v = veic(r.veiculoId) || {};
    const L = v.compr || 3, Wd = v.larg || 1.6, A = v.alt || 1.6;
    const S = 620 / L, h = Wd * S;
    const aprov = ST.cfg.aproveitamento || 0.85;
    // ordem de carga: última entrega no fundo (junto à cabine)
    const ordem = r.paradas.map((p, i) => ({ p, i })).reverse();
    let x = 40, zonas = '', momento = 0, massa = 0;
    for (const { p, i } of ordem) {
      const len = Math.min(L, p.m3 / (Wd * A * aprov)) * S;
      if (len > 0.5) {
        const cor = COR[i % COR.length];
        zonas += '<rect x="' + x.toFixed(1) + '" y="20" width="' + len.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + cor + '" fill-opacity=".28" stroke="' + cor + '"/><text x="' + (x + len / 2).toFixed(1) + '" y="' + (20 + h / 2 + 5).toFixed(1) + '" text-anchor="middle" font-size="15" font-weight="700" fill="' + cor + '" font-family="Barlow Condensed,Arial">' + (len > 18 ? (i + 1) : '') + '</text><title>Parada ' + (i + 1) + ': ' + esc(p.dest) + ' — ' + nf(p.m3, 2) + ' m³</title>';
      }
      const pesoSolto = Math.max(0, p.kg - 0);
      momento += pesoSolto * ((x - 40) + len / 2) / S; massa += pesoSolto;
      x += len;
    }
    let rack = '';
    if (r.tubos && r.tubos.kg) { const lt = Math.min(r.tubos.comprM, L); momento += r.tubos.kg * lt / 2; massa += r.tubos.kg; }
    if (r.tubos && r.tubos.colunas.length) {
      const sec = RE.secaoVeic(v);
      const rl = Math.min(r.tubos.comprM, L) * S, rw = Math.min(sec.w / 1000, Wd) * S;
      rack = '<rect x="40" y="' + (20 + h - rw).toFixed(1) + '" width="' + rl.toFixed(1) + '" height="' + rw.toFixed(1) + '" fill="none" stroke="var(--ink)" stroke-dasharray="6 4" stroke-width="1.5"/><text x="46" y="' + (20 + h - 6).toFixed(1) + '" font-size="11" fill="var(--ink-2)" font-family="Barlow,Arial">tubos: ' + nf(r.tubos.comprM, 1) + ' m' + (r.tubos.comprM > L ? ' (' + nf(r.tubos.comprM - L, 1) + ' m além do baú, no porta-tubos)' : '') + '</text>';
    }
    const cg = massa ? momento / massa : L / 2;
    const cgx = 40 + cg * S;
    const svg = '<svg viewBox="0 0 720 ' + (h + 70).toFixed(0) + '" role="img" aria-label="Vista de cima do baú"><rect x="40" y="20" width="' + (L * S).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="var(--surface-2)" stroke="var(--ink-2)" stroke-width="1.5"/>' + zonas + rack +
      '<rect x="6" y="' + (20 + h * 0.15).toFixed(1) + '" width="30" height="' + (h * 0.7).toFixed(1) + '" rx="6" fill="var(--sunk)" stroke="var(--ink-3)"/><text x="21" y="' + (20 + h / 2).toFixed(1) + '" font-size="10" text-anchor="middle" fill="var(--ink-2)" transform="rotate(-90 21 ' + (20 + h / 2).toFixed(1) + ')" font-family="Barlow,Arial">CABINE</text>' +
      '<text x="' + (44 + L * S) + '" y="' + (24 + h / 2) + '" font-size="10" fill="var(--ink-2)" transform="rotate(90 ' + (44 + L * S) + ' ' + (24 + h / 2) + ')" text-anchor="middle" font-family="Barlow,Arial">PORTA</text>' +
      '<line x1="' + cgx.toFixed(1) + '" y1="14" x2="' + cgx.toFixed(1) + '" y2="' + (26 + h).toFixed(1) + '" stroke="var(--bad)" stroke-width="2"/><text x="' + cgx.toFixed(1) + '" y="' + (44 + h).toFixed(1) + '" text-anchor="' + (cg / L < 0.3 ? 'start' : cg / L > 0.7 ? 'end' : 'middle') + '" font-size="11.5" fill="var(--bad)" font-family="Barlow,Arial">centro de massa da carga: ' + Math.round(cg / L * 100) + '% a partir da cabine</text>' +
      '<text x="40" y="' + (62 + h).toFixed(1) + '" font-size="11" fill="var(--ink-3)" font-family="Barlow,Arial">' + nf(L, 2) + ' m × ' + nf(Wd, 2) + ' m × ' + nf(A, 2) + ' m · faixas proporcionais ao volume de cada parada</text></svg>';
    return { svg, cgPct: cg / L };
  }

  // ---------------- relatórios ----------------
  const RELS = [
    ['romaneio', 'Romaneio de carregamento'], ['manifesto', 'Manifesto operacional'], ['entregas', 'Entregas por veículo'], ['ocupacao', 'Ocupação dos veículos'],
    ['tubos', 'Tubos encaixados'], ['lucro', 'Lucratividade'], ['cenarios', 'Comparação de cenários'], ['fora', 'Notas não roteirizadas'], ['mapa', 'Sequência das entregas (mapa)'], ['cidades', 'Resumo por cidade e região'], ['sobras', 'Notas que ficaram'],
  ];
  function relatorio(tipo, p) {
    const nomeMot = (id) => (ST.motoristas.get(id) || {}).nome || '';
    const N = (id) => ST.notas.get(id) || {};
    const T = { titulo: RELS.find((x) => x[0] === tipo)[1], sub: 'Plano de ' + dBR(p.data) + ' · ' + (p.status === 'aprovado' ? 'aprovado' : 'rascunho') + (p.estimativa ? ' · distâncias e horários estimados' : ''), secoes: [] };
    const col = (t, k, num) => ({ t, k, num });
    if (tipo === 'romaneio') {
      for (const r of p.rotas) {
        const linhas = [];
        r.paradas.slice().reverse().forEach((s, j) => {
          const i = r.paradas.length - j;
          for (const id of s.notas) { const n = N(id); linhas.push({ ord: j + 1, parada: i, dest: s.dest, cidade: s.cidadeNome, nf: (n.numero || '') + '/' + (n.serie || ''), itens: (n.itens || []).map((x) => x.qtd + ' ' + (x.un || '') + ' ' + x.desc).join('; '), kg: n.pesoOperador != null ? n.pesoOperador : n.pesoB, vol: n.qVol || '' }); }
        });
        T.secoes.push({ titulo: r.veiculoNome + (r.placa ? ' · ' + r.placa : '') + (nomeMot(r.motoristaId) ? ' · ' + nomeMot(r.motoristaId) : ''), nota: 'Carregar na ordem abaixo: a última entrega vai primeiro, junto à cabine. ' + (r.tubos ? r.tubos.total + ' tubos, ' + r.tubos.encaixados + ' encaixados em ' + r.tubos.conjuntos + ' conjunto(s).' : ''), colunas: [col('Ordem', 'ord', 1), col('Parada', 'parada', 1), col('Destinatário', 'dest'), col('Cidade', 'cidade'), col('NF/Série', 'nf'), col('Mercadorias', 'itens'), col('Peso kg', 'kg', 1), col('Volumes', 'vol', 1)], linhas, rodape: 'Peso total ' + nf(r.kg, 0) + ' kg · ' + nf(r.m3, 2) + ' m³ ocupados' });
      }
    } else if (tipo === 'manifesto') {
      const linhas = [];
      for (const r of p.rotas) for (const s of r.paradas) for (const id of s.notas) { const n = N(id); linhas.push({ veic: r.veiculoNome, placa: r.placa, chave: n.chave || '', nf: (n.numero || '') + '/' + (n.serie || ''), emit: n.emitente || '', dest: s.dest, cidade: s.cidadeNome, valor: n.valorMerc, kg: n.pesoOperador != null ? n.pesoOperador : n.pesoB }); }
      T.secoes.push({ colunas: [col('Veículo', 'veic'), col('Placa', 'placa'), col('Chave de acesso', 'chave'), col('NF/Série', 'nf'), col('Emitente', 'emit'), col('Destinatário', 'dest'), col('Cidade', 'cidade'), col('Valor R$', 'valor', 2), col('Peso kg', 'kg', 1)], linhas, rodape: linhas.length + ' notas · valor ' + brl(linhas.reduce((s, x) => s + (x.valor || 0), 0)) });
    } else if (tipo === 'entregas') {
      for (const r of p.rotas) {
        T.secoes.push({ titulo: r.veiculoNome + ' · saída ' + ((veic(r.veiculoId) || {}).saida || ST.cfg.inicioJornada) + ' · retorno ' + r.retorno, colunas: [col('#', 'i', 1), col('Chegada', 'ch'), col('Destinatário', 'dest'), col('Endereço', 'end'), col('Cidade', 'cid'), col('NFs', 'nfs'), col('Peso kg', 'kg', 1), col('Tubos', 'tb', 1)], linhas: r.paradas.map((s, i) => ({ i: i + 1, ch: s.chegada, dest: s.dest, end: [s.endereco && s.endereco.lgr, s.endereco && s.endereco.nro, s.endereco && s.endereco.bairro].filter(Boolean).join(', '), cid: s.cidadeNome, nfs: nfsTxt(s.notas), kg: s.kg, tb: s.qtdTubos })), rodape: nf(r.km, 1) + ' km · ' + nf(r.horas, 1) + ' h' });
      }
    } else if (tipo === 'ocupacao') {
      T.secoes.push({ colunas: [col('Veículo', 'v'), col('Tipo', 't'), col('Peso kg', 'kg', 1), col('Capacidade kg', 'cap', 1), col('Ocupação peso %', 'op', 1), col('Volume m³', 'm3', 2), col('Capacidade m³', 'cm3', 2), col('Ocupação volume %', 'ov', 1), col('Tubos', 'tb', 1), col('Seção de tubos %', 'st', 1)], linhas: p.rotas.map((r) => { const v = veic(r.veiculoId) || {}; return { v: r.veiculoNome, t: TIPO[r.veiculoTipo], kg: r.kg, cap: v.capKg, op: r.ocupPeso * 100, m3: r.m3, cm3: v.capM3, ov: r.ocupVol * 100, tb: r.tubos ? r.tubos.total : 0, st: r.tubos ? r.tubos.ocupSecao * 100 : null }; }) });
    } else if (tipo === 'tubos') {
      for (const r of p.rotas) {
        if (!r.tubos) continue;
        const linhas = [];
        const walk = (c, nivel, host) => { const { i } = corParada(r, c.parada); linhas.push({ niv: nivel, desc: (c.rot || '') , de: c.de, di: c.di || '', n: c.n, compr: c.compr, kg: c.kg, parada: i + 1, dentro: host || '—' }); for (const f of c.f) walk(f, nivel + 1, 'Ø' + c.de + ' (' + (c.rot || '').slice(0, 30) + ')'); };
        r.tubos.colunas.forEach((c) => walk(c, 0, null));
        T.secoes.push({ titulo: r.veiculoNome + ' · ' + r.tubos.total + ' tubos, ' + r.tubos.encaixados + ' encaixados, ' + r.tubos.conjuntos + ' conjunto(s)', colunas: [col('Nível', 'niv', 1), col('Tubo', 'desc'), col('Ø ext mm', 'de', 1), col('Ø int mm', 'di', 1), col('Barras', 'n', 1), col('Compr. m', 'compr', 2), col('Peso kg', 'kg', 1), col('Parada', 'parada', 1), col('Dentro de', 'dentro')], linhas, rodape: 'Seção ocupada ' + pct(r.tubos.ocupSecao) + ' · altura ' + r.tubos.alturaMm + ' mm · comprimento ' + nf(r.tubos.comprM, 1) + ' m' });
      }
      if (!T.secoes.length) T.secoes.push({ colunas: [col('Situação', 's')], linhas: [{ s: 'Nenhum tubo neste plano' }] });
    } else if (tipo === 'lucro') {
      T.secoes.push({ colunas: [col('Veículo', 'v'), col('Entregas', 'e', 1), col('Km', 'km', 1), col('Receita', 'rec', 2), col('Veículo', 'cv', 2), col('Motorista', 'cm', 2), col('Ajudante', 'ca', 2), col('Combustível', 'cc', 2), col('Pedágio', 'cp', 2), col('Manutenção', 'cmn', 2), col('Extras', 'ce', 2), col('Custo total', 'ct', 2), col('Lucro', 'l', 2), col('Margem %', 'm', 1), col('Custo/entrega', 'cpe', 2), col('Custo/km', 'cpk', 2)], linhas: p.rotas.map((r) => ({ v: r.veiculoNome, e: r.paradas.length, km: r.km, rec: r.receita, cv: r.custo.veiculo, cm: r.custo.motorista, ca: r.custo.ajudante, cc: r.custo.combustivel, cp: r.custo.pedagio, cmn: r.custo.manutencao, ce: r.custo.extras, ct: r.custo.total, l: r.lucro, m: r.margem, cpe: r.custoPorEntrega, cpk: r.custoPorKm })), rodape: 'Lucro consolidado do dia ' + brl(p.totais.lucro) + (p.totais.margem != null ? ' · margem ' + nf(p.totais.margem, 1) + '%' : '') });
    } else if (tipo === 'cenarios') {
      const c = p.cenarios || (ui.cenarios && ui.cenarios.data === p.data ? ui.cenarios.lista : null);
      if (!c) T.secoes.push({ colunas: [col('Situação', 's')], linhas: [{ s: 'Use “Comparar cenários” na tela Rotas para gerar esta comparação.' }] });
      else T.secoes.push({ nota: c[0] && c[0].porque ? 'Melhor: ' + c[0].nome + '. ' + c[0].porque : '', colunas: [col('Cenário', 'nome'), col('Veículos', 'veiculos', 1), col('Entregas', 'entregas', 1), col('Sem rota', 'foraTotal', 1), col('Obrigatórias sem rota', 'obrigFora', 1), col('Km', 'km', 1), col('Receita', 'receita', 2), col('Custo', 'custo', 2), col('Lucro', 'lucro', 2), col('Margem %', 'margem', 1)], linhas: c });
    } else if (tipo === 'fora') {
      T.secoes.push({ colunas: [col('Destinatário', 'dest'), col('Cidade', 'cid'), col('NFs', 'nfs'), col('Obrigatória', 'ob'), col('Motivo', 'mot')], linhas: (p.naoRoteirizadas || []).map((u) => ({ dest: u.dest, cid: u.cidadeNome, nfs: nfsTxt(u.notas), ob: u.atrasada ? 'Atrasada' : u.obrigatoria ? 'Sim' : 'Não', mot: u.motivo })) });
      const pend = notasEnr().filter((n) => n.bloqueada && !['entregue', 'cancelada'].includes(n.status));
      if (pend.length) T.secoes.push({ titulo: 'Notas com dados pendentes', colunas: [col('NF', 'nf'), col('Destinatário', 'dest'), col('Cidade', 'cid'), col('Pendência', 'p')], linhas: pend.map((n) => ({ nf: n.numero, dest: n.destNome, cid: n.cidadeNome, p: n.pendencias.map((x) => x.msg).join('; ') })) });
    } else if (tipo === 'mapa') {
      for (const r of p.rotas) T.secoes.push({ titulo: r.veiculoNome, nota: linksMaps(r).join('  '), colunas: [col('#', 'i', 1), col('Destinatário', 'dest'), col('Cidade', 'cid'), col('Latitude', 'lat', 4), col('Longitude', 'lon', 4), col('Posição', 'f')], linhas: r.paradas.map((s, i) => ({ i: i + 1, dest: s.dest, cid: s.cidadeNome, lat: s.lat, lon: s.lon, f: s.coordFonte })) });
    } else if (tipo === 'sobras') {
      const l = [...ST.sobras.values()].filter((s) => s.data === p.data);
      const lim = RE.addDays(p.data, -1);
      const cols = [col('Qtd', 'q', 1), col('Cidade', 'cidade'), col('Carga', 'carga'), col('Data que chegou', 'ch'), col('NF', 'numero'), col('Observações', 'mo'), col('Prioridade', 'r')];
      for (const [tit, f] of [['Notas que ficaram hoje', (s) => !(s.chegou && s.chegou < lim)], ['Notas há mais de um dia no galpão', (s) => s.chegou && s.chegou < lim]]) {
        const g = new Map(); for (const s of l.filter(f)) { const k = s.embarcador || 'Sem embarcador'; if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
        for (const [emb, ls] of [...g].sort((a, b) => a[0].localeCompare(b[0]))) T.secoes.push({ titulo: tit + ' · ' + emb, colunas: cols, linhas: ls.map((s) => ({ q: 1, cidade: (s.cidade || '').split('/')[0].toUpperCase(), carga: s.carga, ch: s.chegou ? dBR(s.chegou) : '', numero: s.numero, mo: (s.motivo || '').toUpperCase() + (s.obs ? ' – ' + s.obs : ''), r: s.reenvio ? 'Sim' : 'Não' })) });
      }
      if (!T.secoes.length) T.secoes.push({ colunas: [col('Situação', 's')], linhas: [{ s: 'Nenhuma nota lançada nesta data' }] });
    } else if (tipo === 'cidades') {
      const m = new Map();
      for (const r of p.rotas) for (const s of r.paradas) {
        const c = ST.cidades.get(s.cidadeId) || {};
        const k = s.cidadeNome;
        const o = m.get(k) || { cid: k, reg: c.regiao || '', ent: 0, nfs: 0, kg: 0, rec: 0, veics: new Set() };
        o.ent++; o.nfs += s.notas.length; o.kg += s.kg; o.rec += s.receita; o.veics.add(r.veiculoNome); m.set(k, o);
      }
      T.secoes.push({ colunas: [col('Cidade', 'cid'), col('Região', 'reg'), col('Entregas', 'ent', 1), col('Notas', 'nfs', 1), col('Peso kg', 'kg', 1), col('Receita', 'rec', 2), col('Veículos', 'v')], linhas: [...m.values()].sort((a, b) => (a.reg || '').localeCompare(b.reg || '') || a.cid.localeCompare(b.cid)).map((o) => Object.assign(o, { v: [...o.veics].join(', ') })) });
    }
    return T;
  }
  const fmtCel = (v, num) => (v == null || v === '' ? '' : num ? nf(+v, num === 1 ? (Number.isInteger(+v) ? 0 : 1) : num) : String(v));
  function relHTML(T) {
    return '<h2>' + esc(T.titulo) + '</h2><p class="muted small">' + esc(T.sub) + '</p>' + T.secoes.map((s) => '<div class="stack" style="margin-top:14px">' + (s.titulo ? '<h3>' + esc(s.titulo) + '</h3>' : '') + (s.nota ? '<p class="small muted" style="overflow-wrap:anywhere">' + esc(s.nota) + '</p>' : '') +
      '<div class="tbl-wrap"><table><thead><tr>' + s.colunas.map((c) => '<th' + (c.num ? ' class="r"' : '') + '>' + esc(c.t) + '</th>').join('') + '</tr></thead><tbody>' +
      (s.linhas.length ? s.linhas.map((l) => '<tr>' + s.colunas.map((c) => '<td' + (c.num ? ' class="r num"' : '') + '>' + esc(fmtCel(l[c.k], c.num)) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + s.colunas.length + '" class="muted">Sem linhas</td></tr>') +
      '</tbody></table></div>' + (s.rodape ? '<p class="small"><b>' + esc(s.rodape) + '</b></p>' : '') + '</div>').join('');
  }
  async function baixar(nome, data) {
    let d = null;
    try { d = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { d = null; }
    if (!d) { toast('O download não está disponível nesta visualização do aplicativo.', true); return; }
    try { await d.save({ filename: nome, data }); toast('Arquivo pronto: ' + nome); }
    catch (e) { if (e && e.code === 'declined') return; toast('Não foi possível gerar o arquivo: ' + ((e && e.message) || e), true); }
  }
  async function exportarExcel(p) {
    let X;
    try { X = await lib('xlsx'); } catch (e) { toast(e.message, true); return; }
    const wb = X.utils.book_new();
    for (const [k, nome] of RELS) {
      const T = relatorio(k, p);
      const aoa = [[T.titulo], [T.sub], []];
      for (const s of T.secoes) {
        if (s.titulo) aoa.push([s.titulo]);
        if (s.nota) aoa.push([s.nota]);
        aoa.push(s.colunas.map((c) => c.t));
        for (const l of s.linhas) aoa.push(s.colunas.map((c) => (l[c.k] == null ? '' : c.num && !isNaN(+l[c.k]) ? +(+l[c.k]).toFixed(c.num === 1 ? 2 : c.num) : l[c.k])));
        if (s.rodape) aoa.push([s.rodape]);
        aoa.push([]);
      }
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = (T.secoes[0] ? T.secoes[0].colunas : []).map((c) => ({ wch: Math.max(10, Math.min(48, c.t.length + 6)) }));
      X.utils.book_append_sheet(wb, ws, nome.slice(0, 31));
    }
    const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
    await baixar('roteirizacao-' + p.data + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  async function exportarPDF(p, tipo) {
    let J;
    try { J = await lib('jspdf'); } catch (e) { toast(e.message, true); return; }
    const T = relatorio(tipo, p);
    const doc = new J.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297, M = 10;
    let y = M;
    const novaPag = () => { doc.addPage(); y = M; };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(T.titulo, M, y + 5); y += 9;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(T.sub, M, y); doc.setTextColor(0); y += 6;
    for (const s of T.secoes) {
      if (y > 180) novaPag();
      if (s.titulo) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(s.titulo, M, y + 3); y += 6; }
      if (s.nota) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); const ls = doc.splitTextToSize(s.nota, W - 2 * M); doc.text(ls, M, y + 2); y += ls.length * 3.5 + 1; }
      const cols = s.colunas;
      const pesos = cols.map((c) => Math.max(c.t.length, ...s.linhas.slice(0, 60).map((l) => Math.min(60, fmtCel(l[c.k], c.num).length))) + 2);
      const tot = pesos.reduce((a, b) => a + b, 0);
      const ws = pesos.map((x) => (W - 2 * M) * x / tot);
      const cab = () => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setFillColor(232, 236, 240); doc.rect(M, y, W - 2 * M, 6, 'F'); let x = M; cols.forEach((c, i) => { doc.text(doc.splitTextToSize(c.t, ws[i] - 2)[0], c.num ? x + ws[i] - 1 : x + 1, y + 4, { align: c.num ? 'right' : 'left' }); x += ws[i]; }); y += 6; doc.setFont('helvetica', 'normal'); };
      cab();
      for (const l of s.linhas) {
        const cel = cols.map((c, i) => doc.splitTextToSize(fmtCel(l[c.k], c.num), ws[i] - 2));
        const hh = Math.max(...cel.map((x) => x.length)) * 3.2 + 2;
        if (y + hh > 200) { novaPag(); cab(); }
        let x = M;
        cols.forEach((c, i) => { doc.text(cel[i], c.num ? x + ws[i] - 1 : x + 1, y + 3.4, { align: c.num ? 'right' : 'left' }); x += ws[i]; });
        y += hh; doc.setDrawColor(220); doc.line(M, y, W - M, y);
      }
      if (s.rodape) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(s.rodape, M, y + 4); y += 6; }
      y += 4;
    }
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text('Roteirizador Inteligente de Cargas · página ' + i + ' de ' + n, W - M, 205, { align: 'right' }); }
    await baixar(tipo + '-' + p.data + '.pdf', doc.output('blob'));
  }
  function textoWhats(r, p) {
    const v = veic(r.veiculoId) || {};
    const linhas = ['*Rota ' + dBR(p.data) + ' – ' + r.veiculoNome + (r.placa ? ' (' + r.placa + ')' : '') + '*', 'Saída ' + (v.saida || ST.cfg.inicioJornada) + ' · ' + nf(r.km, 0) + ' km · retorno previsto ' + r.retorno, ''];
    r.paradas.forEach((s, i) => linhas.push((i + 1) + '. ' + s.chegada + ' – ' + s.dest + ' – ' + [s.endereco && s.endereco.lgr, s.endereco && s.endereco.nro].filter(Boolean).join(', ') + ' – ' + s.cidadeNome + ' (NF ' + nfsTxt(s.notas) + ')'));
    linhas.push('', 'Carregar a última entrega primeiro (junto à cabine).');
    linhas.push(...linksMaps(r).map((u, i, a) => 'Mapa' + (a.length > 1 ? ' ' + (i + 1) : '') + ': ' + u));
    return linhas.join('\n');
  }
  const linkWhats = (r, p) => { const m = ST.motoristas.get(r.motoristaId); const tel = m && m.telefone ? m.telefone.replace(/\D/g, '') : ''; return 'https://wa.me/' + (tel ? (tel.length <= 11 ? '55' + tel : tel) : '') + '?text=' + encodeURIComponent(textoWhats(r, p)); };

  // ---------------- telas ----------------
  const NAV = [['painel', 'Painel', I.painel], ['notas', 'Notas', I.notas], ['sobras', 'Sobras', I.sobra], ['rotas', 'Rotas', I.rotas], ['rom', 'Romaneios', I.rotas], ['carga', 'Carga', I.carga], ['rel', 'Relatórios', I.rel], ['cad', 'Cadastros', I.cad], ['cfg', 'Ajustes', I.cfg]];
  function shell() {
    const app = $('#app');
    if (!$('#main')) {
      app.innerHTML = '<div class="app"><aside class="rail"><div class="brand"><svg class="brand-mark" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="7" fill="#F2B300"/><path d="M7 26c4-7 7-3 10-9s6-2 10-9" fill="none" stroke="#1A1300" stroke-width="3" stroke-linecap="round"/><circle cx="7" cy="26" r="2.6" fill="#1A1300"/><circle cx="27" cy="8" r="2.6" fill="#1A1300"/></svg><div><b>Roteirizador</b><small>Cargas e tubos</small></div></div><nav class="nav" id="nav" aria-label="Seções"></nav><div class="rail-foot" id="railFoot"></div></aside><main id="main" tabindex="-1"></main></div>';
      document.body.insertAdjacentHTML('beforeend', '<datalist id="dlMun"></datalist>');
    }
    const pendentes = notasEnr().filter((n) => n.bloqueada && !['entregue', 'cancelada'].includes(n.status)).length;
    $('#nav').innerHTML = NAV.filter(([k]) => k !== 'rom' || window.RC_HOST).map(([k, t, ic]) => '<button type="button" data-tab="' + k + '"' + (ui.tab === k ? ' aria-current="page"' : '') + '>' + ic + '<span>' + t + '</span>' + (k === 'notas' && pendentes ? '<span class="cnt">' + pendentes + '</span>' : '') + (k === 'sobras' && nPrior() ? '<span class="cnt">' + nPrior() + '</span>' : '') + '</button>').join('');
    $('#railFoot').innerHTML = '<div><span class="dot' + (DB.local ? ' local' : '') + '"></span>' + (DB.local ? 'Modo local: dados só neste navegador' : 'Banco de dados conectado') + '</div><div>Perfil: <b>' + (ST.admin ? 'Administrador' : 'Operador') + '</b></div>' + (window.RC_HOST ? '<button class="btn sm" id="rcAtualizar" data-a="atualizarSistema" style="margin-top:8px;width:100%;justify-content:center;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35)">' + (window.RC_HOST.novaVersao ? '🔄 Nova versão — atualizar' : '🔄 Atualizar sistema') + '</button>' : '');
  }
  const nPrior = () => [...ST.notas.values()].filter((n) => n.prioridade && !['entregue', 'cancelada'].includes(n.status)).length;
  function topo(titulo, sub, comData) {
    const wd = ui.data ? DIAS[RE.weekday(ui.data)] : '';
    return '<div class="top"><div><h1>' + esc(titulo) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (comData ? '<label class="datebox" for="fData"><span class="dow">' + wd + '</span><input type="date" id="fData" value="' + ui.data + '" aria-label="Data do planejamento"></label>' : '') + '</div>';
  }
  function kpi(l, v, cls, small) { return '<div class="kpi ' + (cls || '') + '"><div class="l">' + l + '</div><div class="v">' + v + (small ? ' <small>' + small + '</small>' : '') + '</div></div>'; }

  function vPainel() {
    const p = plano();
    const enr = notasEnr();
    const ativas = enr.filter((n) => !['entregue', 'cancelada'].includes(n.status));
    const pend = ativas.filter((n) => n.bloqueada);
    const { notas: eleg } = RE.elegiveis(enr, ui.data, ctx());
    let h = topo('Painel do dia', p ? 'Plano ' + (p.status === 'aprovado' ? '<span class="chip ok">aprovado</span>' : '<span class="chip warn">rascunho</span>') + ' calculado em ' + new Date(p.editadoEm || p.criadoEm).toLocaleString('pt-BR') : eleg.length + ' nota(s) liberadas para ' + dBR(ui.data) + ' · ainda sem plano', true);
    h += vEscala();
    if (!ST.notas.size) return h;
    const t = p ? p.totais : null;
    const pesoEleg = eleg.reduce((s, n) => s + (n.pesoKg || 0), 0), volEleg = eleg.reduce((s, n) => s + (n.volOutrosM3 || 0) + (n.volTubosM3 || 0), 0), tubEleg = eleg.reduce((s, n) => s + n.qtdTubos, 0);
    const volPlano = p ? p.rotas.reduce((s, r) => s + r.m3, 0) : null;
    h += '<div class="kpis">' +
      kpi('Notas ativas', ativas.length) + kpi('Entregas no plano', t ? t.entregas : '—', '', t ? t.notas + ' NF' : '') +
      kpi('Peso', nf(t ? t.kg : pesoEleg, 0), '', 'kg') + kpi('Volume', nf(p ? volPlano : volEleg, 1), '', 'm³') +
      kpi('Tubos', t ? t.tubos : tubEleg) + kpi('Veículos', t ? t.veiculos : '—', '', p ? 'de ' + p.veiculosDisponiveis : '') +
      kpi('Receita', t ? brl(t.receita) : '—') + kpi('Custo', t ? brl(t.custo) : '—') +
      kpi('Lucro', t ? brl(t.lucro) : '—', t ? (t.lucro >= 0 ? 'good' : 'bad') : '') + kpi('Margem', t && t.margem != null ? nf(t.margem, 1) + '%' : '—', t && t.margem != null ? (t.margem >= 0 ? 'good' : 'bad') : '') +
      kpi('Sem rota', p ? p.naoRoteirizadas.length : '—', p && p.naoRoteirizadas.some((u) => u.obrigatoria) ? 'bad' : '') + kpi('Dados pendentes', pend.length, pend.length ? 'warn' : '') +
      '</div>';
    const al = RE.alertasPrazo(enr, ui.data, ctx());
    h += '<div class="split" style="margin-top:14px"><div class="card"><div class="card-h"><h2>Rotas de ' + dBR(ui.data) + '</h2><div class="row">' + (p ? '' : '<button class="btn go" data-a="otimizar">' + I.play + 'Otimizar agora</button>') + '<button class="btn" data-a="tab" data-v="rotas">Abrir rotas</button></div></div>' + mapaHTML(p, null) + '</div>' +
      '<div class="stack"><div class="card"><div class="card-h"><h2>Alertas de prazo</h2><span class="chip ' + (al.length ? 'bad' : 'ok') + '">' + al.length + '</span></div>' +
      (al.length ? '<div class="tbl-wrap"><table><tbody>' + al.slice(0, 10).map((a) => '<tr class="click" data-a="nota" data-v="' + esc(a.nota.id) + '"><td><b>NF ' + esc(a.nota.numero) + '</b><div class="tiny">' + esc(a.nota.destNome) + ' · ' + esc(a.nota.cidadeNome) + '</div></td><td class="small">' + esc(a.msg) + '</td></tr>').join('') + '</tbody></table></div>' + (al.length > 10 ? '<p class="tiny">+ ' + (al.length - 10) + ' alertas</p>' : '') : '<p class="muted small">Todas as notas têm dia de rota disponível dentro do prazo.</p>') + '</div>' +
      (p ? '<div class="card"><h2>Veículos</h2><div class="stack" style="margin-top:10px">' + p.rotas.map((r) => '<div class="row small"><i style="width:10px;height:10px;border-radius:2px;background:' + corRota(p, r.veiculoId) + '"></i><b>' + esc(r.veiculoNome) + '</b><span class="muted">' + r.paradas.length + ' parada(s) · ' + nf(r.km, 0) + ' km</span><span class="spacer"></span><span class="num ' + (r.lucro >= 0 ? 'pos' : 'neg') + '">' + brl(r.lucro) + '</span></div>').join('') + '</div></div>' : '') +
      '</div></div>';
    return h;
  }
  // Escala do dia: marcar motoristas -> ideia de rota de cada um (recalcula sozinho)
  function vEscala() {
    const d = ui.data, dd = dispDia(d);
    if (window.RC_HOST && ST.admin && !ui.frotaAuto) { ui.frotaAuto = true; setTimeout(() => importarFrota(), 50); }
    if (window.RC_HOST && !ui.sswSync) { ui.sswSync = true; setTimeout(() => sincronizarSSW(), 80); }
    if (!ui.juntAuto) { ui.juntAuto = true; setTimeout(() => juntarDuplicadasSSW().catch((e) => console.warn('juntar', e.message)), 2500); }
    if (!ui.sbNotasAuto) { ui.sbNotasAuto = true; setTimeout(() => notasDasSobras().catch((e) => console.warn('sobras→notas', e.message)), 1500); setInterval(() => notasDasSobras().catch(() => {}), 3 * 60000); }
    if (window.RC_HOST && !ui.geoAuto) { ui.geoAuto = true; setTimeout(() => localizarEnderecosXML(), 4000); setInterval(() => { if (document.visibilityState !== 'hidden') localizarEnderecosXML(); }, 10 * 60000); }
    const todos = motoristasUnicos();
    const q = RE.norm(ui.motQ || '');
    const lista = (q ? todos.filter((m) => RE.norm(m.nome).includes(q)) : todos.filter((m) => motRecente(m, d) || dd.motoristas[m.id] === true))
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    const pl = plano();
    const nm = todos.filter((m) => motDisp(m, d)).length;
    const nNotas = RE.elegiveis(notasEnr(), d, ctx()).notas.length;
    // recalcular sozinho quando muda a escala (plano aprovado só com clique)
    if (nNotas && nm && !ui.calc && (!pl || ui.escalaSuja) && !(pl && pl.status === 'aprovado') && ui.autoEm !== VER) { ui.autoEm = VER; setTimeout(() => { if (!ui.calc) otimizar(); }, 400); }
    const rotaDe = new Map(pl ? pl.rotas.filter((r) => r.motoristaId).map((r) => [r.motoristaId, r]) : []);
    const marca = (m) => '<label class="dsp"><input type="checkbox" data-disp="m|' + esc(m.id) + '"' + (motDisp(m, d) ? ' checked' : '') + '><span><b>' + esc(m.nome) + '</b><small>' + (m.ultimoUso ? 'rodou em ' + dBR(m.ultimoUso) : 'sem registro recente') + '</small></span></label>';
    let h = '<div class="card escala"><div class="card-h"><h2>Escala de ' + dBR(d) + '</h2><span class="small muted">' + (ui.sswLendo ? 'buscando CTRCs no SSW… · ' : '') + (ui.geo ? 'lendo endereços no XML do CT-e: ' + ui.geo.feitos + ' de ' + ui.geo.total + ' · ' : '') + nNotas + ' nota(s) para este dia · ' + nm + ' motorista(s) marcado(s)</span>' + (nNotas && nm ? '<button class="btn sm go" data-a="otimizar"' + (ui.calc ? ' disabled' : '') + '>' + I.play + (pl ? 'Otimizar de novo' : 'Otimizar') + '</button>' : '') + '</div>';
    h += '<div class="escala-cols"><div><p class="small" style="margin:0 0 8px"><b>1. Quem trabalha hoje?</b></p>' +
      '<input id="fMotQ" class="dsp-q" placeholder="Procurar motorista mais antigo" value="' + esc(ui.motQ || '') + '">' +
      (lista.length ? '<div class="dsp-list">' + lista.map(marca).join('') + '</div>' : '<p class="muted small">' + (q ? 'Nenhum motorista com esse nome.' : ui.frotaImp && ui.frotaImp.carregando ? 'Lendo o Rastreio de carga…' : 'Nenhum motorista rodou nos últimos 30 dias.') + '</p>') + '</div>';
    h += '<div><p class="small" style="margin:0 0 8px"><b>2. Ideia de rota de cada um</b></p>';
    if (ui.calc) h += '<div class="empty small">Montando as rotas…</div>';
    else if (!nNotas) h += '<div class="empty small">Nenhuma nota liberada para ' + dBR(d) + '.' + (window.RC_HOST ? (ui.sswLendo ? ' Buscando os CTRCs disponíveis no SSW…' : ' <button class="btn sm pri" data-a="sswSync">Buscar CTRCs no SSW</button>') : '') + '</div>' + porQueSemNotas(d);
    else if (!nm) h += '<div class="empty small">Marque ao lado os motoristas disponíveis.</div>';
    else if (!pl) h += '<div class="empty small">Montando as rotas…</div>';
    else {
      const usados = todos.filter((m) => rotaDe.has(m.id)).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
      const sobra = todos.filter((m) => motDisp(m, d) && !rotaDe.has(m.id));
      h += usados.map((m) => {
        const r = rotaDe.get(m.id);
        const cid = []; for (const p of r.paradas) { const c = cid[cid.length - 1]; if (c && c.n === p.cidadeNome) c.k++; else cid.push({ n: p.cidadeNome, k: 1 }); }
        return '<div class="ideia"><div class="row"><div><b>' + esc(m.nome) + '</b><div class="small muted">' + esc(r.veiculoNome) + '</div></div>' + (r.paradas.filter(sobraDaParada).length ? '<span class="chip warn">' + r.paradas.filter(sobraDaParada).length + ' sobra(s)</span>' : '') + '<span class="spacer"></span><button class="btn sm" data-a="verCarga" data-v="' + esc(r.veiculoId) + '">Ver carga</button></div>' +
          '<div class="small">' + r.paradas.length + ' entregas · ' + nf(r.kg, 0) + ' kg · <b>' + nf(r.km, 0) + ' km</b></div>' +
          '<div class="small ideia-din">Frete <b>' + brl(r.receita) + '</b> · Motorista <b>' + brl(r.custo && r.custo.motorista) + '</b>' + (r.pagamento ? ' <span class="tiny muted">(' + esc(r.pagamento.regiao) + (r.pagamento.regra !== 'fixo' ? ', ' + esc(r.pagamento.regra) : '') + ')</span>' : '') + ' · Lucro <b class="' + (r.lucro >= 0 ? 'pos' : 'neg') + '">' + brl(r.lucro) + '</b> · Margem <b class="' + (r.margem == null || r.margem >= 0 ? 'pos' : 'neg') + '">' + (r.margem != null ? nf(r.margem, 1) + '%' : '—') + '</b></div>' +
          '<div class="small" style="margin-top:4px">Trocar carro: ' + selTrocaCarro(pl, r) + '</div>' +
          '<div class="small rota-cid">Base → ' + cid.map((c) => esc(c.n) + (c.k > 1 ? ' (' + c.k + ')' : '')).join(' → ') + ' → Base</div></div>';
      }).join('') || '<div class="empty small">Nenhum veículo precisou sair.</div>';
      h += cruzamentoSobras(pl, d);
      if (sobra.length) h += '<p class="small muted" style="margin-top:8px">Não precisam sair: ' + sobra.map((m) => esc(m.nome)).join(', ') + '.</p>';
      const fora = (pl.naoRoteirizadas || []).length;
      if (fora) h += '<p class="small" style="margin-top:6px"><span class="chip ' + (pl.naoRoteirizadas.some((u) => u.obrigatoria) ? 'bad' : 'warn') + '">' + fora + '</span> entrega(s) ficam de fora. <a href="#" data-a="tab" data-v="rotas">Ver por quê</a></p>';
      if (pl.status === 'aprovado' && ui.escalaSuja) h += '<p class="small" style="margin-top:6px">Plano aprovado. A escala mudou: <button class="btn sm go" data-a="otimizar">Remontar</button></p>';
    }
    h += '</div></div></div>';
    return h;
  }
  // por que nenhuma nota entra no dia: dados pendentes, cidade sem rota nesse dia da semana, já programada em outro dia
  function porQueSemNotas(d) {
    const wd = RE.weekday(d), c = ctx(), DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    let pend = 0, outroDia = 0, minima = 0; const semDia = new Map(), motivos = new Map();
    const NOME = { peso: 'sem peso', volume: 'sem m³', cidade: 'cidade não reconhecida', cidade_sem_rota: 'cidade sem dias de rota cadastrados', pdf: 'lida de PDF, falta conferir', tubo_diametro: 'tubo sem diâmetro', tubo_comprimento: 'tubo sem comprimento' };
    for (const n of notasEnr()) {
      if (['entregue', 'cancelada', 'em_rota'].includes(n.status) || n.bloqueioUsuario) continue;
      if (n.planoData && n.planoData !== d && n.status === 'roteirizada') { outroDia++; continue; }
      if (n.bloqueada) { pend++; for (const cod of new Set((n.pendencias || []).filter((x) => x.bloqueia).map((x) => x.cod))) motivos.set(cod, (motivos.get(cod) || 0) + 1); continue; }
      const cid = c.cidades[n.cidadeId];
      if (cid && n.diaForcado !== d && !(cid.dias || []).includes(wd)) { semDia.set(cid.nome, (semDia.get(cid.nome) || 0) + 1); continue; }
      if (n.dataMinima && d < n.dataMinima) minima++;
    }
    const nSem = [...semDia.values()].reduce((a, b) => a + b, 0);
    if (!pend && !nSem && !outroDia && !minima) return '';
    let h = '<div class="note warn small" style="margin-top:10px"><b>Por que não há notas para ' + dBR(d) + ' (' + DIAS[wd] + '):</b><ul style="margin:6px 0 0 18px;padding:0">';
    if (pend) h += '<li><b>' + pend + '</b> nota(s) com dados pendentes: ' + [...motivos].sort((a, b) => b[1] - a[1]).map(([k, v]) => esc(NOME[k] || k) + ' (' + v + ')').join(', ') + '. <button class="btn sm" data-a="semNotasPend">Resolver pendências</button></li>';
    if (nSem) h += '<li><b>' + nSem + '</b> nota(s) de cidades que não têm rota na ' + DIAS[wd] + ': ' + [...semDia].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => esc(k) + ' (' + v + ')').join(', ') + (semDia.size > 6 ? '…' : '') + '. <button class="btn sm" data-a="semNotasForcar">Programar mesmo assim neste dia</button> <button class="btn sm" data-a="tab" data-v="cad">Ajustar dias das cidades</button></li>';
    if (outroDia) h += '<li><b>' + outroDia + '</b> nota(s) já aprovadas em programação de outro dia.</li>';
    if (minima) h += '<li><b>' + minima + '</b> nota(s) só podem sair depois desta data.</li>';
    return h + '</ul></div>';
  }
  // troca o carro de uma rota (o motorista continua); se o outro carro já tem rota, os dois trocam
  function selTrocaCarro(p, r) {
    const vs = ctx().veiculos.filter((v) => v.id !== r.veiculoId && RE.veicDisponivel(v, p.data));
    if (!vs.length) return '<span class="muted">nenhum outro carro disponível</span>';
    const usado = new Map(p.rotas.map((x) => [x.veiculoId, x]));
    return '<select data-trocav="' + esc(r.veiculoId) + '" style="width:auto;padding:3px 6px;font-size:12px" aria-label="Trocar carro"><option value="">' + esc(r.veiculoNome) + '</option>' + vs.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.nome) + (v.placa ? ' ' + esc(v.placa) : '') + ' · ' + (TIPO[v.tipo] || '') + (usado.has(v.id) ? ' (troca com ' + esc(nomeMotorista(usado.get(v.id).motoristaId) || 'outra rota') + ')' : '') + '</option>').join('') + '</select>';
  }
  function cruzamentoSobras(pl, d) {
    const ab = sobrasAbertas(); if (!ab.length) return '';
    const noPlano = new Set(); for (const r of pl.rotas) for (const st of r.paradas) for (const id of st.notas) noPlano.add(id);
    const enr = notasEnr(), achaNota = (x) => (x.notaId && ENR_MAP.get(x.notaId)) || enr.find((n) => nfChave(n.numero) && nfChave(n.numero) === nfChave(x.numero));
    const dentro = [], fora = [];
    for (const x of ab) { const n = achaNota(x); if (n && noPlano.has(n.id)) dentro.push(x); else fora.push({ x, n }); }
    const motivo = ({ x, n }) => !n ? 'nota não está no roteirizador' : n.bloqueioUsuario ? 'bloqueada' : n.status === 'em_rota' ? 'já em rota' : n.bloqueada ? 'dados pendentes' : (pl.naoRoteirizadas || []).some((u) => (u.notas || []).includes(n.id)) ? ((pl.naoRoteirizadas.find((u) => (u.notas || []).includes(n.id)) || {}).motivo || 'não coube na frota') : 'cidade sem rota neste dia';
    let h = '<div class="note ' + (fora.length ? 'warn' : 'ok') + ' small" style="margin-top:10px"><b>Sobras não baixadas:</b> ' + ab.length + ' · <b>' + dentro.length + '</b> na programação de ' + dBR(d) + (fora.length ? ' · <b>' + fora.length + '</b> fora' : '') + ' <a href="#" data-a="tab" data-v="sobras">Ver sobras</a>';
    if (fora.length) h += '<ul style="margin:6px 0 0 18px;padding:0">' + fora.sort((a, b) => a.x.data.localeCompare(b.x.data)).slice(0, 8).map((f) => '<li>NF ' + esc(f.x.numero || '—') + ' · ' + esc(f.x.cidade || (f.n && f.n.cidadeNome) || '') + ' · sobra de ' + dBR(f.x.data) + ' — ' + motivo(f) + '</li>').join('') + (fora.length > 8 ? '<li>+ ' + (fora.length - 8) + '</li>' : '') + '</ul>';
    return h + '</div>';
  }
  // ---- endereço certo pelo XML do CT-e ----
  // As notas do SSW chegam só com a cidade (ficam no centro da cidade). Para cada uma, o servidor lê o XML do CT-e
  // na opção 101 e localiza a rua e o número no mapa; a nota guarda o endereço e o ponto.
  const geoAproximado = (pr) => !pr || /cidade|munic|base/.test(pr);
  function notasSemEndereco() {
    const lim = Date.now() - 6 * 3600e3;
    return [...ST.notas.values()].filter((n) => n.ctrc && n.lat == null && !['entregue', 'cancelada'].includes(n.status) && !n.bloqueioUsuario && !(n.geoTentEm && Date.parse(n.geoTentEm) > lim));
  }
  async function localizarEnderecosXML() {
    if (!window.RC_HOST || !window.RC_HOST.enderecosCtrc || ui.geo) return;
    let fila = notasSemEndereco(); if (!fila.length) return;
    ui.geo = { feitos: 0, total: fila.length, ok: 0 }; render();
    try {
      while (fila.length) {
        const lote = fila.splice(0, 12);
        let j = null; try { j = await window.RC_HOST.enderecosCtrc(lote.map((n) => n.ctrc)); } catch (e) { console.warn('endereços XML', e.message); break; }
        const porCtrc = new Map((j.rows || []).map((r) => [String(r.ctrc).replace(/[^A-Z0-9]/gi, '').toUpperCase(), r]));
        const it = [];
        for (const n of lote) {
          const o = ST.notas.get(n.id); if (!o) continue;
          const r = porCtrc.get(String(n.ctrc).replace(/[^A-Z0-9]/gi, '').toUpperCase());
          const q = Object.assign({}, o, { geoTentEm: agoraISO() });
          if (r && r.ok) {
            const m = RE.findMun(null, r.cidade || o.endereco.cidade, r.uf || o.endereco.uf);
            q.endereco = Object.assign({}, o.endereco, { lgr: r.endereco || o.endereco.lgr, nro: r.numero || o.endereco.nro || '', bairro: r.bairro || o.endereco.bairro || '', cep: r.cep || o.endereco.cep || '', cidade: m ? m.nome : (r.cidade || o.endereco.cidade), uf: r.uf || o.endereco.uf, cMun: m ? m.cod : o.endereco.cMun, compl: r.complemento || o.endereco.compl || '' });
            if (r.destinatario && !o.destNome) q.destNome = r.destinatario;
            if (r.telefone && !o.destFone) q.destFone = r.telefone;
            q.geoPrecisao = r.precisao || ''; q.geoFonte = 'XML do CT-e' + (r.fonte ? ' · ' + r.fonte : '');
            if (r.lat != null && r.lon != null && !geoAproximado(r.precisao)) { q.lat = +r.lat; q.lon = +r.lon; ui.geo.ok++; }
          } else if (r) q.geoErro = r.erro || '';
          if (r) it.push({ id: n.id, data: q });
        }
        await salvarVarios('notas', it);
        ui.geo.feitos += lote.length; render();
        if (!(j.rows || []).length) break;     // o SSW não respondeu nada: tenta de novo mais tarde
      }
    } finally {
      const g = ui.geo; ui.geo = null;
      if (g && g.ok) { toast(g.ok + ' endereço(s) localizados pelo XML do CT-e.'); ui.escalaSuja = true; }
      render();
    }
  }
  async function sincronizarSSW() {
    if (!window.RC_HOST || ui.sswLendo) return;
    ui.sswLendo = true; render();
    try {
      const info = sswInfo();
      if (!info || Date.now() - Date.parse(info.em) > 30 * 60000) { const j = await window.RC_HOST.sswDisponiveis(false); await gravarSSW(j.rows || [], (j.fonte || 'SSW opção 038') + ' via CONSTRULOG'); }
      const ign = ignoradas(); const novas = sswLinhas().filter((r) => !notaDaLinhaSSW(r) && !ign[nfChave(r.nf)] && !devolvidaSSW(r));
      // notas que já estavam aqui e o SSW passou a mostrar como devolvidas: saem das rotas
      for (const r of sswLinhas()) { if (!devolvidaSSW(r)) continue; const n = notaDaLinhaSSW(r); if (n && !['cancelada', 'entregue'].includes(n.status)) await salvar('notas', n.id, Object.assign({}, n, { status: 'cancelada', canceladaMotivo: 'Devolvida ao remetente (SSW)' })); }
      for (const r of novas) await criarNotaDeSSW(r);
      if (novas.length) registrar('SSW', novas.length + ' CTRC(s) disponíveis trazidos automaticamente');
    } catch (e) { toast('Não foi possível ler o SSW: ' + e.message, true); }
    ui.sswLendo = false; render();
    setTimeout(() => localizarEnderecosXML(), 300);
  }
  function vVazio() {
    if (window.RC_HOST) return '<div class="card empty"><h3>Nenhuma nota no roteirizador</h3><p>Traga os CTRCs disponíveis para entrega do SSW, importe XMLs, ZIPs, DANFEs em PDF ou planilhas, ou insira notas à mão.</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn pri" data-a="irSSW">Buscar no SSW</button><button class="btn" data-a="tab" data-v="notas">' + I.up2 + 'Importar notas</button></div></div>';
    return '<div class="card empty"><h3>Nenhuma nota fiscal carregada</h3><p>Importe XMLs, ZIPs, DANFEs em PDF ou planilhas na tela Notas. Para conhecer o sistema, carregue as notas de demonstração: são marcadas como DEMO e podem ser removidas depois em Ajustes.</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn pri" data-a="tab" data-v="notas">' + I.up2 + 'Importar notas</button><button class="btn" data-a="demo">Carregar demonstração</button></div></div>';
  }

  function vNotas() {
    const enr = notasEnr();
    const pend = enr.filter((n) => n.bloqueada && !['entregue', 'cancelada'].includes(n.status));
    let h = topo('Notas fiscais', enr.length + ' nota(s) no sistema · ' + pend.length + ' com dados pendentes');
    h += '<div class="tabs" role="tablist"><button role="tab" aria-selected="' + (ui.notasSub === 'lista') + '" data-a="notasSub" data-v="lista">Lista</button><button role="tab" aria-selected="' + (ui.notasSub === 'importar') + '" data-a="notasSub" data-v="importar">Importar</button><button role="tab" aria-selected="' + (ui.notasSub === 'ssw') + '" data-a="notasSub" data-v="ssw">CTRCs disponíveis (SSW)</button><button role="tab" aria-selected="' + (ui.notasSub === 'inserir') + '" data-a="notasSub" data-v="inserir">Inserir nota</button><button role="tab" aria-selected="' + (ui.notasSub === 'revisao') + '" data-a="notasSub" data-v="revisao">Revisão de pendências' + (pend.length ? ' (' + pend.length + ')' : '') + '</button></div>';
    if (ui.notasSub === 'importar') return h + vImportar();
    if (ui.notasSub === 'ssw') return h + vSSW();
    if (ui.notasSub === 'inserir') return h + vInserir();
    if (ui.notasSub === 'revisao') return h + vRevisao(pend);
    if (!enr.length) return h + vVazio();
    const f = ui.notasFiltro;
    const q = RE.norm(f.q);
    let lista = enr.filter((n) => {
      if (f.status === 'ativas' && ['entregue', 'cancelada'].includes(n.status)) return false;
      if (f.status === 'pendentes' && !(n.bloqueada && !['entregue', 'cancelada'].includes(n.status))) return false;
      if (['pronta', 'roteirizada', 'entregue', 'cancelada'].includes(f.status) && n.status !== f.status) return false;
      if (f.cidade && n.cidadeId !== f.cidade) return false;
      if (q && !RE.norm([n.numero, n.chave, n.destNome, n.cidadeNome, n.emitente].join(' ')).includes(q)) return false;
      return true;
    });
    lista.sort((a, b) => (a.prazoEfetivo || '9999').localeCompare(b.prazoEfetivo || '9999') || (a.numero || '').localeCompare(b.numero || '', 'pt-BR', { numeric: true }));
    const cidades = [...new Set(enr.map((n) => n.cidadeId).filter(Boolean))].map((id) => [id, enr.find((n) => n.cidadeId === id).cidadeNome]).sort((a, b) => a[1].localeCompare(b[1]));
    const pag = 100, tot = lista.length, pg = Math.min(ui.notasPag, Math.max(0, Math.ceil(tot / pag) - 1));
    const vis = lista.slice(pg * pag, pg * pag + pag);
    h += '<div class="card"><div class="row" style="margin-bottom:12px"><label class="f" style="flex:2;min-width:180px">Buscar<input type="search" id="fQ" value="' + esc(f.q) + '" placeholder="Número, chave, cliente, cidade"></label>' +
      '<label class="f" style="min-width:150px">Situação<select id="fStatus">' + [['ativas', 'Ativas'], ['pendentes', 'Com pendência'], ['pronta', 'Prontas'], ['roteirizada', 'Roteirizadas'], ['entregue', 'Entregues'], ['cancelada', 'Canceladas'], ['todas', 'Todas']].map(([v, t]) => '<option value="' + v + '"' + (f.status === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
      '<label class="f" style="min-width:170px">Cidade<select id="fCidade"><option value="">Todas</option>' + cidades.map(([id, nm]) => '<option value="' + id + '"' + (f.cidade === id ? ' selected' : '') + '>' + esc(nm) + '</option>').join('') + '</select></label></div>' +
      (() => { const sel = ui.notasSel || (ui.notasSel = new Set()); for (const id of [...sel]) if (!ST.notas.has(id)) sel.delete(id);
        return sel.size ? '<div class="note warn row" style="margin-bottom:10px;align-items:center"><b>' + sel.size + ' nota(s) selecionada(s)</b><span class="spacer"></span>' + (ui.confirmar && ui.confirmar.a === 'excluirSel' ? '<span class="small">Excluir do sistema? O SSW não traz de volta sozinho.</span><button class="btn sm danger" data-a="excluirSelOk">Sim, excluir ' + sel.size + '</button><button class="btn sm" data-a="cancelarConf">Cancelar</button>' : '<button class="btn sm danger" data-a="excluirSel">Excluir selecionadas</button><button class="btn sm" data-a="limparSel">Limpar seleção</button>') + '</div>' : ''; })() +
      '<div class="tbl-wrap"><table><thead><tr><th style="width:28px"><input type="checkbox" data-selall="1" aria-label="Selecionar todas desta página"' + (vis.length && vis.every((n) => (ui.notasSel || new Set()).has(n.id)) ? ' checked' : '') + '></th><th>NF</th><th>Cliente</th><th>Destinatário</th><th>Cidade</th><th class="r">Peso kg</th><th class="r">m³</th><th class="r">Tubos</th><th class="r">Frete</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>' +
      vis.map((n) => '<tr class="click' + ((ui.notasSel || new Set()).has(n.id) ? ' sel' : '') + '" data-a="nota" data-v="' + esc(n.id) + '"><td data-a="selNota"><input type="checkbox" data-sel="' + esc(n.id) + '"' + ((ui.notasSel || new Set()).has(n.id) ? ' checked' : '') + ' aria-label="Selecionar NF ' + esc(n.numero || '') + '"></td><td class="mono">' + esc(n.numero || '—') + (n.demo ? ' <span class="chip acc">DEMO</span>' : '') + '</td><td>' + cliChip(n.emitente) + '</td><td class="trunc">' + esc(n.destNome || '—') + '</td><td>' + esc(n.cidadeNome) + '</td><td class="r num">' + nf(n.pesoKg, 0) + '</td><td class="r num">' + nf((n.volOutrosM3 || 0) + (n.volTubosM3 || 0), 2) + '</td><td class="r num">' + (n.qtdTubos || '') + '</td><td class="r num">' + (n.freteValor ? brl(n.freteValor) : '<span class="muted">—</span>') + '</td><td class="mono small">' + dBR(n.prazoEfetivo) + '</td><td>' + chipStatus(n) + '</td></tr>').join('') +
      (vis.length ? '' : '<tr><td colspan="11" class="muted">Nenhuma nota com estes filtros</td></tr>') + '</tbody></table></div>' +
      (tot > pag ? '<div class="row" style="margin-top:10px"><button class="btn sm" data-a="pag" data-v="-1"' + (pg === 0 ? ' disabled' : '') + '>Anteriores</button><span class="small muted">' + (pg * pag + 1) + '–' + Math.min(tot, pg * pag + pag) + ' de ' + tot + '</span><button class="btn sm" data-a="pag" data-v="1"' + (pg * pag + pag >= tot ? ' disabled' : '') + '>Próximas</button></div>' : '') + '</div>';
    return h;
  }
  const btnCopiarNF = (nf) => nf ? '<button type="button" class="copiar-nf" data-a="copiarNF" data-v="' + esc(nf) + '" title="Copiar NF ' + esc(nf) + '" aria-label="Copiar NF ' + esc(nf) + '"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>' : '';
  const btnExcluirNota = (n) => n && n.id && ui.tab === 'notas' ? '<button type="button" class="copiar-nf lixo" data-a="excluirUma" data-v="' + esc(n.id) + '" title="Excluir NF ' + esc(n.numero || '') + ' do sistema" aria-label="Excluir NF ' + esc(n.numero || '') + '"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : '';
  async function copiarTexto(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      try { const x = document.createElement('textarea'); x.value = t; x.style.position = 'fixed'; x.style.opacity = '0'; document.body.appendChild(x); x.select(); const ok = document.execCommand('copy'); x.remove(); return ok; } catch (e2) { return false; }
    }
  }
  // cliente (remetente) abreviado: CL Comercial Leal, LD Leal Dutra, NV Navas, CN Conasid, SM Somerlog
  const CLI_SIGLAS = [[/LEAL DUTRA/, 'LD'], [/COMERCIAL LEAL|^LEAL\b/, 'CL'], [/NAVAS/, 'NV'], [/CONASID/, 'CN'], [/SOMERLOG/, 'SM'], [/LOGMEL/, 'LM'], [/\bTHB\b/, 'THB'], [/\bFCB\b|CONSTRUDEC|SARKE/, 'FC']];
  function cliSigla(nome) { const t = RE.norm(nome || ''); if (!t) return ''; for (const [re, s] of CLI_SIGLAS) if (re.test(t)) return s; const w = t.replace(/\b(LTDA|ME|EPP|SA|S A|EIRELI|COMERCIO|COMERCIAL|DE|DA|DO|E)\b/g, ' ').trim().split(/\s+/)[0] || t; return w.slice(0, 10); }
  const cliChip = (nome) => nome ? '<span class="chip cli" title="' + esc(nome) + '">' + esc(cliSigla(nome)) + '</span>' : '<span class="muted">—</span>';
  const cliDaParada = (s) => { const n = (s.notas || []).map((id) => ST.notas.get(id)).find((x) => x && x.emitente); return n ? n.emitente : ''; };
  const chkBloqueio = (n) => n && n.id && ui.tab === 'notas' ? '<label class="bloq-nf" data-a="selNota" title="Bloquear: enquanto marcada, a NF não entra na programação"><input type="checkbox" data-bloq="' + esc(n.id) + '"' + (n.bloqueioUsuario ? ' checked' : '') + ' aria-label="Bloquear NF ' + esc(n.numero || '') + '"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg></label>' : '';
  const acoesNota = (n) => btnExcluirNota(n) + chkBloqueio(n);
  function chipStatus(n) {
    if (n.bloqueioUsuario && !['entregue', 'cancelada'].includes(n.status)) return '<span class="chip bad" title="Bloqueada: não entra na programação">Bloqueada</span>' + (n.bloqueada ? btnCopiarNF(n.numero) : '') + acoesNota(n);
    if (n.status === 'cancelada') return '<span class="chip">Cancelada</span>';
    if (n.status === 'entregue') return '<span class="chip ok">Entregue</span>';
    if (n.status === 'em_rota') return '<span class="chip info">Em rota</span>';
    if (n.bloqueada) return '<span class="chip bad">Pendente</span>' + btnCopiarNF(n.numero) + acoesNota(n);
    if (n.prioridade && n.status !== 'roteirizada') return '<span class="chip bad" title="' + esc(((n.ocorrencias || []).slice(-1)[0] || {}).motivo || '') + '">Prioridade</span>' + (n.avisos.length ? ' <span class="chip warn">' + n.avisos.length + '</span>' : '') + acoesNota(n);
    if (n.status === 'roteirizada') return '<span class="chip info">Roteirizada ' + dBR(n.planoData) + '</span>' + acoesNota(n);
    return '<span class="chip ok">Pronta</span>' + (n.avisos.length ? ' <span class="chip warn" title="' + esc(n.avisos.map((a) => a.msg).join('\n')) + '">' + n.avisos.length + ' aviso' + (n.avisos.length > 1 ? 's' : '') + '</span>' : '') + acoesNota(n);
  }
  function vImportar() {
    let h = '<div class="card"><div class="dz" id="dz"><h3 style="margin-bottom:6px">Solte os arquivos aqui</h3><p class="muted small">XML de NF-e (um ou vários), ZIP com centenas de XMLs, DANFE em PDF (uma ou várias notas por arquivo), planilha Excel ou CSV. Eventos de cancelamento em XML cancelam a nota correspondente.</p><label class="btn pri" style="margin-top:8px">' + I.up2 + 'Escolher arquivos<input type="file" id="fArq" multiple accept=".xml,.zip,.pdf,.csv,.txt,.xlsx,.xls,.ods" hidden></label></div>';
    if (ui.imp) {
      h += '<div id="impProg" style="margin-top:14px"></div>';
      if (ui.imp.res) {
        const r = ui.imp.res;
        h += '<div class="note ' + (r.ign.length ? 'warn' : 'ok') + '" style="margin-top:12px"><b>' + r.novas + ' nova(s)</b> · ' + r.atualizadas + ' atualizada(s)' + (r.comSSW ? ' (' + r.comSSW + ' já estavam no SSW e receberam os dados do arquivo)' : ' pelo XML') + ' · ' + r.duplicadas + ' duplicada(s) ignorada(s) pela chave · ' + r.canceladas + ' cancelada(s)' + (r.ign.length ? '<details style="margin-top:6px"><summary>' + r.ign.length + ' arquivo(s) não aproveitado(s)</summary><ul class="small">' + r.ign.slice(0, 80).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></details>' : '') + '</div>';
      }
    }
    h += '</div><div class="card"><h2>Como os dados são lidos</h2><dl class="kv" style="margin-top:10px"><dt>XML</dt><dd>Número, série, chave, emitente, destinatário, endereço (local de entrega quando informado), itens, peso bruto e líquido, valor, frete e observações.</dd><dt>PDF</dt><dd>Lê a chave de acesso (número, série e emitente saem dela) e tenta peso, valor e cidade. A nota fica pendente até ser conferida ou até o XML ser importado, que substitui os dados do PDF. PDF digitalizado sem texto não é lido: importe o XML.</dd><dt>Planilha</dt><dd>Colunas reconhecidas pelo título: Chave, NF, Série, Cliente, CNPJ, Endereço, Bairro, Cidade, UF, CEP, Peso, Volume, Valor, Frete, Prazo, Produto, Quantidade, Diâmetro, Comprimento, Latitude, Longitude. Linhas com a mesma chave ou número viram itens da mesma nota.</dd><dt>Duplicadas</dt><dd>Reconhecidas pela chave de acesso.</dd><dt>Sem invenção</dt><dd>Peso, volume, dimensões e frete ausentes ficam como pendência. Valores vêm da nota, do cadastro de produtos ou do operador.</dd></dl></div>';
    return h;
  }
  function vRevisao(pend) {
    if (!pend.length) return '<div class="card empty"><h3>Nenhuma pendência</h3><p>Todas as notas ativas têm peso, volume, dimensões dos tubos e cidade com dias de rota.</p></div>';
    let h = '';
    // tubos sem dimensões agrupados pela descrição
    const tubos = new Map();
    for (const n of pend) for (const p of n.pendencias) if (p.cod === 'tubo_diametro' || p.cod === 'tubo_comprimento') { const k = p.item; const o = tubos.get(k) || { desc: k, notas: new Set(), faltam: new Set() }; o.notas.add(n.id); o.faltam.add(p.cod === 'tubo_diametro' ? 'diâmetro' : 'comprimento'); tubos.set(k, o); }
    if (tubos.size) {
      h += '<div class="card"><div class="card-h"><h2>Tubos sem dimensões</h2><span class="chip bad">' + tubos.size + '</span></div><p class="small muted">Informe uma vez: o produto vai para o cadastro e vale para todas as notas com esta descrição.</p><div class="stack" style="margin-top:10px">' +
        [...tubos.values()].map((o, i) => { const dd = RE.dimsDaDescricao(o.desc); return '<div class="card" style="background:var(--surface-2)"><div class="row"><b>' + esc(o.desc) + '</b><span class="chip">' + o.notas.size + ' nota(s)</span><span class="chip bad">falta ' + [...o.faltam].join(' e ') + '</span></div>' + (dd.dePol ? '<p class="tiny">Bitola ' + dd.dePol + '" lida na descrição. Referência para tubo de aço (NBR 5580/ASME): ' + dd.deNpsSugerido + ' mm. Confirme com o fabricante.</p>' : '') +
          '<div class="fields" style="margin-top:8px" data-tubo="' + i + '"><label class="f">Ø externo mm<input type="number" step="0.1" name="de" value="' + (dd.de || '') + '"></label><label class="f">Espessura mm<input type="number" step="0.1" name="esp" value="' + (dd.esp || '') + '"></label><label class="f">Comprimento m<input type="number" step="0.01" name="compr" value="' + (dd.compr || '') + '"></label><label class="f">Peso por barra kg<input type="number" step="0.01" name="peso"></label><label class="f">Material<select name="mat">' + ['', 'PVC', 'PEAD', 'AÇO', 'PPR', 'CONCRETO', 'COBRE'].map((m) => '<option' + (m === RE.materialDe(o.desc) ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label><label class="f">Encaixe<select name="enc"><option value="1">Pode receber e entrar</option><option value="0">Não encaixar</option></select></label></div><div class="row end" style="margin-top:8px"><button class="btn pri sm" data-a="salvarTubo" data-v="' + esc(o.desc) + '" data-i="' + i + '">Salvar no cadastro</button></div></div>'; }).join('') + '</div></div>';
    }
    const semPV = pend.filter((n) => n.pendencias.some((p) => p.cod === 'peso' || p.cod === 'volume'));
    if (semPV.length) {
      h += '<div class="card"><div class="card-h"><h2>Peso ou volume ausente</h2><span class="chip bad">' + semPV.length + '</span></div><p class="small muted">Valor informado aqui vale só para a nota. Para repetir em outras notas, cadastre o produto com peso e volume unitários.</p><div class="tbl-wrap"><table><thead><tr><th>NF</th><th>Destinatário</th><th>Itens</th><th>Peso bruto kg</th><th>Volume m³ (sem tubos)</th></tr></thead><tbody>' +
        semPV.map((n) => { const fp = n.pendencias.some((p) => p.cod === 'peso'), fv = n.pendencias.some((p) => p.cod === 'volume'); return '<tr><td class="mono">' + esc(n.numero) + '</td><td class="trunc">' + esc(n.destNome) + '</td><td class="small trunc" title="' + esc(n.itens.map((x) => x.qtd + ' ' + x.desc).join('\n')) + '">' + esc(n.itens.map((x) => x.qtd + ' ' + x.desc).join('; ')) + '</td><td>' + (fp ? '<input type="number" step="0.01" min="0" data-bind="notas|' + esc(n.id) + '|pesoOperador" data-t="num" placeholder="kg" style="width:110px">' : nf(n.pesoKg, 1)) + '</td><td>' + (fv ? '<input type="number" step="0.001" min="0" data-bind="notas|' + esc(n.id) + '|volOperador" data-t="num" placeholder="m³" style="width:110px">' : nf(n.volOutrosM3, 3)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    }
    const semCid = new Map();
    for (const n of pend) for (const p of n.pendencias) if (p.cod === 'cidade_sem_rota') semCid.set(n.cidadeId, (semCid.get(n.cidadeId) || 0) + 1);
    if (semCid.size) {
      h += '<div class="card"><div class="card-h"><h2>Cidades sem dias de rota</h2><span class="chip bad">' + semCid.size + '</span></div><div class="stack">' + [...semCid].map(([id, k]) => { const m = RE.findMun(id); return '<div class="row"><b>' + esc(m ? m.nome + '/' + m.uf : id) + '</b><span class="chip">' + k + ' nota(s)</span><span class="spacer"></span>' + (ST.admin ? '<button class="btn sm pri" data-a="addCidade" data-v="' + esc(id) + '">' + I.plus + 'Cadastrar com segunda a sexta</button>' : '<span class="tiny">Peça a um administrador</span>') + '</div>'; }).join('') + '</div></div>';
    }
    const outros = pend.filter((n) => n.pendencias.some((p) => p.cod === 'cidade' || p.cod === 'pdf'));
    if (outros.length) {
      h += '<div class="card"><div class="card-h"><h2>Destino a conferir</h2><span class="chip bad">' + outros.length + '</span></div><div class="tbl-wrap"><table><thead><tr><th>NF</th><th>Destinatário</th><th>Cidade</th><th>UF</th><th>Peso kg</th><th></th></tr></thead><tbody>' +
        outros.map((n) => '<tr><td class="mono">' + esc(n.numero) + (n.pdfParcial ? ' <span class="chip">PDF</span>' : '') + '</td><td><input type="text" data-bind="notas|' + esc(n.id) + '|destNome" value="' + esc(n.destNome || '') + '"></td><td><input type="text" list="dlMun" data-mun="' + esc(n.id) + '" value="' + esc((n.endereco && n.endereco.cidade) || '') + '" placeholder="Cidade/UF"></td><td class="mono">' + esc((n.endereco && n.endereco.uf) || '') + '</td><td><input type="number" step="0.01" data-bind="notas|' + esc(n.id) + '|pesoOperador" data-t="num" value="' + (n.pesoKg || '') + '" style="width:100px"></td><td>' + (n.pdfParcial ? '<button class="btn sm" data-a="conferirPdf" data-v="' + esc(n.id) + '">' + I.check + 'Conferido</button>' : '') + '</td></tr>').join('') + '</tbody></table></div><p class="tiny" style="margin-top:6px">Escolha a cidade na lista para gravar o código IBGE.</p></div>';
    }
    return h;
  }
  function vNotaSheet() {
    const id = ui.notaAberta;
    const n = notaE(id), raw = ST.notas.get(id);
    if (!n || !raw) return '';
    const e = n.endereco || {};
    const vs = ctx().veiculos;
    const b = (k, t, v, ty, extra) => '<label class="f">' + t + '<input type="' + (ty || 'text') + '" data-bind="notas|' + esc(id) + '|' + k + '"' + (ty === 'number' ? ' data-t="num" step="any"' : '') + ' value="' + esc(v == null ? '' : v) + '"' + (extra || '') + '></label>';
    let h = '<div class="sheet-bg" data-a="fecharNota"></div><div class="sheet" role="dialog" aria-label="Nota fiscal"><div class="row"><h2 style="font-size:24px">NF ' + esc(n.numero || '—') + (n.serie ? ' / ' + esc(n.serie) : '') + '</h2>' + chipStatus(n) + '<span class="spacer"></span><button class="btn ic" data-a="fecharNota" aria-label="Fechar">' + I.x + '</button></div>' +
      '<p class="mono tiny" style="overflow-wrap:anywhere">' + esc(n.chave || 'sem chave') + '</p>';
    if (n.pendencias.length || n.avisos.length) h += '<div class="stack" style="margin:10px 0">' + n.pendencias.map((p) => '<div class="note bad small">' + esc(p.msg) + '</div>').join('') + n.avisos.map((p) => '<div class="note warn small">' + esc(p.msg) + '</div>').join('') + '</div>';
    h += '<div class="card"><dl class="kv"><dt>Emitente</dt><dd>' + esc(n.emitente || '—') + '</dd><dt>Destinatário</dt><dd>' + esc(n.destNome || '—') + ' <span class="mono tiny">' + esc(n.destDoc || '') + '</span></dd><dt>Entrega</dt><dd>' + esc([e.lgr, e.nro, e.cpl, e.bairro].filter(Boolean).join(', ')) + '<br>' + esc(n.cidadeNome) + ' · CEP ' + esc(e.cep || '—') + (e.localEntregaDiferente ? ' <span class="chip info">local de entrega da NF-e</span>' : '') + '</dd><dt>Emissão</dt><dd>' + dBR(n.emissao) + '</dd><dt>Valor</dt><dd>' + brl(n.valorMerc) + '</dd><dt>Peso</dt><dd>' + nf(n.pesoKg, 2) + ' kg <span class="tiny">(' + esc(n.pesoFonte || 'ausente') + ')</span></dd><dt>Volume</dt><dd>' + nf(n.volOutrosM3, 3) + ' m³ soltos <span class="tiny">(' + esc(n.volFonte || 'ausente') + ')</span>' + (n.qtdTubos ? ' + ' + n.qtdTubos + ' tubo(s)' : '') + '</dd><dt>Frete</dt><dd>' + brl(n.freteValor) + ' <span class="tiny">(' + esc(n.freteFonte) + ')</span></dd><dt>Posição</dt><dd>' + esc(n.coordFonte || '—') + '</dd>' + (n.obs ? '<dt>Observações</dt><dd class="small">' + esc(n.obs) + '</dd>' : '') + '</dl></div>';
    h += '<div class="card"><h3>Itens</h3><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Descrição</th><th class="r">Qtd</th><th>Tipo</th><th>Dimensões</th><th></th></tr></thead><tbody>' + n.itens.map((it, i) => '<tr><td class="small">' + esc(it.desc) + '<div class="tiny mono">' + esc(it.cod) + '</div></td><td class="r num">' + nf(it.qtd, it.qtd % 1 ? 2 : 0) + ' ' + esc(it.un || '') + '</td><td><span class="chip">' + ({ tubo: 'Tubo', conexao: 'Conexão', caixa_agua: "Caixa d'água", outro: 'Outro' }[it.tipo] || it.tipo) + '</span></td><td class="small">' + (it.tubo ? 'Ø' + (it.tubo.de || '?') + (it.tubo.di ? '/' + it.tubo.di : '') + ' mm · ' + (it.tubo.compr || '?') + ' m · ' + it.tubo.barras + ' barra(s)' : it.volM3 ? nf(it.volM3, 3) + ' m³' : '—') + '</td><td>' + (it.produtoId ? '<span class="chip ok">cadastro</span>' : '<button class="btn sm" data-a="novoProduto" data-v="' + esc(id) + '" data-i="' + i + '">Cadastrar</button>') + '</td></tr>').join('') + '</tbody></table></div></div>';
    h += '<div class="card"><h3>Dados do operador</h3><div class="fields" style="margin-top:10px">' + b('pesoOperador', 'Peso bruto kg', raw.pesoOperador, 'number') + b('volOperador', 'Volume m³ (sem tubos)', raw.volOperador, 'number') + b('frete', 'Frete recebido R$', raw.frete, 'number') + b('prazo', 'Data limite', raw.prazo, 'date') + b('diaForcado', 'Entregar em (fora do dia da cidade)', raw.diaForcado, 'date') +
      '<label class="f">Travar no veículo<select data-bind="notas|' + esc(id) + '|travaVeiculo"><option value="">Livre</option>' + vs.map((v) => '<option value="' + esc(v.id) + '"' + (raw.travaVeiculo === v.id ? ' selected' : '') + '>' + esc(v.nome) + '</option>').join('') + '</select></label>' +
      b('lat', 'Latitude', raw.lat, 'number') + b('lon', 'Longitude', raw.lon, 'number') + '</div><p class="tiny" style="margin-top:6px">Coordenadas valem para esta nota. Para o cliente inteiro, use Cadastros › Clientes.</p></div>';
    h += '<div class="row" style="margin-top:14px">' + (n.status !== 'entregue' ? '<button class="btn" data-a="statusNota" data-v="entregue">' + I.check + 'Marcar entregue</button>' : '<button class="btn" data-a="statusNota" data-v="pronta">Reabrir</button>') + (n.status !== 'cancelada' ? '<button class="btn danger" data-a="statusNota" data-v="cancelada">Cancelar nota</button>' : '<button class="btn" data-a="statusNota" data-v="pronta">Reativar</button>') + '<span class="spacer"></span><button class="btn danger" data-a="excluirNota">Excluir</button></div>' + confirmacao('excluirNota', 'Excluir a nota do sistema? O histórico de planos aprovados continua com o número.');
    return h + '</div>';
  }
  function confirmacao(acao, msg, v) {
    if (!ui.confirmar || ui.confirmar.a !== acao) return '';
    return '<div class="confirm"><span class="small">' + esc(msg) + '</span><span class="spacer"></span><button class="btn sm" data-a="cancelarConf">Voltar</button><button class="btn sm danger" data-a="confirmar"' + (v ? ' data-v="' + esc(v) + '"' : '') + '>Confirmar</button></div>';
  }

  // ---------------- CTRCs disponíveis para entrega (SSW) e notas manuais ----------------
  // NF excluída no roteirizador some de todas as listas do SSW (fica guardada em 'ignoradas' por 60 dias)
  const sswLinhas = () => { const ign = ignoradas(); return [...ST.ssw.values()].filter((d) => d.id !== 'ignoradas').sort((a, b) => (a.id || '').localeCompare(b.id || '')).flatMap((d) => d.linhas || []).filter((r) => !ign[nfChave(r.nf)]); };
  const sswInfo = () => { const ds = [...ST.ssw.values()]; return ds.length ? { em: ds.map((d) => d.capturadoEm || '').sort().pop(), fonte: (ds[0] || {}).fonte || '' } : null; };
  const nfKey = (s) => { const d = String(s || '').replace(/\D/g, ''); return d ? String(+d) : ''; };
  const sswKey = (r) => 'ssw-' + (String(r.ctrc || '').replace(/[^A-Za-z0-9]/g, '') || 'nf' + nfKey(r.nf));
  function acharSSW(t) {
    const k = String(t).replace(/\D/g, '');
    if (!k) return null;
    return sswLinhas().find((r) => nfKey(r.nf) === String(+k)) || (k.length >= 5 ? sswLinhas().find((r) => String(r.ctrc || '').replace(/\D/g, '').endsWith(k)) : null) || null;
  }
  // nota já existente para a linha do SSW (mesmo CTRC, ou mesma NF do mesmo remetente)
  // mercadoria devolvida ao remetente: não é entrega, não entra no roteirizador
  const devolvidaSSW = (r) => /DEVOLV|DEVOLU|RETORN\w* (A|AO|P) ?REMET|AO REMETENTE|DEV REMET/.test(RE.norm((r.status || '') + ' ' + (r.detalhes || '') + ' ' + (r.ocorrencia || '')));
  const nfChave = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  const ignoradas = () => (ST.ssw.get('ignoradas') || {}).nfs || {};
  // tira notas (excluídas ou bloqueadas) das programações de hoje em diante e recalcula as rotas
  async function tirarDosPlanos(ids) {
    const fora = new Set(ids), refazer = []; if (!fora.size) return;
    const tem = (x) => (x && Array.isArray(x.notas) ? x.notas : [x && x.nota && (x.nota.id || x.nota), x && x.id]).some((id) => fora.has(id));
    for (const [d, p0] of [...ST.planos]) {
      if (d < hoje() || !p0 || !p0.rotas) continue;
      if (!p0.rotas.some((r) => r.paradas.some((x) => x.notas.some((id) => fora.has(id)))) && !(p0.naoRoteirizadas || []).some(tem) && !(p0.pendentes || []).some(tem)) continue;
      const p = clone(p0);
      for (const r of p.rotas) { for (const x of r.paradas) x.notas = x.notas.filter((id) => !fora.has(id)); r.paradas = r.paradas.filter((x) => x.notas.length); }
      p.rotas = p.rotas.filter((r) => r.paradas.length);
      if (p.naoRoteirizadas) p.naoRoteirizadas = p.naoRoteirizadas.filter((x) => !tem(x));
      if (p.pendentes) p.pendentes = p.pendentes.filter((x) => !tem(x));
      if (p0.status !== 'aprovado') { refazer.push(d); continue; }
      let rec = p; try { rec = Object.assign(RE.recalcularPlano(p, notasEnr().filter((n) => !fora.has(n.id)), ctx()), { naoRoteirizadas: p.naoRoteirizadas || [], pendentes: p.pendentes || [] }); } catch (e) { rec = p; }
      await salvar('planos', d, rec);
    }
    // programação ainda não aprovada: é refeita do zero (a do dia na tela, na hora; as outras, ao abrir o dia)
    for (const d of refazer) { if (d === ui.data) continue; await remover('planos', d); }
    if (refazer.includes(ui.data)) setTimeout(() => { if (!ui.calc) otimizar(); }, 300);
  }
  async function excluirNotas(ids) {
    const ign = Object.assign({}, ignoradas()), nums = [];
    for (const id of ids) {
      const n = ST.notas.get(id); if (!n) continue;
      await remover('notas', id); nums.push(n.numero);
      const k = nfChave(n.numero); if (k) ign[k] = hoje();
    }
    await tirarDosPlanos(ids);
    const numsK = new Set(nums.map(nfChave));
    for (const sb of [...ST.sobras.values()]) if ((sb.notaId && ids.includes(sb.notaId)) || numsK.has(nfChave(sb.numero))) await remover('sobras', sb.id);
    // guarda por 60 dias para o SSW não trazer de volta
    const lim = RE.addDays(hoje(), -60); for (const k of Object.keys(ign)) if (ign[k] < lim) delete ign[k];
    await salvar('ssw', 'ignoradas', { id: 'ignoradas', nfs: ign });
    if (nums.length) registrar('Notas excluídas', nums.length + ' nota(s): NF ' + nums.join(', '));
    ui.notasSel = new Set(); ui.confirmar = null;
    toast(nums.length + ' nota(s) excluída(s).');
    render();
  }
  function notaDaLinhaSSW(r) {
    const id = sswKey(r);
    if (ST.notas.has(id)) return ST.notas.get(id);
    const k = nfKey(r.nf), rem = RE.norm(r.remetente).slice(0, 10);
    if (!k) return null;
    return [...ST.notas.values()].find((n) => nfKey(n.numero) === k && (!rem || !n.emitente || RE.norm(n.emitente).slice(0, 10) === rem)) || null;
  }
  async function criarNotaDeSSW(r) {
    const ex = notaDaLinhaSSW(r);
    if (ex) return ex.id;
    const id = sswKey(r);
    const n = RE.notaDoSSW(r);
    const m = RE.findMun(null, n.endereco.cidade, n.endereco.uf);
    if (m) { n.endereco.cidade = m.nome; n.endereco.cMun = m.cod; }
    await salvar('notas', id, Object.assign(n, { id, status: 'pronta', importadoEm: agoraISO(), importadoPor: ST.uid, chegouEm: r.chegou || null }));
    return id;
  }
  async function criarNotaManual(f) {
    const m = munPorTexto(f.cidade) || RE.findMun(null, f.cidade, 'SP');
    const id = 'man-' + nfKey(f.numero) + '-' + hash(RE.norm(f.emitente || '')).slice(0, 5);
    if (ST.notas.has(id)) return id;
    const n = {
      id, numero: nfKey(f.numero), serie: f.serie || '', emitente: f.emitente || '', destNome: f.cliente || '',
      endereco: { lgr: f.endereco || '', nro: '', bairro: '', cidade: m ? m.nome : f.cidade || '', uf: m ? m.uf : 'SP', cep: '', cMun: m ? m.cod : '' },
      pesoB: f.peso > 0 ? f.peso : null, volM3: f.m3 > 0 ? f.m3 : null, qVol: f.volumes || null, valorMerc: 0, freteXml: 0, frete: f.frete > 0 ? f.frete : null,
      prazo: f.prazo || '', itens: [], origem: 'manual', mercadoria: f.carga || '', exigeTubo: !!f.tubo, obs: f.obs || '',
      status: 'pronta', importadoEm: agoraISO(), importadoPor: ST.uid, chegouEm: f.chegou || null,
    };
    await salvar('notas', id, n);
    registrar('Nota inserida manualmente', 'NF ' + n.numero + ' ' + n.destNome);
    return id;
  }
  function campoNotaManual(pref, v) {
    v = v || {};
    const i = (k, t, ty, ph, extra) => '<label class="f">' + t + '<input type="' + (ty || 'text') + '" id="' + pref + k + '"' + (ty === 'number' ? ' step="any" min="0"' : '') + ' value="' + esc(v[k] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (extra || '') + '></label>';
    return '<div class="fields">' + (v.semNumero ? '' : i('numero', 'NF', 'text', 'Número', ' inputmode="numeric"')) + i('emitente', 'Embarcador', 'text', '', ' list="dlEmb"') + i('cliente', 'Cliente (destinatário)') + i('cidade', 'Cidade', 'text', 'Cidade/UF', ' list="dlMun"') + i('endereco', 'Endereço') + i('peso', 'Peso kg', 'number') + i('volumes', 'Volumes', 'number') + i('m3', 'Volume m³', 'number') + i('frete', 'Frete R$', 'number') + i('prazo', 'Data limite', 'date') + i('chegou', 'Chegou no galpão', 'date') + i('carga', 'Carga', 'text', 'COM TUBO, 500KG SIKATOP…') + '</div><label class="chk" style="margin-top:8px"><input type="checkbox" id="' + pref + 'tubo"' + (v.tubo ? ' checked' : '') + '> Carga com tubo (só sai em van de tubos)</label>';
  }
  function lerNotaManual(pref) {
    const g = (k) => { const e = $('#' + pref + k); return e ? e.value.trim() : ''; };
    const carga = g('carga').toUpperCase();
    return { numero: g('numero'), emitente: g('emitente').toUpperCase(), cliente: g('cliente'), cidade: g('cidade'), endereco: g('endereco'), peso: RE.num(g('peso')), volumes: RE.num(g('volumes')), m3: RE.num(g('m3')), frete: RE.num(g('frete')), prazo: g('prazo'), chegou: g('chegou'), carga, tubo: !!($('#' + pref + 'tubo') || {}).checked || (/TUBO/.test(carga) && !/SEM TUBO/.test(carga)) };
  }
  function vSSW() {
    const info = sswInfo();
    const linhas = sswLinhas();
    const f = ui.sswFiltro || (ui.sswFiltro = { q: '', so: 'novas' });
    const q = RE.norm(f.q);
    const enr = linhas.map((r) => ({ r, n: notaDaLinhaSSW(r) }));
    const vis = enr.filter((x) => (f.so !== 'novas' || (!x.n && !devolvidaSSW(x.r))) && (!q || RE.norm([x.r.nf, x.r.ctrc, x.r.cliente, x.r.cidade, x.r.remetente].join(' ')).includes(q)));
    const novas = enr.filter((x) => !x.n && !devolvidaSSW(x.r));
    let h = '<div class="card"><div class="card-h"><h2>CTRCs disponíveis para entrega</h2>' + (info ? '<span class="chip info">' + esc(info.fonte || 'SSW') + ' · ' + new Date(info.em).toLocaleString('pt-BR') + '</span>' : '') + '</div>';
    const hostBtn = window.RC_HOST ? '<button class="btn pri" data-a="sswAtualizar"' + (ui.sswCarregando ? ' disabled' : '') + '>' + (ui.sswCarregando ? 'Lendo o SSW…' : 'Atualizar do SSW agora') + '</button>' : '';
    if (window.RC_HOST && !ui.sswAuto && (!info || Date.now() - Date.parse(info.em) > 30 * 60000)) { ui.sswAuto = true; setTimeout(() => atualizarSSW(false), 50); }
    if (!linhas.length) return h + (hostBtn ? '<div class="row" style="margin-bottom:10px">' + hostBtn + '</div>' : '') + '<div class="empty"><h3>Lista ainda não carregada</h3><p>A lista vem do SSW (opção 038, pendências), a mesma que a Programação do CONSTRULOG lê. Também dá para carregar um arquivo exportado do SSW (CSV ou Excel com NF, CTRC, remetente, destinatário, cidade, peso, volumes, m³).</p><label class="btn" style="margin-top:8px">' + I.up2 + 'Carregar arquivo do SSW<input type="file" id="fSSW" accept=".csv,.txt,.xlsx,.xls" hidden></label></div></div>';
    h += '<p class="small muted">' + linhas.length + ' CTRC(s) disponíveis · ' + novas.length + ' ainda fora do roteirizador. “Trazer” cria a nota aqui com peso, volumes, m³, cidade e previsão do SSW; carga com tubo só sai em van de tubos.</p>' +
      '<div class="row" style="margin:10px 0"><input type="search" id="fSSWq" value="' + esc(f.q) + '" placeholder="NF, CTRC, cliente, cidade" style="max-width:280px"><select id="fSSWso" style="width:auto"><option value="novas"' + (f.so === 'novas' ? ' selected' : '') + '>Só as que faltam trazer</option><option value="todas"' + (f.so === 'todas' ? ' selected' : '') + '>Todas</option></select><span class="spacer"></span>' + hostBtn + '<label class="btn sm">' + I.up2 + 'Atualizar com arquivo<input type="file" id="fSSW" accept=".csv,.txt,.xlsx,.xls" hidden></label><button class="btn go" data-a="sswTrazer"' + (vis.some((x) => !x.n) ? '' : ' disabled') + '>Trazer ' + vis.filter((x) => !x.n).length + ' para o roteirizador</button></div>' +
      '<div class="tbl-wrap" style="max-height:560px;overflow:auto"><table><thead><tr><th>CTRC</th><th>NF</th><th>Cliente</th><th>Destinatário</th><th>Cidade</th><th class="r">Vol.</th><th class="r">Peso kg</th><th class="r">m³</th><th>Previsão</th><th>Mercadoria</th><th>No roteirizador</th></tr></thead><tbody>' +
      vis.slice(0, 400).map((x) => '<tr><td class="mono small">' + esc(x.r.ctrc) + '</td><td class="mono">' + esc(x.r.nf) + '</td><td>' + cliChip(x.r.remetente) + '</td><td class="small trunc">' + esc(x.r.cliente) + '</td><td>' + esc(x.r.cidade) + '</td><td class="r num">' + (x.r.volumes || '') + '</td><td class="r num">' + nf(x.r.peso, 0) + '</td><td class="r num">' + (x.r.m3 ? nf(x.r.m3, 2) : '<span class="muted">—</span>') + '</td><td class="mono small">' + esc(x.r.previsao ? dBR(x.r.previsao) : '') + (x.r.diasAtraso > 0 ? ' <span class="chip bad">' + x.r.diasAtraso + 'd</span>' : '') + '</td><td class="small trunc">' + esc([x.r.mercadoria, x.r.detalhes].filter(Boolean).join(' ')) + '</td><td>' + (devolvidaSSW(x.r) ? '<span class="chip" title="' + esc(x.r.status || '') + '">devolvida ao remetente</span>' : x.n ? chipStatus(notaE(x.n.id)) : '<span class="chip">fora</span>') + '</td></tr>').join('') +
      (vis.length ? '' : '<tr><td colspan="11" class="muted">Nada com estes filtros</td></tr>') + '</tbody></table></div>' + (vis.length > 400 ? '<p class="tiny">Mostrando 400 de ' + vis.length + '.</p>' : '') + '</div>';
    return h;
  }
  function vInserir() {
    const embs = [...new Set([...ST.notas.values()].map((n) => n.emitente).filter(Boolean))].sort();
    return '<div class="card"><h2>Inserir nota</h2><p class="small muted" style="margin:6px 0 12px">Para nota que não veio por XML nem pelo SSW. Com cidade, peso e volume ela já entra nas rotas; o que faltar aparece em Revisão de pendências.</p>' + campoNotaManual('nm') + '<div class="row end" style="margin-top:12px"><button class="btn pri" data-a="nmSalvar">' + I.plus + 'Inserir nota</button></div></div><datalist id="dlEmb">' + embs.map((e) => '<option value="' + esc(e) + '">').join('') + '</datalist>';
  }
  async function trazerSSW(linhas) {
    let k = 0;
    const ign = Object.assign({}, ignoradas()); let mud = false;
    let dev = 0;
    for (const r of linhas) { if (devolvidaSSW(r)) { dev++; continue; } if (!notaDaLinhaSSW(r)) { await criarNotaDeSSW(r); k++; if (ign[nfChave(r.nf)]) { delete ign[nfChave(r.nf)]; mud = true; } } }
    if (dev) toast(dev + ' devolvida(s) ao remetente ficaram de fora.');
    if (mud) await salvar('ssw', 'ignoradas', { id: 'ignoradas', nfs: ign });
    registrar('SSW', k + ' CTRC(s) disponíveis trazidos para o roteirizador');
    toast(k + ' nota(s) trazida(s) do SSW.');
    render();
  }
  async function carregarArquivoSSW(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let rows;
    try {
      if (ext === 'csv' || ext === 'txt') rows = RE.parseCSV(await file.text());
      else { const X = await lib('xlsx'); const wb = X.read(await file.arrayBuffer(), { type: 'array' }); rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }); }
    } catch (e) { toast('Não foi possível ler o arquivo: ' + e.message, true); return; }
    const notas = RE.rowsToNotas(rows);
    const linhas = notas.map((n) => ({ ctrc: n.ctrc || '', nf: n.numero || '', remetente: n.emitente || '', cliente: n.destNome || '', cidade: (n.endereco || {}).cidade || '', uf: (n.endereco || {}).uf || 'SP', volumes: n.qVol || 0, peso: n.pesoB || 0, m3: n.volM3 || 0, previsao: n.prazo ? dBR(n.prazo) : '', mercadoria: n.mercadoria || '', frete: n.frete || 0, detalhes: '' })).filter((r) => r.nf || r.ctrc);
    if (!linhas.length) { toast('Nenhuma linha com NF ou CTRC no arquivo.', true); return; }
    await gravarSSW(linhas, 'Arquivo ' + file.name);
  }
  async function atualizarSSW(forcar) {
    if (!window.RC_HOST || ui.sswCarregando) return;
    ui.sswCarregando = true; render();
    try {
      const j = await window.RC_HOST.sswDisponiveis(forcar);
      await gravarSSW(j.rows || [], (j.fonte || 'SSW opção 038') + ' via CONSTRULOG');
    } catch (e) { toast('Não foi possível ler o SSW: ' + e.message, true); }
    ui.sswCarregando = false; render();
  }
  // Frota e Rastreio de carga do CONSTRULOG -> veículos e motoristas do roteirizador
  const TIPO_FROTA = { FIORINO: 'fiorino', VAN: 'van', 'UTILITARIO': 'van', 'VAN COM TUBO': 'tubos', 'VAN TUBO': 'tubos', 'VAN DE TUBOS': 'tubos' };
  const titulo = (s) => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (m) => m.toLowerCase());
  async function importarFrota() {
    if (!window.RC_HOST || (ui.frotaImp && ui.frotaImp.carregando)) return;
    ui.frotaImp = { carregando: true }; render();
    let r;
    try { r = await window.RC_HOST.frotaERastreio(30); } catch (e) { ui.frotaImp = null; toast('Falha ao ler o CONSTRULOG: ' + e.message, true); render(); return; }
    const res = { novosV: 0, novosM: 0, atual: 0, avisos: r.avisos || [] };
    const tel = new Map((r.contatos || []).map((c) => [RE.norm(c.driver_name), c.phone]));
    // motoristas: rastreio dos últimos dias + pessoas da Frota com função de motorista
    const mot = new Map();
    for (const x of r.rastreio) {
      const k = RE.norm(x.driver_name); if (!k) continue;
      const o = mot.get(k) || { nome: x.driver_name, ultimo: '', placa: '', dias: 0 };
      o.dias++; if (x.data > o.ultimo) { o.ultimo = x.data; o.placa = String(x.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
      mot.set(k, o);
    }
    for (const v of r.veiculos || []) { const k = RE.norm(v.driver); if (!k || mot.has(k)) continue; mot.set(k, { nome: v.driver, ultimo: '', placa: String(v.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), dias: 0, daFrota: true }); }
    for (const p of r.pessoas || []) { if (!/motor/i.test(p.role || 'motorista')) continue; const k = RE.norm(p.name); if (!k) continue; const o = mot.get(k) || { nome: p.name, ultimo: '', placa: '', dias: 0 }; o.pessoa = p; mot.set(k, o); }
    const porNome = new Map([...ST.motoristas.values()].map((m) => [RE.norm(m.nome), m]));
    const idDoMot = new Map();
    for (const [k, o] of mot) {
      const ex = porNome.get(k);
      const fone = (o.pessoa && o.pessoa.phone) || tel.get(k) || '';
      if (ex) {
        const q = Object.assign({}, ex, { ultimoUso: o.ultimo || ex.ultimoUso || null, ultimaPlaca: o.placa || ex.ultimaPlaca || '' });
        if (!q.telefone && fone) q.telefone = fone;
        if (o.pessoa && o.pessoa.cnh && !q.cnh) { q.cnh = o.pessoa.cnh; q.cnhValidade = o.pessoa.cnhExpiry || q.cnhValidade; }
        await salvar('motoristas', ex.id, q); res.atual++; idDoMot.set(k, ex.id);
      } else {
        const id = 'm-' + hash(k);
        await salvar('motoristas', id, { id, nome: titulo(o.nome), telefone: fone, diaria: 0, ativo: true, disponivel: true, ultimoUso: o.ultimo || null, ultimaPlaca: o.placa, cnh: (o.pessoa && o.pessoa.cnh) || '', cnhValidade: (o.pessoa && o.pessoa.cnhExpiry) || '', origem: o.dias ? 'Rastreio de carga (' + o.dias + ' dia(s) em 30)' : o.daFrota ? 'Motorista habitual na Frota' : 'Frota' });
        res.novosM++; idDoMot.set(k, id);
      }
    }
    // veículos: placas da Frota (Fiorino, Van, Utilitário) e placas usadas no rastreio
    const placas = new Map();
    for (const v of r.veiculos || []) {
      const pl = String(v.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!pl) continue;
      const tx = RE.norm([v.type, v.brand, v.model, v.notes, v.obs].filter(Boolean).join(' '));
      const t = /TUBO/.test(tx) ? 'tubos' : /FIORINO|STRADA|KANGOO|DOBLO|PARTNER|SAVEIRO|COURIER|BERLINGO|MONTANA/.test(tx) ? 'fiorino' : (TIPO_FROTA[RE.norm(v.type)] || (/VAN|MASTER|SPRINTER|DUCATO|DAILY|BOXER|JUMPER|HR|BONGO|IVECO/.test(tx) ? 'van' : null));
      if (!t || /VENDIDO/i.test(v.status || '')) continue;
      placas.set(pl, { pl, tipo: t, modelo: [v.brand, v.model].filter(Boolean).join(' '), motorista: v.driver || '', manut: /MANUT|PARADO/i.test(v.status || '') });
    }
    const ultimoMotDaPlaca = new Map();
    for (const x of r.rastreio.sort((a, b) => a.data.localeCompare(b.data))) { const pl = String(x.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (pl) ultimoMotDaPlaca.set(pl, RE.norm(x.driver_name)); }
    for (const pl of ultimoMotDaPlaca.keys()) if (!placas.has(pl)) placas.set(pl, { pl, tipo: 'van', modelo: '', motorista: '', conferirTipo: true });
    const porPlaca = new Map([...ST.veiculos.values()].filter((v) => v.placa).map((v) => [String(v.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''), v]));
    for (const [pl, o] of placas) {
      const kMot = ultimoMotDaPlaca.get(pl) || RE.norm(o.motorista);
      const motoristaId = idDoMot.get(kMot) || (porNome.get(kMot) || {}).id || '';
      const ex = porPlaca.get(pl);
      if (ex) { await salvar('veiculos', ex.id, Object.assign({}, ex, { motoristaId: ex.motoristaId || motoristaId })); res.atual++; continue; }
      const base = RE.VEICULOS_PADRAO.find((x) => x.tipo === o.tipo);
      const id = o.tipo + '-' + pl.toLowerCase();
      await salvar('veiculos', id, Object.assign({}, base, { id, nome: (o.modelo ? titulo(o.modelo) + ' ' : TIPO[o.tipo] + ' ') + pl, placa: pl, motoristaId, exemplo: false, conferir: true, origem: o.conferirTipo ? 'Placa do Rastreio de carga (tipo a conferir)' : 'Frota do CONSTRULOG', ativo: !o.manut }));
      res.novosV++;
    }
    registrar('Importação do CONSTRULOG', res.novosV + ' veículo(s) e ' + res.novosM + ' motorista(s) novos; ' + res.atual + ' atualizados');
    ui.frotaImp = res; render();
  }
  async function gravarSSW(linhas, fonte) {
    const em = agoraISO();
    for (const id of [...ST.ssw.keys()]) await remover('ssw', id);
    for (let i = 0; i < linhas.length; i += 400) { const id = 'lista-' + String(i / 400 + 1).padStart(2, '0'); await salvar('ssw', id, { id, capturadoEm: em, fonte, linhas: linhas.slice(i, i + 400) }); }
    registrar('SSW', linhas.length + ' CTRC(s) disponíveis carregados (' + fonte + ')');
    toast(linhas.length + ' CTRC(s) carregados.');
    render();
  }

  // ---------------- notas que ficaram no galpão ----------------
  const MOTIVOS = ['Sem veículo de tubo na região', 'Sem van na região', 'Passou o peso', 'Fora do dia de rota da cidade', 'Falta mercadoria', 'Falta a NF ou documento', 'Faltou tempo na rota', 'Cliente fechado ou sem recebedor', 'Cliente pediu para reagendar', 'Cliente recusou a mercadoria', 'Endereço não localizado', 'Mercadoria avariada', 'Restrição de horário ou acesso', 'Problema no veículo', 'Outro'];
  const SEM_REENVIO = ['Cliente recusou a mercadoria', 'Mercadoria avariada'];
  const diasTxt = (c) => { const d = (c && c.dias) || []; const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return 'segunda a sexta'; return d.map((x) => nomes[x]).join(' e ').replace(/ e (?=.* e )/g, ', '); };
  const tokensNF = (q) => String(q || '').split(/[\s,;/]+/).map((t) => t.replace(/\D/g, '')).filter(Boolean);
  function acharNota(t) {
    if (t.length === 44) return ST.notas.get(t) || null;
    const k = String(+t);
    const l = [...ST.notas.values()].filter((n) => String(+String(n.numero || '').replace(/\D/g, '')) === k);
    if (!l.length) return null;
    // várias notas com o mesmo número (emitentes diferentes): prefere a que ainda está em aberto e a mais recente
    l.sort((a, b) => (['entregue', 'cancelada'].includes(a.status) - ['entregue', 'cancelada'].includes(b.status)) || (b.importadoEm || '').localeCompare(a.importadoEm || ''));
    return l[0];
  }
  function rotaDaNota(id, data) {
    const ps = [ST.planos.get(data)].concat([...ST.planos.values()].sort((x, y) => y.data.localeCompare(x.data))).filter(Boolean);
    for (const p of ps) for (const r of p.rotas) if (r.paradas.some((s) => s.notas.includes(id))) return { p, r };
    return null;
  }
  const cargaTxt = (e) => (e.qtdTubos ? 'COM TUBO' : 'SEM TUBO') + (e.pesoKg ? ' · ' + nf(e.pesoKg, 0) + ' kg' : '');
  // motivo provável, para o operador só confirmar
  function motivoSugerido(e, d) {
    const c = ST.cidades.get(e.cidadeId);
    if (c && !(c.dias || []).includes(RE.weekday(d))) return { motivo: 'Fora do dia de rota da cidade', obs: diasTxt(c).toUpperCase() };
    const p = ST.planos.get(d);
    if (e.qtdTubos) {
      const tubVans = ctx().veiculos.filter((v) => v.tipo === 'tubos' && RE.veicDisponivel(v, d));
      if (!tubVans.length || (p && !p.rotas.some((r) => r.veiculoTipo === 'tubos' && r.paradas.some((s) => (ST.cidades.get(s.cidadeId) || {}).regiao === (c || {}).regiao)))) return { motivo: 'Sem veículo de tubo na região', obs: '' };
    }
    if (p) {
      const u = (p.naoRoteirizadas || []).find((x) => x.notas.includes(e.id));
      if (u && /Peso|capacidade/i.test(u.motivo)) return { motivo: 'Passou o peso', obs: '' };
    }
    return null;
  }
  const chegouDe = (n) => n.chegouEm || (n.importadoEm || '').slice(0, 10) || n.emissao || '';
  // situação de uma nota que ficou: manual > SSW (romaneio/baixa) > nota no roteirizador
  const SB_ST = { pendente: ['Pendente', 'warn'], em_rota: ['Em rota', 'info'], entregue: ['Entregue', 'ok'] };
  // sobras que ainda não foram baixadas nem saíram em romaneio (pendentes), de hoje para trás
  const nomeMotorista = (id) => (ST.motoristas.get(id) || {}).nome || '';
  function sobrasAbertas() { const h = hoje(); return [...ST.sobras.values()].filter((x) => x.data && x.data <= h && sobraSituacao(x).st === 'pendente'); }
  // Sobra sem nota no roteirizador (lançada pela planilha ou à mão): vira uma nota, para entrar na programação.
  // Não recria nota excluída (lista de ignoradas) e liga a sobra à nota criada.
  // NF importada por PDF/XML que também veio do SSW: fica uma nota só (a do SSW, com os dados do arquivo)
  async function juntarDuplicadasSSW() {
    if (!ST.admin || ui.juntando) return;
    const ssw = new Map(); for (const o of ST.notas.values()) if (o.origem === 'ssw' && !['entregue', 'cancelada'].includes(o.status)) { const k = nfChave(o.numero); if (k) ssw.set(k, o); }
    const pares = [];
    for (const n of ST.notas.values()) { if (n.origem !== 'pdf' && n.origem !== 'xml') continue; if (['entregue', 'cancelada', 'em_rota', 'roteirizada'].includes(n.status)) continue; const o = ssw.get(nfChave(n.numero)); if (o && !o.chaveNota) pares.push([n, o]); }
    if (!pares.length) return;
    ui.juntando = true;
    try {
      for (const [n, o] of pares) {
        const q = Object.assign({}, o, { chaveNota: n.chave || n.id, destNome: n.destNome || o.destNome, destDoc: n.destDoc || o.destDoc, emitenteDoc: n.emitenteDoc || o.emitenteDoc, itens: (n.itens && n.itens.length) ? n.itens : o.itens, atualizadoEm: agoraISO() });
        if (n.origem === 'xml' && n.endereco && n.endereco.lgr) q.endereco = Object.assign({}, o.endereco, n.endereco);
        if (n.bloqueioUsuario) q.bloqueioUsuario = true;
        await salvar('notas', o.id, q); await remover('notas', n.id);
      }
      registrar('Notas', pares.length + ' nota(s) do PDF/XML juntadas com a mesma NF do SSW'); toast(pares.length + ' nota(s) repetidas (arquivo + SSW) viraram uma só.'); ui.escalaSuja = true;
    } finally { ui.juntando = false; render(); }
  }
  async function notasDasSobras() {
    if (!ST.admin || ui.sbNotas) return;
    const ign = ignoradas(), enr = notasEnr(), it = [], liga = [];
    for (const x of sobrasAbertas()) {
      if (x.notaId && ST.notas.has(x.notaId)) continue;
      const k = nfChave(x.numero);
      if (k && ign[k]) continue;
      const ex = k ? enr.find((n) => nfChave(n.numero) === k) : null;
      if (ex) { if (x.notaId !== ex.id) liga.push({ id: x.id, data: Object.assign({}, x, { notaId: ex.id }) }); continue; }
      // a sobra ainda está nos CTRCs disponíveis do SSW: a nota vem de lá (peso, m³, CTRC e endereço pelo XML)
      const linhaSSW = k ? sswLinhas().find((r) => nfChave(r.nf) === k && !devolvidaSSW(r)) : null;
      if (linhaSSW) { const nid = await criarNotaDeSSW(linhaSSW); liga.push({ id: x.id, data: Object.assign({}, x, { notaId: nid }) }); continue; }
      const cidTxt = String(x.cidade || ''), uf = (cidTxt.match(/\/([A-Z]{2})\s*$/) || [])[1] || 'SP', nome = cidTxt.replace(/\/[A-Z]{2}\s*$/, '').trim();
      const m = munPorTexto(cidTxt) || RE.findMun(null, nome, uf);
      const id = 'sb-' + x.id, carga = String(x.carga || '');
      if (ST.notas.has(id)) { liga.push({ id: x.id, data: Object.assign({}, x, { notaId: id }) }); continue; }
      it.push({ id, data: {
        id, numero: k || String(x.numero || ''), serie: x.serie || '', emitente: x.embarcador || '', destNome: x.cliente || '',
        endereco: { lgr: '', nro: '', bairro: '', cidade: m ? m.nome : nome, uf: m ? m.uf : uf, cep: '', cMun: m ? m.cod : '' },
        pesoB: x.kg > 0 ? +x.kg : null, volM3: null, qVol: null, valorMerc: +x.valor || 0, freteXml: 0, frete: null, prazo: '', itens: [],
        origem: 'sobra', mercadoria: carga, exigeTubo: /TUBO/i.test(carga) && !/SEM\s+TUBO/i.test(carga), obs: 'Sobra de ' + dBR(x.data) + (x.motivo ? ' — ' + x.motivo : ''),
        status: 'pronta', dataMinima: x.dataMin || '', importadoEm: agoraISO(), importadoPor: ST.uid, chegouEm: x.chegou || null,
      } });
      liga.push({ id: x.id, data: Object.assign({}, x, { notaId: id }) });
    }
    if (!it.length && !liga.length) return;
    ui.sbNotas = true;
    try {
      await salvarVarios('notas', it); await salvarVarios('sobras', liga);
      if (it.length) { registrar('Sobras', it.length + ' sobra(s) sem nota viraram notas no roteirizador'); toast(it.length + ' sobra(s) entraram nas notas para a programação.'); ui.escalaSuja = true; }
    } finally { ui.sbNotas = false; render(); }
  }
  function sobraDaParada(st) { let d = ''; for (const id of st.notas || []) { const n = ENR_MAP && ENR_MAP.get(id); if (n && n.sobraDe && (!d || n.sobraDe < d)) d = n.sobraDe; } return d; }
  function sobraSituacao(s) {
    if (s.statusManual) return { st: s.statusManual, em: s.statusManualEm || '', fonte: 'marcado à mão' };
    const n = s.notaId ? ST.notas.get(s.notaId) : null;
    if (n && n.status === 'entregue') return { st: 'entregue', em: n.entregueEm || s.entregueEm || '', fonte: 'roteirizador' };
    if (s.status) return { st: s.status, em: s.status === 'entregue' ? s.entregueEm || '' : s.statusEm || '', fonte: s.statusFonte || 'SSW' };
    return { st: 'pendente', em: '', fonte: '' };
  }
  // fica no quadro até o dia seguinte à entrega
  const sobraVisivel = (s, d) => s.data === d || (s.data < d && !(sobraSituacao(s).st === 'entregue' && (sobraSituacao(s).em || s.data) < d));
  async function sincronizarSobras() {
    if (!window.RC_HOST || !window.RC_HOST.statusNfs || ui.sbSync) return;
    const abertas = [...ST.sobras.values()].filter((s) => s.numero && !s.statusManual && sobraSituacao(s).st !== 'entregue' && s.data >= RE.addDays(hoje(), -20));
    if (!abertas.length) return;
    ui.sbSync = true; ui.sbSyncEm = Date.now();
    try {
      const desde = abertas.map((s) => s.data).sort()[0];
      const j = await window.RC_HOST.statusNfs(abertas.map((s) => s.numero), desde);
      const hojeD = hoje();
      for (const s of abertas) {
        const r = (j.itens || {})[String(s.numero).replace(/\D/g, '').replace(/^0+/, '')];
        if (!r || (r.status === (s.status || 'pendente'))) continue;
        const q = Object.assign({}, s, { status: r.status, statusFonte: r.fonte, statusEm: hojeD });
        if (r.status === 'entregue') q.entregueEm = r.em || hojeD; else delete q.entregueEm;
        await salvar('sobras', s.id, q);
        const n = s.notaId ? ST.notas.get(s.notaId) : null;
        if (n) {
          const ns = r.status === 'entregue' ? 'entregue' : r.status === 'em_rota' ? 'em_rota' : (n.status === 'em_rota' ? 'pronta' : n.status);
          if (ns !== n.status) await salvar('notas', n.id, Object.assign({}, n, { status: ns }, ns === 'entregue' ? { entregueEm: q.entregueEm } : {}));
        }
      }
    } catch (e) { console.warn('situação das sobras', e.message); }
    ui.sbSync = false; render();
  }
  // ---------------- Romaneios emitidos no SSW: km e pontos de entrega de cada um ----------------
  const romChave = (d, r) => d + '|' + r;
  async function carregarRomaneios(forcar) {
    const d = ui.romData || hoje();
    if (!window.RC_HOST || (ui.romLista && ui.romLista.data === d && !forcar) || (ui.romLista && ui.romLista.carregando)) return;
    ui.romLista = { data: d, carregando: true, rows: [] }; render();
    try { const j = await window.RC_HOST.romaneiosDoDia(d); ui.romLista = { data: d, rows: (j.rows || []).filter((x) => x.romaneios && x.romaneios.length) }; }
    catch (e) { ui.romLista = { data: d, rows: [], erro: e.message }; }
    render();
  }
  async function roteirizarRomaneio(rom, abrir) {
    const d = ui.romData || hoje(), k = romChave(d, rom);
    ui.romCache = ui.romCache || {};
    if (abrir) ui.romSel = k;
    if (ui.romCache[k] && (ui.romCache[k].ok || ui.romCache[k].carregando)) { render(); return ui.romCache[k]; }
    ui.romCache[k] = { carregando: true }; render();
    try { const j = await window.RC_HOST.rotaRomaneio(d, rom); ui.romCache[k] = j && j.ok !== false ? Object.assign({ ok: true }, j) : { erro: (j && j.error) || 'Sem resposta' }; }
    catch (e) { ui.romCache[k] = { erro: e.message }; }
    render(); return ui.romCache[k];
  }
  // motorista com mais de um romaneio: uma rota só, com as entregas (e cidades) de todos
  const motChave = (d, g) => d + '|MOT:' + RE.norm(g.motorista) + '|' + g.romaneios.join('+');
  async function roteirizarMotorista(g, abrir) {
    const d = ui.romData || hoje(), k = motChave(d, g);
    ui.romCache = ui.romCache || {};
    if (abrir) ui.romSel = k;
    if (ui.romCache[k] && (ui.romCache[k].ok || ui.romCache[k].carregando)) { render(); return ui.romCache[k]; }
    ui.romCache[k] = { carregando: true }; render();
    try {
      const planos = [];
      for (const r of g.romaneios) { const p = await roteirizarRomaneio(r, false); if (p && p.ok) planos.push(p); }
      if (abrir) ui.romSel = k;
      const vistos = new Set(), stops = [];
      for (const p of planos) for (const s of (p.stops || [])) { const id = (s.ctrc || '') + '|' + (s.nf || '') + '|' + Number(s.lat).toFixed(5) + '|' + Number(s.lon).toFixed(5); if (vistos.has(id)) continue; vistos.add(id); stops.push(s); }
      if (!stops.length) throw new Error('Nenhum dos romaneios tem entregas com localização.');
      const j = await window.RC_HOST.recalcularRota({ date: d, romaneio: g.romaneios.join(' + '), motorista: g.motorista, veiculo: g.veiculo || '', stops: stops.slice(0, 80) });
      ui.romCache[k] = j && j.ok !== false ? Object.assign({ ok: true, romaneios: g.romaneios.slice(), aviso: stops.length > 80 ? 'Rota única com as primeiras 80 entregas.' : '' }, j) : { erro: (j && j.error) || 'Sem resposta' };
    } catch (e) { ui.romCache[k] = { erro: e.message }; }
    render(); return ui.romCache[k];
  }
  // cidades agrupadas, na ordem da rota, com o número de entregas
  const cidadesDe = (pts) => { const m = new Map(); for (const p of pts) { const c = p.cidade || '—'; m.set(c, (m.get(c) || 0) + 1); } return [...m]; };
  async function roteirizarTodos() {
    if (ui.romTodos) return;
    ui.romTodos = true; render();
    for (const g of (ui.romLista && ui.romLista.rows) || []) { if (!ui.romTodos) break; if (g.romaneios.length > 1) await roteirizarMotorista(g, false); else await roteirizarRomaneio(g.romaneios[0], false); }
    ui.romTodos = false; render();
  }
  const kmDe = (x) => x && x.ok ? Math.round((x.optimizedDistanceMeters || 0) / 1000) : null;
  function vRomaneios() {
    const d = ui.romData || hoje();
    let h = topo('Romaneios do dia', 'Romaneios emitidos no SSW, por motorista. Clique num romaneio para roteirizar e ver o km e os pontos de entrega.', false);
    if (!window.RC_HOST) return h + '<div class="card empty"><h3>Disponível dentro do CONSTRULOG</h3></div>';
    if (!ui.romLista || ui.romLista.data !== d) setTimeout(() => carregarRomaneios(false), 30);
    const L = ui.romLista && ui.romLista.data === d ? ui.romLista : { carregando: true, rows: [] };
    const C = ui.romCache || {};
    const nRom = L.rows.reduce((s, g) => s + g.romaneios.length, 0);
    h += '<div class="card"><div class="row"><label class="f" style="max-width:190px">Data<input type="date" id="fRomData" value="' + esc(d) + '"></label>' +
      '<button class="btn" data-a="romAtualizar" style="align-self:flex-end">Atualizar</button>' +
      (nRom ? '<button class="btn pri" data-a="romTodos" style="align-self:flex-end"' + (ui.romTodos ? ' disabled' : '') + '>' + (ui.romTodos ? 'Calculando…' : 'Calcular km de todos') + '</button>' : '') +
      '<span class="spacer"></span><span class="small muted" style="align-self:flex-end">' + (L.carregando ? 'Buscando romaneios no SSW…' : L.erro ? '' : L.rows.length + ' motorista(s) · ' + nRom + ' romaneio(s)') + '</span></div>' +
      (L.erro ? '<div class="note bad" style="margin-top:10px">Não foi possível ler os romaneios: ' + esc(L.erro) + '</div>' : '');
    if (!L.carregando && !L.erro) {
      if (!L.rows.length) h += '<p class="muted small" style="margin-top:12px">Nenhum romaneio emitido em ' + dBR(d) + '.</p>';
      else {
        let tot = 0, totN = 0;
        h += '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Motorista</th><th>Veículo</th><th>Romaneios</th><th>Cidades</th><th class="r">Entregas</th><th class="r">Km</th></tr></thead><tbody>' +
          L.rows.slice().sort((a, b) => (a.motorista || '').localeCompare(b.motorista || '', 'pt-BR')).map((g) => {
            let km = 0, todos = true;
            const bts = g.romaneios.map((r) => { const k = romChave(d, r), x = C[k], q = kmDe(x); if (q == null) todos = false; else km += q;
              return '<button class="btn sm' + (ui.romSel === k ? ' pri' : '') + '" data-a="romVer" data-v="' + esc(r) + '" title="Roteirizar este romaneio">' + esc(r) + (x && x.carregando ? ' …' : q != null ? ' · ' + q + ' km' : x && x.erro ? ' ⚠' : '') + '</button>'; }).join(' ');
            const multi = g.romaneios.length > 1, mk = multi ? motChave(d, g) : null, mx = mk ? C[mk] : null, mkm = kmDe(mx);
            const kmMot = multi ? mkm : (todos ? km : null);
            if (kmMot != null) { tot += kmMot; totN++; }
            const unico = multi ? '<div style="margin-top:6px"><button class="btn sm' + (ui.romSel === mk ? ' pri' : ' go') + '" data-a="romMot" data-v="' + esc(RE.norm(g.motorista)) + '" title="Juntar as entregas dos ' + g.romaneios.length + ' romaneios numa rota só">🧭 Rota única dos ' + g.romaneios.length + ' romaneios' + (mx && mx.carregando ? ' …' : mkm != null ? ' · ' + mkm + ' km' : '') + '</button></div>' : '';
            const fonte = multi ? (mx && mx.ok ? [mx] : g.romaneios.map((r) => C[romChave(d, r)]).filter((x) => x && x.ok)) : g.romaneios.map((r) => C[romChave(d, r)]).filter((x) => x && x.ok);
            const cids = cidadesDe(fonte.flatMap((x) => x.stops || []));
            return '<tr><td><b>' + esc(g.motorista) + '</b></td><td class="small">' + esc(g.veiculo || '—') + '</td><td>' + bts + unico + '</td><td class="small">' + (cids.length ? cids.map(([c, n]) => esc(c) + (n > 1 ? ' <span class="muted">(' + n + ')</span>' : '')).join(', ') : '<span class="muted">—</span>') + '</td><td class="r num">' + (g.entregas ? nf(g.entregas, 0) : '—') + '</td><td class="r num">' + (kmMot != null ? '<b>' + nf(kmMot, 0) + '</b>' + (multi ? '<div class="tiny">rota única</div>' : '') : multi && todos ? nf(km, 0) + '<div class="tiny">soma</div>' : '—') + '</td></tr>';
          }).join('') + '</tbody>' + (totN ? '<tfoot><tr><td colspan="5" class="r small">Km dos ' + totN + ' motorista(s) já calculados</td><td class="r num"><b>' + nf(tot, 0) + '</b></td></tr></tfoot>' : '') + '</table></div>';
      }
    }
    h += '</div>';
    // detalhe do romaneio escolhido
    const sel = ui.romSel && ui.romSel.startsWith(d + '|') ? ui.romSel : null;
    if (sel) {
      const ehMot = sel.includes('|MOT:');
      const rom = ehMot ? sel.slice(sel.lastIndexOf('|') + 1).split('+').join(' + ') : sel.slice(d.length + 1), x = C[sel];
      const g = (ehMot ? L.rows.find((r) => motChave(d, r) === sel) : L.rows.find((r) => r.romaneios.includes(rom))) || {};
      h += '<div class="card"><div class="card-h"><h2>' + (ehMot ? 'Rota única · ' : 'Romaneio ') + esc(rom) + '</h2><span class="small muted">' + esc(g.motorista || x && x.motorista || '') + (g.veiculo ? ' · ' + esc(g.veiculo) : '') + ' · ' + dBR(d) + '</span></div>';
      if (!x || x.carregando) h += '<div class="empty small">Roteirizando as entregas do romaneio… (pode levar alguns segundos)</div>';
      else if (x.erro) h += '<div class="note bad">' + esc(x.erro) + ' <button class="btn sm" data-a="romRefazer" data-v="' + esc(rom) + '">Tentar de novo</button></div>';
      else {
        const ordem = (x.optimizedOrder || []).filter((i) => i > 0).map((i) => x.points[i]).filter(Boolean);
        const pts = ordem.length ? ordem : (x.stops || []);
        const horas = x.durationSeconds ? Math.floor(x.durationSeconds / 3600) + 'h' + String(Math.round(x.durationSeconds % 3600 / 60)).padStart(2, '0') : '—';
        const entregues = pts.filter((p) => p.entregue).length;
        const cids = cidadesDe(pts);
        if (x.aviso) h += '<div class="note warn" style="margin-bottom:10px">' + esc(x.aviso) + '</div>';
        h += '<div class="kpis">' + kpi('Km da rota', nf(kmDe(x), 0), '', 'ida e volta') + kpi('Entregas', pts.length) + kpi('Cidades', cids.length) + kpi('Tempo de direção', horas) + kpi('Entregues', entregues, entregues === pts.length && pts.length ? 'good' : '') + (x.approximateStops ? kpi('Endereço aproximado', x.approximateStops, 'warn') : '') + '</div>';
        const tracado = (x.geometry && x.geometry.coordinates || []).filter((c, i, arr) => arr.length < 1500 || i % Math.ceil(arr.length / 1500) === 0).map((c) => [c[1], c[0]]);
        const porEstrada = tracado.length > 2 && x.matrixSource !== 'estimada';
        const fake = { rotas: [{ veiculoId: 'rom', veiculoNome: 'Romaneio ' + rom, tracado: porEstrada ? tracado : null, paradas: pts.map((p) => ({ lat: p.lat, lon: p.lon, cidadeId: p.cidade || '', cidadeNome: p.cidade || '' })) }], naoRoteirizadas: [], estimativa: !porEstrada };
        if (!porEstrada) h += '<div class="note warn" style="margin-top:10px">O servidor de rotas por estrada não respondeu: o km acima é uma estimativa em linha reta. Clique em Atualizar daqui a pouco para recalcular.</div>';
        h += '<div class="row" style="margin-top:12px;gap:6px">' + cids.map(([c, n]) => '<span class="chip">' + esc(c) + ' · ' + n + '</span>').join('') + '</div>';
        h += '<div style="margin-top:12px">' + mapaHTML(fake, null) + '</div>';
        h += '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>Destinatário</th><th>Cidade</th><th>Endereço</th><th>NF</th><th>CT-e</th><th>Situação</th></tr></thead><tbody>' +
          pts.map((p, i) => '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(p.destinatario || p.label || '') + '</td><td>' + esc(p.cidade || '') + '</td><td class="small">' + esc([p.endereco, p.numero, p.bairro].filter(Boolean).join(', ')) + (p.precision && /aproximado|cidade|cliente/.test(p.precision) ? ' <span class="chip warn">aproximado</span>' : '') + '</td><td class="mono small">' + esc(p.nf || '') + '</td><td class="mono small">' + esc(p.ctrc || '') + '</td><td>' + (p.entregue ? '<span class="chip ok">entregue</span>' : '<span class="chip">a entregar</span>') + '</td></tr>').join('') +
          '</tbody></table></div>' + ((x.rejectedStops || []).length ? '<p class="small" style="margin-top:8px"><span class="chip warn">' + x.rejectedStops.length + '</span> entrega(s) sem localização, fora do cálculo: ' + esc(x.rejectedStops.map((r) => (r.nf ? 'NF ' + r.nf : r.ctrc) + ' (' + (r.reason || '') + ')').join('; ')) + '</p>' : '');
      }
      h += '</div>';
    }
    return h;
  }
  function vSobras() {
    const d = ui.data;
    if (window.RC_HOST && !ui.sbSync && (!ui.sbSyncEm || Date.now() - ui.sbSyncEm > 5 * 60000)) setTimeout(sincronizarSobras, 60);
    const doDia = [...ST.sobras.values()].filter((s) => sobraVisivel(s, d));
    let h = topo('Notas que ficaram', 'Digite o número da NF (ou várias, separadas por espaço): o sistema preenche o resto e sugere o motivo. Elas viram prioridade nas próximas rotas.', true);
    const sb = ui.sb;
    h += '<div class="card"><div class="row"><label class="f" style="flex:1;min-width:200px">NF<input type="text" id="sbNF" inputmode="numeric" autocomplete="off" value="' + esc(sb ? sb.q : '') + '" placeholder="Ex.: 669950 669926"></label><button class="btn pri" data-a="sbBuscar" style="align-self:flex-end">Buscar</button></div>';
    if (sb) {
      const achadas = sb.itens.filter((x) => x.id), doSSW = sb.itens.filter((x) => x.ssw), faltam = sb.itens.filter((x) => !x.id && !x.ssw);
      if (achadas.length) {
        h += '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Embarcador</th><th>Cidade</th><th>Carga</th><th>Chegou</th><th>NF</th><th>Cliente</th><th>Saiu em</th><th>Próxima rota</th></tr></thead><tbody>' + achadas.map((x) => { const e = notaE(x.id); const rr = rotaDaNota(x.id, d); const c = ST.cidades.get(e.cidadeId); const ja = doDia.find((s) => s.notaId === x.id); return '<tr><td class="small">' + esc(e.emitente || '—') + '</td><td>' + esc(e.cidadeNome) + '</td><td class="small">' + esc(cargaTxt(e)) + '</td><td class="mono small">' + dBR(chegouDe(e)) + '</td><td class="mono">' + esc(e.numero) + (ja ? ' <span class="chip warn">já lançada</span>' : '') + '</td><td class="small trunc">' + esc(e.destNome || '') + '</td><td class="small">' + (rr ? esc(rr.r.veiculoNome) + ' · ' + dBR(rr.p.data) : 'não saiu') + '</td><td class="mono small">' + (c ? dBR(RE.proximoDiaPermitido(c, RE.addDays(d, 1))) + ' <span class="tiny">(' + esc(diasTxt(c)) + ')</span>' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      if (doSSW.length) h += '<p class="small" style="margin-top:12px"><span class="chip info">SSW</span> Encontradas nos CTRCs disponíveis para entrega; ao registrar, entram no roteirizador:</p><div class="tbl-wrap"><table><thead><tr><th>Remetente</th><th>Cidade</th><th>Carga</th><th>NF</th><th>CTRC</th><th>Cliente</th><th class="r">Peso kg</th><th>Previsão</th></tr></thead><tbody>' + doSSW.map((x) => '<tr><td class="small">' + esc(x.ssw.remetente) + '</td><td>' + esc(x.ssw.cidade) + '</td><td class="small">' + (/TUBO/i.test((x.ssw.mercadoria || '') + ' ' + (x.ssw.detalhes || '')) ? 'COM TUBO' : 'SEM TUBO') + '</td><td class="mono">' + esc(x.ssw.nf) + '</td><td class="mono small">' + esc(x.ssw.ctrc) + '</td><td class="small trunc">' + esc(x.ssw.cliente) + '</td><td class="r num">' + nf(x.ssw.peso, 0) + '</td><td class="mono small">' + esc(x.ssw.previsao ? dBR(x.ssw.previsao) : '') + '</td></tr>').join('') + '</tbody></table></div>';
      if (faltam.length) h += '<div class="note warn" style="margin-top:10px">Não encontradas nas notas nem nos CTRCs disponíveis do SSW: <b>' + esc(faltam.map((x) => x.t).join(', ')) + '</b>. Preencha abaixo para inserir a nota' + (faltam.length > 1 ? ' (vale para todas)' : '') + '. Com cidade e peso ela entra nas rotas; sem isso, fica registrada só a ocorrência.</div><div style="margin-top:10px">' + campoNotaManual('sb', Object.assign({ semNumero: true }, sb.man || {})) + '</div>';
      h += '<div class="fields" style="margin-top:12px"><label class="f" style="grid-column:span 2">Motivo<select id="sbMotivo">' + MOTIVOS.map((m) => '<option' + (sb.motivo === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label><label class="f" style="grid-column:span 2">Observação<input type="text" id="sbObs" value="' + esc(sb.obs || '') + '" placeholder="Opcional"></label><label class="f">Não entregar antes de<input type="date" id="sbData" value="' + esc(sb.dataMin || '') + '"></label></div>' +
        (sb.sugerido ? '<p class="tiny" style="margin-top:6px">Motivo sugerido pelo sistema: ' + esc(sb.sugerido) + '. Troque se não for o caso.</p>' : '') +
        '<div class="row" style="margin-top:10px"><label class="chk"><input type="checkbox" id="sbReenvio"' + (sb.reenvio === false ? '' : ' checked') + '> Volta como prioridade na próxima rota</label><span class="spacer"></span><button class="btn" data-a="sbLimpar">Cancelar</button><button class="btn go" data-a="sbRegistrar">' + I.check + 'Registrar ' + sb.itens.length + ' nota' + (sb.itens.length > 1 ? 's' : '') + '</button></div><p class="tiny" style="margin-top:6px">Desmarque quando a mercadoria volta ao remetente (recusa, avaria): a nota é encerrada como devolvida.</p>';
    }
    h += '</div>';
    // quadro no formato da planilha: por embarcador, separando "ficou hoje" de "há mais de um dia no galpão"
    const limite = RE.addDays(d, -1);
    const velha = (s) => s.data < d || (s.chegou && s.chegou < limite);
    const antigas = doDia.filter(velha), hojeL = doDia.filter((s) => !velha(s));
    const porMotivo = new Map(); for (const s of doDia) porMotivo.set(s.motivo, (porMotivo.get(s.motivo) || 0) + 1);
    const quadro = (titulo, l) => {
      if (!l.length) return '';
      const g = new Map(); for (const s of l) { const k = s.embarcador || 'Sem embarcador'; if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
      return '<h3 style="margin:14px 0 8px">' + titulo + ' <span class="chip">' + l.length + '</span></h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr))">' + [...g].sort((a, b) => a[0].localeCompare(b[0])).map(([emb, ls]) => '<div class="tbl-wrap"><table><thead><tr><th colspan="7" style="background:var(--brand);color:var(--brand-ink)">' + esc(emb) + ' · ' + ls.length + '</th></tr><tr><th>Cidade</th><th>Carga</th><th>Chegou</th><th>NF</th><th>Motivo</th><th>Situação</th><th></th></tr></thead><tbody>' + ls.sort((a, b) => (a.cidade || '').localeCompare(b.cidade || '')).map((s) => { const n = s.notaId ? notaE(s.notaId) : null; return '<tr><td>' + esc((s.cidade || '').split('/')[0]) + '</td><td class="small">' + esc(s.carga || '') + '</td><td class="mono small">' + dBR(s.chegou) + '</td><td class="mono">' + esc(s.numero) + '</td><td><select data-sbmot="' + esc(s.id) + '" style="min-width:150px">' + MOTIVOS.map((m) => '<option' + (s.motivo === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>' + (s.obs ? '<div class="tiny">' + esc(s.obs) + '</div>' : '') + '</td><td>' + (() => { const si = sobraSituacao(s); return '<select data-sbst="' + esc(s.id) + '" class="sb-st ' + SB_ST[si.st][1] + '" title="' + esc(si.fonte ? 'Origem: ' + si.fonte : '') + '">' + Object.entries(SB_ST).map(([k, v]) => '<option value="' + k + '"' + (si.st === k ? ' selected' : '') + '>' + v[0] + (si.st === k && si.em ? ' ' + dBR(si.em) : '') + '</option>').join('') + '</select>' + (s.statusManual ? ' <button class="btn sm ghost" data-a="sbAuto" data-v="' + esc(s.id) + '" title="Voltar a seguir o SSW">auto</button>' : '') + (!n ? '<div class="tiny">sem nota no roteirizador</div>' : ''); })() + '</td><td><button class="btn sm ghost danger" data-a="sbExcluir" data-v="' + esc(s.id) + '" aria-label="Desfazer lançamento">' + I.x + '</button></td></tr>'; }).join('') + '</tbody></table></div>').join('') + '</div>';
    };
    h += '<div class="card"><div class="card-h"><h2>Ficaram no galpão em ' + dBR(d) + '</h2><span class="chip ' + (doDia.length ? 'warn' : 'ok') + '">' + doDia.length + ' nota(s)' + (doDia.some((s) => s.kg) ? ' · ' + nf(doDia.reduce((s, x) => s + (x.kg || 0), 0), 0) + ' kg' : '') + '</span></div>' +
      (porMotivo.size ? '<div class="row">' + [...porMotivo].sort((x, y) => y[1] - x[1]).map(([m, k]) => '<span class="chip">' + esc(m) + ': ' + k + '</span>').join('') + '</div>' : '') +
      (doDia.length ? quadro('Notas que ficaram hoje', hojeL) + quadro('Há mais de um dia no galpão', antigas) : '<p class="muted small">Nenhuma nota lançada nesta data.</p>') + '</div>';
    // prioridades em aberto
    const pri = notasEnr().filter((n) => n.prioridade && !['entregue', 'cancelada'].includes(n.status));
    h += '<div class="card"><div class="card-h"><h2>Prioridades em aberto</h2><span class="chip ' + (pri.length ? 'bad' : 'ok') + '">' + pri.length + '</span></div>' + (pri.length ? '<p class="small muted" style="margin-bottom:10px">Entram obrigatoriamente no próximo dia de rota da cidade e seguram o veículo mesmo abaixo do mínimo de entregas.</p><div class="tbl-wrap"><table><thead><tr><th>NF</th><th>Embarcador</th><th>Cidade</th><th>Chegou</th><th>Ficou em</th><th>Motivo</th><th>Vezes</th><th>Próxima rota</th><th>Situação</th></tr></thead><tbody>' + pri.sort((x, y) => (chegouDe(x)).localeCompare(chegouDe(y))).map((n) => { const oc = n.ocorrencias || []; const u = oc[oc.length - 1] || {}; const c = ST.cidades.get(n.cidadeId); const prox = c ? RE.proximoDiaPermitido(c, n.dataMinima && n.dataMinima > hoje() ? n.dataMinima : RE.addDays(hoje(), 1)) : null; return '<tr class="click" data-a="nota" data-v="' + esc(n.id) + '"><td class="mono">' + esc(n.numero) + '</td><td class="small">' + esc(n.emitente || '') + '</td><td>' + esc(n.cidadeNome) + '</td><td class="mono small">' + dBR(chegouDe(n)) + '</td><td class="mono small">' + dBR(n.prioridadeDesde) + '</td><td class="small">' + esc(u.motivo || '') + '</td><td class="num">' + oc.length + (oc.length > 1 ? ' <span class="chip bad">reincidente</span>' : '') + '</td><td class="mono small">' + dBR(n.status === 'roteirizada' ? n.planoData : prox) + '</td><td>' + chipStatus(n) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted small">Nenhuma nota aguardando reentrega.</p>') + '</div>';
    const embs = [...new Set([...ST.notas.values()].map((n) => n.emitente).concat([...ST.sobras.values()].map((s) => s.embarcador)).filter(Boolean))].sort();
    h += '<datalist id="dlEmb">' + embs.map((e) => '<option value="' + esc(e) + '">').join('') + '</datalist>';
    return h;
  }
  function buscarSobra() {
    const q = ($('#sbNF') || {}).value || '';
    const ts = tokensNF(q);
    if (!ts.length) return;
    const itens = ts.map((t) => { const n = acharNota(t); if (n) return { t, id: n.id }; const r = acharSSW(t); return r ? { t, ssw: r } : { t }; });
    const primeira = itens.find((x) => x.id);
    const sug = primeira ? motivoSugerido(notaE(primeira.id), ui.data) : null;
    const m = sug ? sug.motivo : MOTIVOS[0];
    ui.sb = { q: q.trim(), itens, motivo: m, obs: sug ? sug.obs : '', sugerido: sug ? sug.motivo : '', reenvio: !SEM_REENVIO.includes(m) };
    render();
    const s = $('#sbMotivo'); if (s) s.focus();
  }
  async function registrarSobra() {
    const sb = ui.sb; if (!sb) return;
    const d = ui.data;
    const motivo = ($('#sbMotivo') || {}).value || 'Outro', obs = (($('#sbObs') || {}).value || '').trim();
    const reenvio = $('#sbReenvio') ? $('#sbReenvio').checked : true, dataMin = ($('#sbData') || {}).value || null;
    let k = 0;
    // notas do SSW e inserções manuais viram notas do roteirizador antes do registro
    for (const x of sb.itens) {
      if (x.ssw) x.id = await criarNotaDeSSW(x.ssw);
      else if (!x.id) {
        const f = lerNotaManual('sb');
        if ((munPorTexto(f.cidade) || RE.findMun(null, f.cidade, 'SP')) && f.peso) x.id = await criarNotaManual(Object.assign({}, f, { numero: x.t }));
      }
    }
    for (const x of sb.itens) {
      if (x.id) {
        const n = ST.notas.get(x.id), e = notaE(x.id);
        const rr = rotaDaNota(x.id, d);
        const mot = rr && rr.r.motoristaId ? (ST.motoristas.get(rr.r.motoristaId) || {}).nome : '';
        const id = d + '_' + n.id;
        await salvar('sobras', id, { id, data: d, notaId: n.id, numero: n.numero, serie: n.serie || '', embarcador: n.emitente || '', cliente: n.destNome || '', cidade: e.cidadeNome, carga: cargaTxt(e), chegou: chegouDe(e), kg: e.pesoKg, valor: n.valorMerc || 0, veiculo: rr ? rr.r.veiculoNome + (rr.r.placa ? ' ' + rr.r.placa : '') : '', motorista: mot || '', motivo, obs, reenvio, dataMin, em: agoraISO(), por: ST.uid });
        const oc = (n.ocorrencias || []).filter((o) => o.data !== d).concat([{ data: d, motivo, obs }]);
        const q = Object.assign({}, n, { ocorrencias: oc, planoData: null });
        if (reenvio) Object.assign(q, { status: 'pronta', prioridade: true, prioridadeDesde: n.prioridade ? n.prioridadeDesde || d : d, dataMinima: dataMin });
        else Object.assign(q, { status: 'cancelada', prioridade: false, canceladaEm: agoraISO(), motivoCancel: 'Devolvida: ' + motivo });
        await salvar('notas', n.id, q);
      } else {
        const id = d + '_nf' + x.t;
        const f = lerNotaManual('sb');
        const m = munPorTexto(f.cidade) || RE.findMun(null, f.cidade, 'SP');
        await salvar('sobras', id, { id, data: d, notaId: null, numero: x.t, embarcador: f.emitente, cliente: f.cliente, cidade: m ? m.nome + '/' + m.uf : f.cidade, carga: f.carga || (f.tubo ? 'COM TUBO' : ''), chegou: f.chegou || '', kg: f.peso, motivo, obs, reenvio: false, em: agoraISO(), por: ST.uid });
      }
      k++;
    }
    registrar('Notas que ficaram', k + ' nota(s): ' + sb.itens.map((x) => x.t).join(', ') + ' (' + motivo + ')');
    toast(k + ' nota(s) registrada(s)' + (reenvio && sb.itens.some((x) => x.id) ? ' e marcadas como prioridade.' : '.'));
    ui.sb = null; render();
    setTimeout(() => { const i = $('#sbNF'); if (i) i.focus(); }, 30);
  }

  function vRotas() {
    const p = plano();
    const combos = ST.cfg.combos || [];
    let h = topo('Rotas', 'Seleção de veículos, sequência das entregas e resultado financeiro', true);
    if (!ST.notas.size) return h + vVazio();
    h += '<div class="card"><div class="row"><button class="btn go" data-a="otimizar"' + (ui.calc ? ' disabled' : '') + '>' + I.play + (p ? 'Otimizar de novo' : 'Otimizar') + '</button>' +
      (p ? '<button class="btn" data-a="encaixar"' + (ui.calc ? ' disabled' : '') + ' title="Mantém as rotas atuais e encaixa as notas novas">Encaixar novas notas</button>' : '') +
      '<button class="btn" data-a="cenarios"' + (ui.calc ? ' disabled' : '') + '>Comparar cenários</button>' +
      '<label class="chk"><input type="checkbox" id="fConsol"' + (ST.cfg.consolidar ? ' checked' : '') + (ST.admin ? '' : ' disabled') + '> Só sair veículo com entrega no limite do prazo</label>' +
      (combos.length ? '<label class="f" style="flex-direction:row;align-items:center;gap:6px">Cidades<select id="fCombo"><option value="">Todas</option>' + combos.map((c) => '<option value="' + esc(c.id) + '"' + (ui.filtroCombo === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>').join('') + '</select></label>' : '') +
      '<span class="spacer"></span>' + (p ? (p.status === 'aprovado' ? '<span class="chip ok">Aprovado</span><button class="btn sm" data-a="desaprovar">Voltar a rascunho</button>' : '<button class="btn pri" data-a="aprovar">' + I.check + 'Aprovar plano</button>') : '') + '</div>' +
      (ui.confirmar && ui.confirmar.a === 'aprovarMin' && p ? '<div class="confirm"><span class="small">' + esc(p.rotas.filter((r) => r.minEntregas && r.paradas.length < r.minEntregas).map((r) => r.veiculoNome + ' tem ' + r.paradas.length + ' de ' + r.minEntregas).join('; ')) + ' entregas, sem entrega no limite do prazo. Aprovar mesmo assim?</span><span class="spacer"></span><button class="btn sm" data-a="cancelarConf">Voltar</button><button class="btn sm danger" data-a="aprovar">Aprovar abaixo do mínimo</button></div>' : '') +
      (ui.calc ? '<div class="note" style="margin-top:12px">' + esc(ui.calc) + '</div>' : '') + '</div>';
    if (ui.cenarios && ui.cenarios.data === ui.data) h += vCenarios(ui.cenarios.lista);
    else if (p && p.cenarios) h += vCenarios(p.cenarios);
    if (!p) {
      const { notas } = RE.elegiveis(notasEnr(), ui.data, ctx(), filtroCidades());
      return h + '<div class="card empty"><h3>Sem plano para ' + dBR(ui.data) + '</h3><p>' + notas.length + ' nota(s) liberadas nesta data pelos dias de rota das cidades. Clique em Otimizar.</p></div>';
    }
    const fr = frescor(p);
    if (fr && (fr.novas.length || fr.canceladas.length)) h += '<div class="note warn" style="margin-top:14px">Desde o cálculo: ' + (fr.novas.length ? '<b>' + fr.novas.length + ' nota(s) nova(s)</b> liberada(s) para esta data' : '') + (fr.novas.length && fr.canceladas.length ? ' e ' : '') + (fr.canceladas.length ? '<b>' + fr.canceladas.length + ' cancelada(s)</b> ainda no plano' : '') + '. Use “Encaixar novas notas” para manter as rotas atuais ou “Otimizar de novo” para refazer tudo.</div>';
    if (p.substituiuAprovado && p.status !== 'aprovado') h += '<div class="note warn" style="margin-top:14px">Este rascunho substituiu um plano aprovado. As notas voltaram a “Pronta” até a nova aprovação.</div>';
    const t = p.totais;
    h += '<div class="kpis" style="margin-top:14px">' + kpi('Veículos', t.veiculos, '', 'de ' + p.veiculosDisponiveis) + kpi('Entregas', t.entregas, '', t.notas + ' NF') + kpi('Km', nf(t.km, 0)) + kpi('Receita', brl(t.receita)) + kpi('Custo', brl(t.custo)) + kpi('Lucro', brl(t.lucro), t.lucro >= 0 ? 'good' : 'bad', t.margem != null ? nf(t.margem, 1) + '%' : '') + '</div>';
    if (p.estimativa) h += '<p class="tiny" style="margin-top:8px">Rota estimada: distâncias em linha reta × fator ' + nf(ST.cfg.fatorRodoviario, 2) + ', velocidade média ' + ST.cfg.velocidadeMedia + ' km/h e posição pelo centro da cidade onde o cliente não tem coordenada confirmada. Pedágios conforme o cadastro das cidades.</p>';
    h += '<div class="split" style="margin-top:14px"><div>' + p.rotas.map((r) => vRota(p, r)).join('') + (p.rotas.length ? '' : '<div class="card empty"><h3>Nenhuma rota</h3><p>Nenhuma entrega coube na frota disponível ou nenhuma nota está liberada.</p></div>') + vFora(p) + '</div><div class="stack"><div class="card">' + mapaHTML(p, ui.mapaFoco) + (p.rotas.length > 1 ? '<div class="row" style="margin-top:10px"><span class="small muted">Mostrar</span><select id="fFoco"><option value="">Todas as rotas</option>' + p.rotas.map((r) => '<option value="' + esc(r.veiculoId) + '"' + (ui.mapaFoco === r.veiculoId ? ' selected' : '') + '>' + esc(r.veiculoNome) + '</option>').join('') + '</select></div>' : '') + '</div>' +
      '<div class="card"><details' + ((p.decisoes || []).length ? ' open' : '') + '><summary>Auditoria das decisões (' + ((p.decisoes || []).length + 2) + ')</summary><ul class="small" style="margin-top:8px;padding-left:18px">' + '<li>' + p.veiculosDisponiveis + ' veículo(s) disponível(is) em ' + dBR(p.data) + '; ' + (p.opcoes && p.opcoes.consolidar ? 'veículos só saem com entrega no limite do prazo.' : 'entregas liberadas saem assim que houver veículo.') + '</li><li>Cálculo em ' + nf((p.tempoMs || 0) / 1000, 1) + ' s; versão ' + (p.versao || 1) + (p.editadoManual ? ', com edições manuais' : '') + '.</li>' + (p.decisoes || []).map((d) => '<li>' + esc(d) + '</li>').join('') + (p.historico || []).map((x) => '<li class="muted">Versão ' + x.versao + ' (' + x.status + '): ' + (x.totais ? x.totais.veiculos + ' veículo(s), lucro ' + brl(x.totais.lucro) : '') + '</li>').join('') + '</ul></details></div></div></div>';
    return h;
  }
  function vCenarios(lista) {
    if (!lista || !lista.length) return '';
    const m = lista[0];
    return '<div class="card"><div class="card-h"><h2>Cenários de frota</h2></div><div class="note ok small"><b>' + esc(m.nome) + '.</b> ' + esc(m.porque || '') + (m.comparacao && m.comparacao.length ? '<ul style="margin:6px 0 0;padding-left:18px">' + m.comparacao.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' : '') + '</div><div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Cenário</th><th class="r">Veículos</th><th class="r">Entregas</th><th class="r">Sem rota</th><th class="r">Km</th><th class="r">Receita</th><th class="r">Custo</th><th class="r">Lucro</th><th class="r">Margem</th></tr></thead><tbody>' +
      lista.map((c) => '<tr' + (c.melhor ? ' style="background:var(--ok-soft)"' : '') + '><td><b>' + esc(c.nome) + '</b><div class="tiny">' + esc(c.frota.join(', ')) + '</div></td><td class="r num">' + c.veiculos + '</td><td class="r num">' + c.entregas + '</td><td class="r num' + (c.obrigFora ? ' neg' : '') + '">' + c.foraTotal + (c.obrigFora ? ' (' + c.obrigFora + ' obrig.)' : '') + '</td><td class="r num">' + nf(c.km, 0) + '</td><td class="r num">' + brl(c.receita) + '</td><td class="r num">' + brl(c.custo) + '</td><td class="r num ' + (c.lucro >= 0 ? 'pos' : 'neg') + '">' + brl(c.lucro) + '</td><td class="r num">' + (c.margem != null ? nf(c.margem, 1) + '%' : '—') + '</td></tr>').join('') + '</tbody></table></div><p class="tiny" style="margin-top:6px">Ordem: atende as obrigatórias, depois mais entregas, depois maior lucro, depois menos veículos. Cada cenário usa só os veículos indicados.</p></div>';
  }
  const barra = (v) => '<span class="bar"><i class="' + (v > 1 ? 'over' : v > 0.9 ? 'hi' : '') + '" style="width:' + Math.min(100, Math.round(v * 100)) + '%"></i></span>';
  function vRota(p, r) {
    const cor = corRota(p, r.veiculoId);
    const outros = ctx().veiculos.filter((v) => v.id !== r.veiculoId && RE.veicDisponivel(v, p.data));
    const mots = [...ST.motoristas.values()].filter((m) => motDisp(m, p.data) || m.id === r.motoristaId).sort((x, y) => (x.nome || '').localeCompare(y.nome || ''));
    const opMover = (key) => '<select class="mv" data-de="' + esc(r.veiculoId) + '" data-key="' + esc(key) + '" aria-label="Mover para"><option value="">Mover…</option>' + outros.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.nome) + '</option>').join('') + '<option value="fora">Tirar da rota</option></select>';
    let h = '<div class="vcard"><div class="vhead"><span class="sw" style="background:' + cor + '"></span><div>' + (r.motoristaId && nomeMotorista(r.motoristaId) ? '<h3>' + esc(nomeMotorista(r.motoristaId)) + '</h3><div class="small"><b>' + esc(r.veiculoNome) + '</b> · ' + TIPO[r.veiculoTipo] + '</div>' : '<div class="tiny muted">Sem motorista</div><h3>' + esc(r.veiculoNome) + '</h3><div class="tiny">' + TIPO[r.veiculoTipo] + '</div>') + '</div>' + (r.placa ? '<span class="plate">' + esc(r.placa) + '</span>' : '') +
      '<select data-motorista="' + esc(r.veiculoId) + '" aria-label="Motorista" style="width:auto"><option value="">Motorista…</option>' + mots.map((m) => '<option value="' + esc(m.id) + '"' + (r.motoristaId === m.id ? ' selected' : '') + '>' + esc(m.nome) + '</option>').join('') + '</select>' +
      '<span class="small">Carro: ' + selTrocaCarro(p, r) + '</span>' +
      (r.minEntregas ? '<span class="chip ' + (r.paradas.length < r.minEntregas ? 'bad' : 'ok') + '" title="Mínimo de entregas por veículo">' + r.paradas.length + '/' + r.minEntregas + ' entregas' + (r.paradas.length < r.minEntregas ? ' · abaixo do mínimo' : '') + '</span>' : '') +
      '<span class="spacer"></span><div class="vstats"><span>Peso ' + barra(r.ocupPeso) + ' <b>' + pct(r.ocupPeso) + '</b></span><span>Volume ' + barra(r.ocupVol) + ' <b>' + pct(r.ocupVol) + '</b></span><span><b>' + nf(r.km, 0) + '</b> km</span><span><b>' + nf(r.horas, 1) + '</b> h · volta ' + r.retorno + '</span></div></div>';
    if (!r.ok) h += '<div class="note bad small" style="margin:10px 14px 0">' + esc(r.motivos.join(' · ')) + '</div>';
    h += '<ol class="stops">' + r.paradas.map((s, i) => '<li class="stop' + (s.travada ? ' locked' : '') + '"><span class="seq" style="background:' + cor + '">' + (i + 1) + '</span><div><div class="who">' + (cliDaParada(s) ? cliChip(cliDaParada(s)) + ' ' : '') + esc(s.dest) + (s.entregue ? ' <span class="chip ok">entregue</span>' : '') + (sobraDaParada(s) ? ' <span class="chip warn" title="Sobra ainda não baixada">sobra de ' + dBR(sobraDaParada(s)) + '</span>' : '') + (s.prioridade ? ' <span class="chip bad">prioridade</span>' : s.atrasada ? ' <span class="chip bad">atrasada</span>' : s.obrigatoria ? ' <span class="chip warn">prazo</span>' : '') + (s.coordFonte !== 'confirmada' ? ' <span class="chip" title="Sem coordenada confirmada do cliente: usa o centro da cidade">aprox.</span>' : '') + '</div><div class="meta"><span>' + esc(s.cidadeNome) + '</span><span class="mono">' + esc(s.chegada) + '–' + esc(s.saida) + '</span><span>NF ' + esc(nfsTxt(s.notas)) + '</span><span class="mono">' + nf(s.kg, 0) + ' kg · ' + nf(s.m3, 2) + ' m³' + (s.qtdTubos ? ' · ' + s.qtdTubos + ' tubos' : '') + '</span><span class="mono">' + brl(s.receita) + '</span></div></div>' +
      '<div class="act"><button class="btn ic sm" data-a="subir" data-v="' + esc(r.veiculoId) + '" data-i="' + i + '" aria-label="Antecipar"' + (i === 0 ? ' disabled' : '') + '>' + I.up + '</button><button class="btn ic sm" data-a="descer" data-v="' + esc(r.veiculoId) + '" data-i="' + i + '" aria-label="Adiar"' + (i === r.paradas.length - 1 ? ' disabled' : '') + '>' + I.down + '</button><button class="btn ic sm" data-a="travar" data-v="' + esc(r.veiculoId) + '" data-key="' + esc(s.key) + '" aria-label="' + (s.travada ? 'Destravar' : 'Travar neste veículo') + '" title="' + (s.travada ? 'Travada neste veículo' : 'Travar neste veículo') + '">' + (s.travada ? I.lock : I.unlock) + '</button>' + opMover(s.key) + (p.status === 'aprovado' && !s.entregue ? '<button class="btn sm" data-a="entregar" data-v="' + esc(r.veiculoId) + '" data-key="' + esc(s.key) + '">' + I.check + 'Entregue</button>' : '') + '</div></li>').join('') + '</ol>';
    h += '<div class="vfoot money"><span>Frete <b>' + brl(r.receita) + '</b></span><span>Motorista <b>' + brl(r.custo.motorista) + '</b>' + (r.pagamento ? ' <span class="tiny muted">(' + esc(r.pagamento.regiao) + (r.pagamento.regra !== 'fixo' ? ', ' + esc(r.pagamento.regra) : '') + ')</span>' : '') + '</span><span><b>' + nf(r.km, 0) + '</b> km</span><span>Margem <b class="' + (r.margem == null || r.margem >= 0 ? 'pos' : 'neg') + '">' + (r.margem != null ? nf(r.margem, 1) + '%' : '—') + '</b></span><span title="' + esc('Veículo ' + brl(r.custo.veiculo) + ' · motorista ' + brl(r.custo.motorista) + ' · ajudante ' + brl(r.custo.ajudante) + ' · combustível ' + brl(r.custo.combustivel) + ' · pedágio ' + brl(r.custo.pedagio) + ' · manutenção ' + brl(r.custo.manutencao) + ' · extras ' + brl(r.custo.extras)) + '">Custo <b>' + brl(r.custo.total) + '</b> <span class="tiny">(combustível ' + brl(r.custo.combustivel) + ', pedágio ' + brl(r.custo.pedagio) + ')</span></span><span>Lucro <b class="' + (r.lucro >= 0 ? 'pos' : 'neg') + '">' + brl(r.lucro) + '</b>' + (r.margem != null ? ' · ' + nf(r.margem, 1) + '%' : '') + '</span><span>Por entrega <b>' + brl(r.custoPorEntrega) + '</b></span><span>Por km <b>' + brl(r.custoPorKm) + '</b></span>' +
      '<label class="row small">Despesas extras R$ <input type="number" step="0.01" min="0" data-extras="' + esc(r.veiculoId) + '" value="' + (r.custo.extras || '') + '" style="width:90px"></label><span class="spacer"></span><a class="btn sm" href="' + esc(linksMaps(r)[0]) + '" target="_blank" rel="noopener">' + I.map + 'Google Maps</a><a class="btn sm" href="' + esc(linkWhats(r, p)) + '" target="_blank" rel="noopener">' + I.wa + 'WhatsApp</a><button class="btn sm" data-a="verCarga" data-v="' + esc(r.veiculoId) + '">' + I.carga + 'Carga</button></div></div>';
    return h;
  }
  function vFora(p) {
    const f = p.naoRoteirizadas || [];
    if (!f.length) return '';
    const vs = ctx().veiculos.filter((v) => RE.veicDisponivel(v, p.data));
    return '<div class="card" style="margin-top:12px"><div class="card-h"><h2>Sem rota nesta data</h2><span class="chip ' + (f.some((x) => x.obrigatoria) ? 'bad' : 'warn') + '">' + f.length + '</span></div><div class="tbl-wrap"><table><thead><tr><th>Destinatário</th><th>NF</th><th>Motivo</th><th></th></tr></thead><tbody>' +
      f.map((u) => '<tr><td><b>' + esc(u.dest) + '</b><div class="tiny">' + esc(u.cidadeNome) + '</div></td><td class="mono small">' + esc(nfsTxt(u.notas)) + '</td><td class="small">' + (u.prioridade ? '<span class="chip bad">prioridade</span> ' : u.atrasada ? '<span class="chip bad">atrasada</span> ' : u.obrigatoria ? '<span class="chip warn">prazo</span> ' : '') + esc(u.motivo) + '</td><td><select class="mv" data-de="fora" data-key="' + esc(u.key) + '" aria-label="Incluir em"><option value="">Incluir em…</option>' + vs.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.nome) + '</option>').join('') + '</select></td></tr>').join('') + '</tbody></table></div></div>';
  }

  function vCarga() {
    const p = plano();
    let h = topo('Carregamento', 'Disposição sugerida, encaixe de tubos e ordem de carga', true);
    if (!p || !p.rotas.length) return h + '<div class="card empty"><h3>Sem rotas em ' + dBR(ui.data) + '</h3><p>Otimize as rotas desta data na tela Rotas.</p></div>';
    if (!ui.cargaVeic || !p.rotas.some((r) => r.veiculoId === ui.cargaVeic)) ui.cargaVeic = p.rotas[0].veiculoId;
    const r = p.rotas.find((x) => x.veiculoId === ui.cargaVeic);
    const v = veic(r.veiculoId) || {};
    h += '<div class="tabs" role="tablist">' + p.rotas.map((x) => '<button role="tab" aria-selected="' + (x.veiculoId === r.veiculoId) + '" data-a="cargaVeic" data-v="' + esc(x.veiculoId) + '">' + (x.motoristaId && nomeMotorista(x.motoristaId) ? '<span style="display:block;line-height:1.15"><b>' + esc(nomeMotorista(x.motoristaId)) + '</b><br><span class="tiny">' + esc(x.veiculoNome) + '</span></span>' : esc(x.veiculoNome)) + '</button>').join('') + '</div>';
    const bau = bauSVG(r);
    h += '<div class="kpis">' + kpi('Peso', nf(r.kg, 0), r.ocupPeso > 1 ? 'bad' : '', 'de ' + v.capKg + ' kg') + kpi('Ocupação peso', pct(r.ocupPeso)) + kpi('Volume solto', nf(r.m3Outros, 2), '', 'm³') + kpi('Espaço útil', nf(r.m3Livre, 2), '', 'm³') + kpi('Ocupação volume', pct(r.ocupVol), r.ocupVol > 1 ? 'bad' : '') + kpi('Tubos', r.tubos ? r.tubos.total : 0, '', r.tubos ? r.tubos.encaixados + ' encaixados' : '') + '</div>';
    if (!r.cargaOk) h += '<div class="note bad" style="margin-top:12px">' + esc(r.motivosCarga.join(' · ')) + '</div>';
    h += '<div class="card cargo" style="margin-top:14px"><div class="card-h"><h2>Baú visto de cima</h2><span class="small ' + (bau.cgPct > 0.7 || bau.cgPct < 0.2 ? 'neg' : 'muted') + '">' + (bau.cgPct > 0.7 ? 'Carga concentrada perto da porta: puxe os volumes pesados para a frente' : bau.cgPct < 0.2 ? 'Carga concentrada junto à cabine: confira o limite do eixo dianteiro' : 'Distribuição de peso equilibrada') + '</span></div>' + bau.svg + '</div>';
    if (r.tubos && r.tubos.colunas.length) {
      const conj = r.tubos.colunas.filter((c) => c.f.length);
      h += '<div class="split" style="margin-top:14px"><div class="card cargo"><div class="card-h"><h2>Seção dos tubos</h2><span class="chip info">' + pct(r.tubos.ocupSecao) + ' da seção</span></div>' + secaoSVG(r) + '<p class="tiny">Cores por parada. Círculos internos são tubos encaixados; a linha tracejada marca a altura usada (' + r.tubos.alturaMm + ' mm). Encaixes respeitam folga de ' + ST.cfg.folgaEncaixeMm + ' mm, até ' + ST.cfg.niveisEncaixe + ' níveis, carga interna de até ' + ST.cfg.cargaInternaKgM + ' kg/m e só põem dentro tubos que saem antes ou junto do hospedeiro.</p></div>' +
        '<div class="card"><h2>Conjuntos encaixados</h2>' + (conj.length ? '<ul class="small scroll-list" style="padding-left:18px;margin-top:10px">' + conj.map((c) => { const lst = []; const walk = (x, d) => { for (const f of x.f) { lst.push('&nbsp;'.repeat(d * 3) + '↳ ' + f.n + '× Ø' + f.de + ' ' + esc((f.rot || '').slice(0, 40)) + ' (parada ' + (corParada(r, f.parada).i + 1) + ')'); walk(f, d + 1); } }; walk(c, 0); return '<li style="margin-bottom:8px"><b>' + c.n + '× Ø' + c.de + '</b> ' + esc((c.rot || '').slice(0, 44)) + ' (parada ' + (corParada(r, c.parada).i + 1) + ')<br>' + lst.join('<br>') + '</li>'; }).join('') + '</ul>' : '<p class="muted small" style="margin-top:8px">Nenhum encaixe possível com as dimensões e regras atuais.</p>') + '</div></div>';
    }
    h += '<div class="card" style="margin-top:14px"><h2>Ordem de carregamento</h2><ol class="small" style="margin-top:10px;padding-left:20px">' + r.paradas.slice().reverse().map((s) => { const i = r.paradas.indexOf(s); return '<li style="margin-bottom:4px"><b style="color:' + COR[i % COR.length] + '">Parada ' + (i + 1) + '</b> · ' + esc(s.dest) + ' · NF ' + esc(nfsTxt(s.notas)) + ' · ' + nf(s.kg, 0) + ' kg' + (s.qtdTubos ? ' · ' + s.qtdTubos + ' tubos' : '') + '</li>'; }).join('') + '</ol><p class="tiny">Carregue de cima para baixo nesta lista: a primeira entrega fica junto à porta. Tubos encaixados entram já montados no conjunto e saem antes do hospedeiro.</p></div>';
    return h;
  }

  const planoOuVazio = () => plano() || { data: ui.data, rotas: [], naoRoteirizadas: [], status: 'sem plano', totais: RE.totais([]), decisoes: [] };
  function vRel() {
    let p = plano();
    let h = topo('Relatórios', 'Romaneio, manifesto, ocupação, tubos, lucratividade e mais', true);
    const semPlano = !p;
    if (!p) p = { data: ui.data, rotas: [], naoRoteirizadas: [], status: 'sem plano', totais: RE.totais([]), decisoes: [] };
    h += '<div class="card"><div class="row"><select id="fRel" style="width:auto">' + RELS.map(([k, t]) => '<option value="' + k + '"' + (ui.relTipo === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select><span class="spacer"></span><button class="btn" data-a="pdf">' + I.dl + 'PDF deste relatório</button><button class="btn pri" data-a="xlsx">' + I.dl + 'Excel com todos</button></div>' +
      (semPlano ? '<p class="small muted" style="margin-top:8px">Sem plano de rotas em ' + dBR(ui.data) + ': os relatórios de rota saem vazios; “Notas que ficaram” funciona normalmente.</p>' : '') +
      (p.rotas.length ? '<div class="row" style="margin-top:10px"><span class="small muted">Enviar rota por WhatsApp:</span>' + p.rotas.map((r) => '<a class="btn sm" href="' + esc(linkWhats(r, p)) + '" target="_blank" rel="noopener">' + I.wa + esc(r.veiculoNome) + '</a>').join('') + '</div>' : '') + '</div>';
    h += '<div class="card">' + relHTML(relatorio(ui.relTipo, p)) + (ui.relTipo === 'mapa' ? '<div style="margin-top:14px">' + mapaHTML(p, null) + '</div>' : '') + '</div>';
    return h;
  }

  // ---------------- cadastros ----------------
  const dis = () => (ST.admin ? '' : ' disabled');
  function campo(col, id, k, t, v, ty, opts) {
    opts = opts || {};
    const bind = 'data-bind="' + col + '|' + esc(id) + '|' + k + '"';
    if (ty === 'sel') return '<label class="f">' + t + '<select ' + bind + (opts.dis ? ' disabled' : '') + '>' + opts.op.map(([a, b]) => '<option value="' + esc(a) + '"' + (String(v == null ? '' : v) === String(a) ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select></label>';
    if (ty === 'bool') return '<label class="chk"><input type="checkbox" ' + bind + ' data-t="bool"' + (v ? ' checked' : '') + (opts.dis ? ' disabled' : '') + '> ' + t + '</label>';
    return '<label class="f">' + t + '<input type="' + (ty === 'num' ? 'number' : ty || 'text') + '" ' + bind + (ty === 'num' ? ' data-t="num" step="any"' : '') + ' value="' + esc(v == null ? '' : v) + '"' + (opts.dis ? ' disabled' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '></label>';
  }
  function vCad() {
    let h = topo('Cadastros', ST.admin ? 'Frota, motoristas, cidades atendidas, produtos e clientes' : 'Veículos, motoristas e cidades só podem ser alterados por administradores');
    const T = [['veiculos', 'Veículos'], ['motoristas', 'Motoristas'], ['cidades', 'Cidades e dias de rota'], ['produtos', 'Produtos'], ['clientes', 'Clientes'], ['combos', 'Combinações de cidades']];
    h += '<div class="tabs" role="tablist">' + T.map(([k, t]) => '<button role="tab" aria-selected="' + (ui.cadTab === k) + '" data-a="cadTab" data-v="' + k + '">' + t + '</button>').join('') + '</div>';
    const d = !ST.admin;
    if (window.RC_HOST && ST.admin && (ui.cadTab === 'veiculos' || ui.cadTab === 'motoristas')) {
      const fi = ui.frotaImp;
      h += '<div class="card" style="margin-bottom:14px"><div class="row"><div style="flex:1;min-width:240px"><b>Frota e Rastreio de carga do CONSTRULOG</b><div class="small muted">Traz as placas da tela Frota e os motoristas que rodaram nos últimos 30 dias, com telefone e última placa usada. Capacidade e medidas entram com o padrão do tipo, marcadas para conferir.</div></div><button class="btn pri" data-a="importarFrota"' + (fi && fi.carregando ? ' disabled' : '') + '>' + (fi && fi.carregando ? 'Lendo o CONSTRULOG…' : 'Importar agora') + '</button></div>' +
        (fi && !fi.carregando ? '<div class="note ' + (fi.avisos.length ? 'warn' : 'ok') + ' small" style="margin-top:10px">' + fi.novosV + ' veículo(s) e ' + fi.novosM + ' motorista(s) novos, ' + fi.atual + ' atualizado(s).' + (fi.avisos.length ? ' ' + esc(fi.avisos.join(' · ')) : '') + '</div>' : '') + '</div>';
    }
    if (ui.cadTab === 'veiculos') {
      const vs = ctx().veiculos;
      const mots = [['', 'Sem motorista fixo']].concat([...ST.motoristas.values()].map((m) => [m.id, m.nome]));
      h += (ST.admin ? '<div class="row" style="margin-bottom:12px"><span class="small muted">Novo veículo:</span><button class="btn sm" data-a="novoVeic" data-v="fiorino">' + I.plus + 'Fiorino</button><button class="btn sm" data-a="novoVeic" data-v="van">' + I.plus + 'Van convencional</button><button class="btn sm" data-a="novoVeic" data-v="tubos">' + I.plus + 'Van de tubos</button></div>' : '');
      const seg = (v) => '<div class="seg">' + ['fiorino', 'van', 'tubos'].map((t) => '<button class="' + (v.tipo === t ? 'on t-' + t : '') + '" data-a="tipoVeic" data-v="' + esc(v.id) + '|' + t + '"' + (d ? ' disabled' : '') + '>' + TIPO_CURTO[t] + '</button>').join('') + '</div>';
      const cont = { fiorino: 0, van: 0, tubos: 0 }; vs.forEach((v) => { cont[v.tipo] = (cont[v.tipo] || 0) + 1; });
      if (vs.length) h += '<div class="card" style="margin-bottom:14px"><div class="card-h"><h2>Frota</h2><span class="small muted">' + cont.fiorino + ' Fiorino · ' + cont.van + ' Van · ' + cont.tubos + ' Van com tubo</span></div><div class="tbl-wrap"><table><thead><tr><th>Veículo</th><th>Placa</th><th>Motorista fixo</th><th>Tipo</th><th class="r">Capacidade</th><th></th></tr></thead><tbody>' +
        vs.map((v) => { const m = v.motoristaId ? ST.motoristas.get(v.motoristaId) : null; return '<tr><td><b>' + esc(v.nome) + '</b>' + (v.conferir ? ' <span class="chip warn">conferir tipo</span>' : '') + (v.ativo === false ? ' <span class="chip bad">inativo</span>' : '') + '</td><td>' + (v.placa ? '<span class="plate">' + esc(v.placa) + '</span>' : '—') + '</td><td class="small">' + esc(m ? m.nome : '—') + '</td><td>' + seg(v) + '</td><td class="r small">' + nf(v.capKg, 0) + ' kg · ' + nf(v.capM3, 0) + ' m³</td><td class="r"><button class="btn sm" data-a="veicDet" data-v="' + esc(v.id) + '">' + (ui.veicDet === v.id ? 'Fechar' : 'Detalhes') + '</button></td></tr>'; }).join('') +
        '</tbody></table></div><p class="tiny" style="margin-top:8px">Ao trocar o tipo, capacidade, medidas e custo passam para o padrão do novo tipo (Van com tubo: seção de 1 × 1 m para os tubos). Ajuste em Detalhes se o veículo for diferente.</p></div>';
      h += vs.filter((v) => ui.veicDet === v.id).map((v) => { const c = (k, t, ty, o) => campo('veiculos', v.id, k, t, v[k], ty, Object.assign({ dis: d }, o || {})); const vc = ctx().veiculos.find((x) => x.id === v.id) || v; const disp = RE.veicDisponivel(vc, ui.data); return '<div class="card"><div class="card-h"><div class="row"><h2>' + esc(v.nome) + '</h2><span class="chip">' + TIPO[v.tipo] + '</span>' + (v.exemplo ? '<span class="chip acc">exemplo</span>' : '') + (v.conferir ? '<span class="chip warn" title="' + esc(v.origem || '') + '">conferir capacidade e medidas</span> <button class="btn sm" data-a="conferido" data-v="' + esc(v.id) + '">Conferido</button>' : '') + '<span class="chip ' + (disp ? 'ok' : 'bad') + '">' + (disp ? 'disponível em ' + dBR(ui.data) : 'indisponível em ' + dBR(ui.data) + (vc.motoristaIndisponivel ? ': motorista ' + vc.motoristaIndisponivel + ' indisponível' : vc.indispDia ? ': desmarcado no Painel' : '')) + '</span></div>' + (ST.admin ? '<button class="btn sm danger" data-a="excluirVeic" data-v="' + esc(v.id) + '">Excluir</button>' : '') + '</div>' + confirmacao('excluirVeic', 'Excluir ' + v.nome + '?', v.id) +
        '<div class="fields">' + c('nome', 'Nome') + c('placa', 'Placa') + c('tipo', 'Tipo', 'sel', { op: Object.entries(TIPO) }) + c('motoristaId', 'Motorista', 'sel', { op: mots }) + c('capKg', 'Capacidade kg', 'num') + c('capM3', 'Volume m³', 'num') + c('compr', 'Comprimento do baú m', 'num') + c('larg', 'Largura do baú m', 'num') + c('alt', 'Altura do baú m', 'num') +
        (v.tipo === 'tubos' ? c('secaoL', 'Seção dos tubos: largura m', 'num') + c('secaoA', 'Seção dos tubos: altura m', 'num') + c('tuboCompr', 'Comprimento útil dos tubos m', 'num') : '') +
        c('custoDiaria', 'Custo operacional diária R$', 'num') + c('diariaMotorista', 'Diária do motorista R$ (se não houver motorista fixo)', 'num') + c('valorKmMotorista', 'Motorista R$ por km (se não houver motorista fixo)', 'num') + c('custoAjudante', 'Ajudante R$/dia', 'num') + c('kmL', 'Consumo km/l', 'num') + c('combustivel', 'Combustível', 'sel', { op: [['diesel', 'Diesel'], ['gasolina', 'Gasolina'], ['etanol', 'Etanol']] }) + c('custoKm', 'Manutenção e pneus R$/km', 'num') + c('multPedagio', 'Multiplicador de pedágio', 'num') + c('minEntregas', 'Mínimo de entregas (vazio = ' + (ST.cfg.minEntregas || 0) + ', padrão dos Ajustes)', 'num') + c('saida', 'Horário de saída', 'time') + c('manutIni', 'Manutenção de', 'date') + c('manutFim', 'até', 'date') + '</div>' +
        '<div class="row" style="margin-top:10px">' + c('ativo', 'Ativo na frota', 'bool') + (v.tipo !== 'tubos' ? c('aceitaTubos', 'Aceita tubos que caibam no baú', 'bool') : '') + '</div></div>'; }).join('') || (vs.length ? '' : '<div class="card empty"><h3>Nenhum veículo</h3><p>Cadastre a frota para roteirizar.</p></div>');
    } else if (ui.cadTab === 'motoristas') {
      h += (ST.admin ? '<div class="row" style="margin-bottom:12px"><button class="btn sm" data-a="novoMot">' + I.plus + 'Novo motorista</button></div>' : '');
      const ms = [...ST.motoristas.values()].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      const veicDe = (id) => [...ST.veiculos.values()].filter((v) => v.motoristaId === id).map((v) => v.nome + (v.placa && !String(v.nome || '').includes(v.placa) ? ' ' + v.placa : '')).join(', ');
      h += ms.length ? '<div class="card"><p class="small muted" style="margin-bottom:10px">Disponibilidade em ' + dBR(ui.data) + '. Motorista indisponível tira da roteirização o veículo em que ele é o motorista fixo. Use “Ausente de/até” para folga, férias ou afastamento; “Disponível” desmarcado vale até ser marcado de novo.</p><div class="tbl-wrap"><table><thead><tr><th>Nome</th><th>Situação</th><th>Disponível</th><th>Ausente de</th><th>até</th><th>Telefone (WhatsApp)</th><th>Veículo fixo</th><th>Último uso</th><th>Diária R$</th><th>R$ por km</th><th>CNH</th><th>Validade CNH</th><th>Ativo</th><th></th></tr></thead><tbody>' + ms.map((m) => { const b = (k, ty, w) => '<input type="' + (ty === 'num' ? 'number' : ty || 'text') + '" data-bind="motoristas|' + esc(m.id) + '|' + k + '"' + (ty === 'num' ? ' data-t="num" step="any"' : '') + ' value="' + esc(m[k] == null ? '' : m[k]) + '"' + dis() + (w ? ' style="width:' + w + 'px"' : '') + '>'; const ok = motDisp(m, ui.data); return '<tr><td>' + b('nome', 'text', 190) + (m.origem ? '<div class="tiny">' + esc(m.origem) + '</div>' : '') + '</td><td>' + (ok ? '<span class="chip ok">disponível</span>' : '<span class="chip bad">indisponível</span>') + '</td><td><input type="checkbox" data-bind="motoristas|' + esc(m.id) + '|disponivel" data-t="bool"' + (m.disponivel !== false ? ' checked' : '') + dis() + '></td><td>' + b('ausenteIni', 'date') + '</td><td>' + b('ausenteFim', 'date') + '</td><td>' + b('telefone', 'text', 140) + '</td><td class="small">' + esc(veicDe(m.id) || '—') + '</td><td class="small mono">' + (m.ultimoUso ? dBR(m.ultimoUso) : '—') + (m.ultimaPlaca ? '<div class="tiny">' + esc(m.ultimaPlaca) + '</div>' : '') + '</td><td>' + b('diaria', 'num', 90) + '</td><td>' + b('valorKm', 'num', 80) + '</td><td>' + b('cnh', 'text', 120) + '</td><td>' + b('cnhValidade', 'date') + (m.cnhValidade && m.cnhValidade < hoje() ? ' <span class="chip bad">vencida</span>' : '') + '</td><td><input type="checkbox" data-bind="motoristas|' + esc(m.id) + '|ativo" data-t="bool"' + (m.ativo !== false ? ' checked' : '') + dis() + '></td><td>' + (ST.admin ? '<button class="btn sm ghost danger" data-a="excluirMot" data-v="' + esc(m.id) + '">Excluir</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '<div class="card empty"><h3>Nenhum motorista</h3><p>O telefone do motorista é usado no envio da rota por WhatsApp.</p></div>';
    } else if (ui.cadTab === 'cidades') {
      const cs = [...ST.cidades.values()].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      h += (ST.admin ? '<div class="card"><div class="row"><label class="f" style="flex:1;min-width:220px">Adicionar cidade atendida<input type="text" id="novaCidade" list="dlMun" placeholder="Digite e escolha: Cidade/UF"></label><button class="btn pri" data-a="addCidadeTxt" style="align-self:flex-end">' + I.plus + 'Adicionar</button></div></div>' : '');
      h += '<div class="card"><p class="small muted" style="margin-bottom:10px">Entregas só saem nos dias marcados. Pedágio é o valor ida e volta para veículo leve até a cidade; o maior pedágio entre as cidades da rota entra no custo. Frete por tabela só é usado quando a nota não traz frete e o operador não informou.</p><div class="tbl-wrap"><table><thead><tr><th>Cidade</th><th>Dias de rota</th><th>Freq.</th><th>Horário</th><th>Descarga min</th><th>Prior.</th><th>Veículos permitidos</th><th>Pedágio R$</th><th>Frete R$/kg</th><th>Frete mín. R$</th><th>Região</th><th title="Região da tabela de pagamento do motorista">Região do frete</th><th>Restrições / observações</th><th></th></tr></thead><tbody>' +
        cs.map((c) => { const b = (k, ty, w) => '<input type="' + (ty === 'num' ? 'number' : ty || 'text') + '" data-bind="cidades|' + esc(c.id) + '|' + k + '"' + (ty === 'num' ? ' data-t="num" step="any"' : '') + ' value="' + esc(c[k] == null ? '' : c[k]) + '"' + dis() + (w ? ' style="width:' + w + 'px"' : '') + '>'; return '<tr><td><b>' + esc(c.nome) + '</b>/' + esc(c.uf) + (c.exemplo ? ' <span class="chip acc">exemplo</span>' : '') + '</td><td><div class="daychips">' + DIAS.map((dn, i) => '<button type="button" data-a="dia" data-v="' + esc(c.id) + '" data-i="' + i + '" aria-pressed="' + (c.dias || []).includes(i) + '"' + dis() + '>' + dn + '</button>').join('') + '</div></td><td class="num">' + (c.dias || []).length + '×</td><td><div class="row" style="flex-wrap:nowrap">' + b('horaIni', 'time', 92) + b('horaFim', 'time', 92) + '</div></td><td>' + b('descargaMin', 'num', 70) + '</td><td><select data-bind="cidades|' + esc(c.id) + '|prioridade" data-t="num"' + dis() + '>' + [[1, 'Alta'], [2, 'Normal'], [3, 'Baixa']].map(([a, t]) => '<option value="' + a + '"' + (+c.prioridade === a ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td><div class="daychips">' + [['fiorino', 'Fio'], ['van', 'Van'], ['tubos', 'Tub']].map(([k, t]) => '<button type="button" data-a="tipoCid" data-v="' + esc(c.id) + '" data-i="' + k + '" aria-pressed="' + (c.tiposPermitidos || []).includes(k) + '"' + dis() + ' title="' + TIPO[k] + '">' + t + '</button>').join('') + '</div></td><td>' + b('pedagio', 'num', 80) + '</td><td>' + b('freteKg', 'num', 75) + '</td><td>' + b('freteMin', 'num', 80) + '</td><td>' + b('regiao', 'text', 110) + '</td><td>' + selRegiaoFrete(c) + '</td><td>' + b('restricoes', 'text', 200) + '</td><td>' + (ST.admin ? '<button class="btn sm ghost danger" data-a="excluirCid" data-v="' + esc(c.id) + '">Excluir</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    } else if (ui.cadTab === 'produtos') {
      const ps = [...ST.produtos.values()].sort((a, b) => (a.padrao || '').localeCompare(b.padrao || ''));
      h += '<div class="row" style="margin-bottom:12px"><button class="btn sm" data-a="novoProduto">' + I.plus + 'Novo produto</button><span class="small muted">O produto é reconhecido pelo código exato ou quando o texto “Reconhecer por” aparece na descrição do item.</span></div>';
      h += '<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Reconhecer por</th><th>Tipo</th><th>Ø ext mm</th><th>Esp. mm</th><th>Compr. m</th><th>Material</th><th>Encaixa</th><th>Peso un. kg</th><th>Volume un. m³</th><th></th></tr></thead><tbody>' +
        ps.map((p) => { const b = (k, ty, w) => '<input type="' + (ty === 'num' ? 'number' : 'text') + '" data-bind="produtos|' + esc(p.id) + '|' + k + '"' + (ty === 'num' ? ' data-t="num" step="any"' : '') + ' value="' + esc(p[k] == null ? '' : p[k]) + '"' + (w ? ' style="width:' + w + 'px"' : '') + '>'; return '<tr><td>' + b('codigo', 'text', 90) + '</td><td>' + b('padrao', 'text', 230) + '</td><td><select data-bind="produtos|' + esc(p.id) + '|tipo">' + [['tubo', 'Tubo'], ['conexao', 'Conexão'], ['caixa_agua', "Caixa d'água"], ['outro', 'Outro']].map(([a, t]) => '<option value="' + a + '"' + (p.tipo === a ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td>' + b('diamExtMm', 'num', 75) + '</td><td>' + b('espMm', 'num', 65) + '</td><td>' + b('comprM', 'num', 65) + '</td><td>' + b('material', 'text', 75) + '</td><td><input type="checkbox" data-bind="produtos|' + esc(p.id) + '|encaixavel" data-t="bool"' + (p.encaixavel !== false ? ' checked' : '') + '></td><td>' + b('pesoUnitKg', 'num', 75) + '</td><td>' + b('volUnitM3', 'num', 80) + '</td><td><button class="btn sm ghost danger" data-a="excluirProd" data-v="' + esc(p.id) + '">Excluir</button></td></tr>'; }).join('') + '</tbody></table></div></div>';
    } else if (ui.cadTab === 'clientes') {
      const m = new Map();
      for (const n of notasEnr()) { const k = RE.clienteKey(n); if (!m.has(k)) m.set(k, { k, nome: n.destNome, end: [n.endereco && n.endereco.lgr, n.endereco && n.endereco.nro].filter(Boolean).join(', '), cid: n.cidadeNome, cep: n.endereco && n.endereco.cep, notas: 0 }); m.get(k).notas++; }
      const lst = [...m.values()].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      h += '<div class="card"><p class="small muted" style="margin-bottom:10px">Cole a coordenada copiada do Google Maps (ex.: -22.9056, -47.0608). Com coordenada confirmada, a rota deixa de usar o centro da cidade para este cliente. Janela de recebimento restringe o horário de chegada.</p><div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Endereço</th><th>Coordenada</th><th>Recebe de</th><th>até</th><th></th></tr></thead><tbody>' +
        lst.map((c) => { const cl = ST.clientes.get(c.k) || {}; const q = encodeURIComponent([c.end, c.cid, c.cep].filter(Boolean).join(' ')); return '<tr><td><b>' + esc(c.nome) + '</b><div class="tiny">' + c.notas + ' nota(s)</div></td><td class="small">' + esc(c.end) + '<div class="tiny">' + esc(c.cid) + ' · ' + esc(c.cep || '') + '</div></td><td><input type="text" data-coord="' + esc(c.k) + '" value="' + (cl.lat != null ? cl.lat + ', ' + cl.lon : '') + '" placeholder="lat, lon" style="width:170px"></td><td><input type="time" data-cli="' + esc(c.k) + '|janelaIni" value="' + esc(cl.janelaIni || '') + '"></td><td><input type="time" data-cli="' + esc(c.k) + '|janelaFim" value="' + esc(cl.janelaFim || '') + '"></td><td><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + q + '">' + I.map + 'Achar</a></td></tr>'; }).join('') + '</tbody></table></div></div>';
    } else if (ui.cadTab === 'combos') {
      const combos = ST.cfg.combos || [];
      const cs = [...ST.cidades.values()].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      h += (ST.admin ? '<div class="row" style="margin-bottom:12px"><button class="btn sm" data-a="novoCombo">' + I.plus + 'Nova combinação</button><span class="small muted">Use na tela Rotas para planejar só um grupo de cidades.</span></div>' : '');
      h += combos.map((cb, i) => '<div class="card"><div class="row"><input type="text" data-combo="' + i + '" value="' + esc(cb.nome) + '" style="max-width:280px"' + dis() + '><span class="spacer"></span>' + (ST.admin ? '<button class="btn sm ghost danger" data-a="excluirCombo" data-v="' + i + '">Excluir</button>' : '') + '</div><div class="row" style="margin-top:10px">' + cs.map((c) => '<label class="chk"><input type="checkbox" data-combocid="' + i + '|' + esc(c.id) + '"' + (cb.cidades.includes(c.id) ? ' checked' : '') + dis() + '> ' + esc(c.nome) + '</label>').join('') + '</div></div>').join('') || '<div class="card empty"><p>Nenhuma combinação salva.</p></div>';
    }
    return h;
  }

  function selRegiaoFrete(c) {
    const tab = ST.cfg.tabelaMotorista; if (!tab || !tab.regioes) return '—';
    const cx = ctx(), auto = RE.regiaoFrete(c.id, Object.assign({}, cx, { cidades: Object.assign({}, cx.cidades, { [c.id]: Object.assign({}, c, { regiaoFrete: '' }) }) }));
    return '<select data-bind="cidades|' + esc(c.id) + '|regiaoFrete"' + dis() + ' style="width:auto"><option value="">Automática' + (auto ? ': ' + esc(auto) : '') + '</option>' + tab.regioes.map((r) => '<option' + (c.regiaoFrete === r ? ' selected' : '') + '>' + esc(r) + '</option>').join('') + '</select>';
  }
  const fmtTabMot = (x) => !x ? '' : x.km ? String(x.km).replace('.', ',') + '/km' : String(x.fixo).replace('.', ',');
  function vFretePct() {
    const l = ST.cfg.fretePctClientes || [];
    return '<div class="card"><div class="card-h"><h2>Frete por cliente antes do CT-e</h2>' + (ST.admin ? '<button class="btn sm" data-a="fpcAdd">+ Cliente</button>' : '') + '</div><p class="tiny" style="margin:6px 0 10px">Enquanto a nota não tem CT-e (frete), a receita é este % sobre o valor da NF, pelo nome do remetente. O primeiro nome que bater vale (deixe “Leal Dutra” acima de “Comercial Leal”).</p><div class="tbl-wrap"><table><thead><tr><th>Remetente contém</th><th>% sobre a NF</th><th></th></tr></thead><tbody>' +
      l.map((r, i) => '<tr><td><input data-fpc="' + i + '|nome" value="' + esc(r.nome || '') + '"' + dis() + '></td><td><input data-fpc="' + i + '|pct" value="' + esc(String(r.pct == null ? '' : r.pct).replace('.', ',')) + '" style="width:90px"' + dis() + '></td><td>' + (ST.admin ? '<button class="btn sm ghost danger" data-a="fpcDel" data-v="' + i + '">Excluir</button>' : '') + '</td></tr>').join('') + '</tbody></table></div></div>';
  }
  function vTabelaMotorista() {
    const tab = ST.cfg.tabelaMotorista || RE.TABELA_MOTORISTA_PADRAO, tipos = [['fiorino', 'Fiorino'], ['van', 'Van sem tubo'], ['tubos', 'Van com tubo']];
    return '<div class="card"><h2>Pagamento do motorista por região</h2><p class="tiny" style="margin:6px 0 10px">Valor por saída em R$, ou R$ por km escrevendo “/km” (ex.: 2,50/km). Rota que passa por mais de uma região paga a de maior valor. A região de cada cidade é a mais próxima (ou a escolhida em Cadastros → Cidades). Vazio: usa a diária e o R$/km do cadastro do motorista.</p><div class="tbl-wrap"><table><thead><tr><th>Região</th>' + tipos.map(([, t]) => '<th>' + t + '</th>').join('') + '</tr></thead><tbody>' +
      tab.regioes.map((r) => '<tr><td><b>' + esc(r) + '</b></td>' + tipos.map(([k]) => '<td><input data-tabmot="' + esc(k) + '|' + esc(r) + '" value="' + esc(fmtTabMot(((tab.valores || {})[k] || {})[r])) + '" style="width:110px"' + dis() + '></td>').join('') + '</tr>').join('') + '</tbody></table></div></div>';
  }
  function vCfg() {
    const c = ST.cfg;
    const f = (k, t, ty, extra) => campo('cfg', 'main', k, t, k.includes('.') ? k.split('.').reduce((o, x) => (o || {})[x], c) : c[k], ty, Object.assign({ dis: !ST.admin }, extra || {}));
    let h = topo('Ajustes', 'Parâmetros de cálculo, histórico e dados');
    h += '<div class="card"><h2>Base e deslocamento</h2><div class="fields" style="margin-top:10px"><label class="f">Cidade da base<input type="text" list="dlMun" id="fBase" value="' + esc(c.base.nome) + '"' + dis() + '></label>' + f('base.lat', 'Latitude da base', 'num') + f('base.lon', 'Longitude da base', 'num') + f('fatorRodoviario', 'Fator rodoviário (× linha reta)', 'num') + f('velocidadeMedia', 'Velocidade média km/h', 'num') + f('kmUrbano', 'Km entre entregas na mesma cidade', 'num') + f('inicioJornada', 'Início da jornada', 'time') + f('jornadaMaxHoras', 'Jornada máxima h', 'num') + f('descargaPorNotaMin', 'Minutos extras por nota na mesma parada', 'num') + '</div></div>';
    h += '<div class="card"><h2>Custos</h2><div class="fields" style="margin-top:10px">' + f('precoDiesel', 'Diesel R$/l', 'num') + f('precoGasolina', 'Gasolina R$/l', 'num') + f('precoEtanol', 'Etanol R$/l', 'num') + f('pesoVeiculo', 'Penalidade por veículo usado R$ (desempate)', 'num') + '</div></div>';
    h += vFretePct();
    h += vTabelaMotorista();
    h += '<div class="card"><h2>Motoristas por dia</h2><div class="row" style="margin-top:10px">' + f('minimizarMotoristas', 'Usar o menor número possível de motoristas (só abre outro veículo quando a carga não cabe ou uma entrega ficaria de fora)', 'bool') + '</div><p class="tiny" style="margin-top:8px">Com isso ligado, menos motoristas vale mais do que diferença de lucro entre rotas. Entregas no prazo continuam vindo antes. O plano nunca usa mais motoristas do que os marcados no Painel.</p></div>';
    h += '<div class="card"><h2>Mínimo de entregas por veículo</h2><div class="fields" style="margin-top:10px">' + f('minEntregas', 'Mínimo de entregas para um veículo sair (0 = sem mínimo)', 'num') + '</div><div class="row" style="margin-top:10px">' + f('minExcecaoPrazo', 'Exceção: o veículo sai abaixo do mínimo quando leva entrega no limite do prazo', 'bool') + '</div><p class="tiny" style="margin-top:8px">Cada parada conta como uma entrega (várias notas do mesmo cliente contam uma vez). Abaixo do mínimo, as entregas passam para outros veículos ou aguardam o próximo dia de rota da cidade. Cada veículo pode ter um mínimo próprio no cadastro.</p></div>';
    h += '<div class="card"><h2>Carga e tubos</h2><div class="fields" style="margin-top:10px">' + f('folgaEncaixeMm', 'Folga radial mínima no encaixe mm', 'num') + f('folgaSecaoMm', 'Folga entre tubos na seção mm', 'num') + f('niveisEncaixe', 'Níveis de encaixe', 'num') + f('cargaInternaKgM', 'Carga máxima dentro de um tubo kg/m', 'num') + f('aproveitamento', 'Aproveitamento do volume (0 a 1)', 'num') + f('densidadeSecao', 'Densidade da seção na busca rápida (0 a 1)', 'num', { ph: '0.72' }) + f('cubagemKgM3', 'Fator de cubagem kg/m³ (0 = não estimar volume)', 'num') + f('prazoPadraoDias', 'Prazo padrão em dias após a emissão (0 = sem prazo)', 'num') + '</div><p class="tiny" style="margin-top:8px">Volume e prazo só são estimados se você definir o fator de cubagem ou o prazo padrão; nesse caso a nota mostra o aviso.</p></div>';
    h += '<div class="card"><h2>Planos salvos</h2>' + (ST.planos.size ? '<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Data</th><th>Situação</th><th class="r">Veículos</th><th class="r">Entregas</th><th class="r">Lucro</th><th>Calculado</th><th></th></tr></thead><tbody>' + [...ST.planos.values()].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 60).map((p) => '<tr><td class="mono">' + dBR(p.data) + '</td><td>' + (p.status === 'aprovado' ? '<span class="chip ok">aprovado</span>' : '<span class="chip warn">rascunho</span>') + '</td><td class="r num">' + p.totais.veiculos + '</td><td class="r num">' + p.totais.entregas + '</td><td class="r num">' + brl(p.totais.lucro) + '</td><td class="small">' + new Date(p.editadoEm || p.criadoEm).toLocaleString('pt-BR') + '</td><td><button class="btn sm" data-a="abrirPlano" data-v="' + p.data + '">Abrir</button></td></tr>').join('') + '</tbody></table></div>' : '<p class="muted small">Nenhum plano salvo.</p>') + '</div>';
    const logs = [...ST.log.values()].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 7).flatMap((d) => (d.entradas || []).slice().reverse());
    h += '<div class="card"><h2>Histórico de alterações</h2>' + (logs.length ? '<div class="tbl-wrap" style="margin-top:10px;max-height:360px;overflow:auto"><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>' + logs.slice(0, 200).map((e) => '<tr><td class="small mono">' + new Date(e.t).toLocaleString('pt-BR') + '</td><td class="small">' + esc(ST.nomes[e.u] || (e.u === ST.uid ? 'Você' : /^u_/.test(e.u || '') || !e.u ? 'Usuário' : e.u)) + '</td><td class="small"><b>' + esc(e.acao) + '</b></td><td class="small">' + esc(e.det) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted small">Sem registros.</p>') + '</div>';
    const nDemo = [...ST.notas.values()].filter((n) => n.demo).length;
    const antigas = [...ST.notas.values()].filter((n) => ['entregue', 'cancelada'].includes(n.status) && (n.importadoEm || '') < new Date(Date.now() - 90 * 864e5).toISOString()).length;
    h += '<div class="card"><h2>Dados</h2><div class="row" style="margin-top:10px">' + (nDemo ? '<button class="btn danger" data-a="removerDemo">Remover ' + nDemo + ' nota(s) de demonstração</button>' : window.RC_HOST ? '' : '<button class="btn" data-a="demo">Carregar demonstração</button>') + '<button class="btn" data-a="backup">' + I.dl + 'Baixar cópia de segurança (JSON)</button>' + (antigas ? '<button class="btn danger" data-a="limparAntigas">Excluir ' + antigas + ' nota(s) entregues/canceladas há mais de 90 dias</button>' : '') + '</div>' + confirmacao('limparAntigas', 'Excluir definitivamente estas notas?') + '<p class="tiny" style="margin-top:8px">' + ST.notas.size + ' nota(s) no banco. O banco comporta até 25 mil documentos.</p></div>';
    return h;
  }

  // ---------------- render ----------------
  function render() {
    lembrarUI();
    shell();
    const m = $('#main');
    const V = { painel: vPainel, notas: vNotas, sobras: vSobras, rotas: vRotas, rom: vRomaneios, carga: vCarga, rel: vRel, cad: vCad, cfg: vCfg }[ui.tab] || vPainel;
    let html;
    try { html = V(); } catch (e) { console.error(e); html = '<div class="note bad">Erro ao montar a tela: ' + esc(e.message) + '</div>'; }
    const sy = window.scrollY;
    m.innerHTML = html + (ui.notaAberta ? vNotaSheet() : '');
    window.scrollTo(0, sy);
    if (ui.tab === 'notas' && ui.notasSub === 'importar') { atualizarProg(); ligarDZ(); }
    ativarMapas();
    if (!$('#dlMun').childElementCount && $('[list="dlMun"]')) {
      $('#dlMun').innerHTML = RE.munList().sort((a, b) => (a.uf === 'SP' ? 0 : 1) - (b.uf === 'SP' ? 0 : 1) || a.nome.localeCompare(b.nome)).map((x) => '<option value="' + esc(x.nome + '/' + x.uf) + '">').join('');
    }
  }
  function ligarDZ() {
    const dz = $('#dz');
    if (!dz || dz.dataset.on) return;
    dz.dataset.on = '1';
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); importar(e.dataTransfer.files); });
  }

  // ---------------- eventos ----------------
  const munPorTexto = (t) => { const m = /^(.*)\/([A-Za-z]{2})$/.exec((t || '').trim()); return m ? RE.findMun(null, m[1], m[2]) : null; };
  const novaCidade = (m) => Object.assign({ id: m.cod, nome: m.nome, uf: m.uf, dias: [1, 2, 3, 4, 5], horaIni: '08:00', horaFim: '17:30', descargaMin: 20, prioridade: 2, tiposPermitidos: ['fiorino', 'van', 'tubos'], pedagio: 0, freteKg: 0, freteMin: 0, fretePct: 0, regiao: '', restricoes: '', obs: '' });
  const setPath = (o, k, v) => { const ps = k.split('.'); let x = o; for (let i = 0; i < ps.length - 1; i++) { x[ps[i]] = Object.assign({}, x[ps[i]] || {}); x = x[ps[i]]; } if (v === null || v === '') delete x[ps[ps.length - 1]]; else x[ps[ps.length - 1]] = v; };

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-a],[data-tab]');
    if (!el || el.disabled) return;
    if (el.dataset.tab) { ui.tab = el.dataset.tab; ui.notaAberta = null; ui.confirmar = null; render(); window.scrollTo(0, 0); return; }
    const a = el.dataset.a, v = el.dataset.v;
    const p = plano();
    switch (a) {
      case 'tab': ui.tab = v; render(); window.scrollTo(0, 0); break;
      case 'otimizar': if (ui.calc) return; await otimizar(); break;
      case 'encaixar': if (ui.calc) return; await otimizar('encaixar'); break;
      case 'cenarios': if (ui.calc) return; await compararCenarios(); break;
      case 'aprovar': {
        const abaixo = p.rotas.filter((r) => r.minEntregas && r.paradas.length < r.minEntregas && !r.paradas.some((s) => s.obrigatoria || s.travada));
        if (abaixo.length && !(ui.confirmar && ui.confirmar.a === 'aprovarMin')) { ui.confirmar = { a: 'aprovarMin' }; render(); return; }
        ui.confirmar = null; const q = clone(p); q.status = 'aprovado'; q.aprovadoEm = agoraISO(); q.aprovadoPor = ST.uid; q.substituiuAprovado = false; await salvar('planos', p.data, q); await sincronizarStatus(q); await registrar('Plano aprovado', dBR(p.data) + ': ' + p.totais.veiculos + ' veículo(s), ' + p.totais.entregas + ' entrega(s)'); toast('Plano aprovado. As notas foram marcadas como roteirizadas.'); render(); break; }
      case 'desaprovar': { const q = clone(p); q.status = 'rascunho'; await salvar('planos', p.data, q); await sincronizarStatus(q); await registrar('Plano reaberto', dBR(p.data)); render(); break; }
      case 'subir': case 'descer': { const i = +el.dataset.i, d = a === 'subir' ? -1 : 1; await editarPlano((q) => { const r = q.rotas.find((x) => x.veiculoId === v); const t = r.paradas[i]; r.paradas[i] = r.paradas[i + d]; r.paradas[i + d] = t; }); break; }
      case 'travar': await travar(v, el.dataset.key); break;
      case 'entregar': { const r = p.rotas.find((x) => x.veiculoId === v); const s = r.paradas.find((x) => x.key === el.dataset.key); await salvarVarios('notas', s.notas.map((id) => ST.notas.get(id)).filter(Boolean).map((n) => ({ id: n.id, data: Object.assign({}, n, { status: 'entregue', entregueEm: agoraISO(), prioridade: false }) }))); const q = clone(p); q.rotas.find((x) => x.veiculoId === v).paradas.find((x) => x.key === el.dataset.key).entregue = true; await salvar('planos', p.data, q); registrar('Entrega', s.dest + ' (NF ' + nfsTxt(s.notas) + ')'); render(); break; }
      case 'verCarga': ui.cargaVeic = v; ui.tab = 'carga'; render(); window.scrollTo(0, 0); break;
      case 'cargaVeic': ui.cargaVeic = v; render(); break;
      case 'notasSub': ui.notasSub = v; render(); break;
      case 'pag': ui.notasPag = Math.max(0, ui.notasPag + (+v)); render(); break;
      case 'nota': ui.notaAberta = v; ui.confirmar = null; render(); break;
      case 'fecharNota': ui.notaAberta = null; ui.confirmar = null; render(); break;
      case 'statusNota': { const n = ST.notas.get(ui.notaAberta); const q = Object.assign({}, n, { status: v }); if (v === 'cancelada') q.canceladaEm = agoraISO(); if (v === 'entregue') { q.entregueEm = agoraISO(); q.prioridade = false; } if (v === 'pronta') { q.planoData = null; } await salvar('notas', n.id, q); registrar('Nota ' + v, 'NF ' + (n.numero || n.id)); render(); break; }
      case 'excluirNota': ui.confirmar = { a: 'excluirNota' }; render(); break;
      case 'excluirVeic': ui.confirmar = { a: 'excluirVeic', v }; render(); break;
      case 'limparAntigas': ui.confirmar = { a: 'limparAntigas' }; render(); break;
      case 'cancelarConf': ui.confirmar = null; render(); break;
      case 'confirmar': {
        const c = ui.confirmar; ui.confirmar = null;
        if (c.a === 'excluirNota') { const n = ST.notas.get(ui.notaAberta); await remover('notas', ui.notaAberta); registrar('Nota excluída', 'NF ' + (n && n.numero)); ui.notaAberta = null; }
        if (c.a === 'excluirVeic') { await remover('veiculos', c.v); registrar('Veículo excluído', c.v); }
        if (c.a === 'limparAntigas') { const lim = new Date(Date.now() - 90 * 864e5).toISOString(); const ids = [...ST.notas.values()].filter((n) => ['entregue', 'cancelada'].includes(n.status) && (n.importadoEm || '') < lim).map((n) => n.id); for (const id of ids) await remover('notas', id); registrar('Limpeza', ids.length + ' notas antigas excluídas'); }
        render(); break;
      }
      case 'demo': await carregarDemo(); break;
      case 'removerDemo': await removerDemo(); break;
      case 'salvarTubo': {
        const box = $('[data-tubo="' + el.dataset.i + '"]');
        const g = (n) => $('[name="' + n + '"]', box).value;
        const de = RE.num(g('de')), esp = RE.num(g('esp')), compr = RE.num(g('compr'));
        if (!de || !compr) { toast('Informe pelo menos o diâmetro externo e o comprimento.', true); return; }
        const id = 'p-' + hash(v);
        await salvar('produtos', id, { id, codigo: '', padrao: RE.norm(v), tipo: 'tubo', diamExtMm: de, espMm: esp || null, comprM: compr, pesoUnitKg: RE.num(g('peso')) || null, material: g('mat'), encaixavel: g('enc') === '1' });
        registrar('Produto cadastrado', v); toast('Produto salvo. As notas com “' + v.slice(0, 40) + '” foram atualizadas.'); render(); break;
      }
      case 'novoProduto': {
        const id = 'p-' + uid();
        let base = { id, codigo: '', padrao: '', tipo: 'outro', encaixavel: true };
        if (v) { const n = notaE(v); const it = n.itens[+el.dataset.i]; const dd = RE.dimsDaDescricao(it.desc); base = Object.assign(base, { codigo: it.cod || '', padrao: RE.norm(it.desc), tipo: it.tipo, diamExtMm: dd.de || null, espMm: dd.esp || null, comprM: dd.compr || null, material: RE.materialDe(it.desc) }); ui.notaAberta = null; }
        await salvar('produtos', id, base); ui.tab = 'cad'; ui.cadTab = 'produtos'; render(); toast('Produto criado: complete peso, volume ou dimensões.'); break;
      }
      case 'excluirProd': await remover('produtos', v); render(); break;
      case 'conferirPdf': { const n = ST.notas.get(v); await salvar('notas', v, Object.assign({}, n, { pdfConferido: true })); render(); break; }
      case 'addCidade': { const m = RE.findMun(v); if (m) { await salvar('cidades', m.cod, novaCidade(m)); registrar('Cidade cadastrada', m.nome); toast(m.nome + ' cadastrada de segunda a sexta. Ajuste os dias em Cadastros.'); } render(); break; }
      case 'addCidadeTxt': { const m = munPorTexto($('#novaCidade').value); if (!m) { toast('Escolha a cidade na lista (formato Cidade/UF).', true); return; } if (ST.cidades.has(m.cod)) { toast(m.nome + ' já está cadastrada.'); return; } await salvar('cidades', m.cod, novaCidade(m)); registrar('Cidade cadastrada', m.nome); render(); break; }
      case 'excluirCid': await remover('cidades', v); render(); break;
      case 'dia': case 'tipoCid': { const c = clone(ST.cidades.get(v)); const k = a === 'dia' ? 'dias' : 'tiposPermitidos'; const x = a === 'dia' ? +el.dataset.i : el.dataset.i; const s = new Set(c[k] || []); if (s.has(x)) s.delete(x); else s.add(x); c[k] = [...s].sort(); await salvar('cidades', v, c); render(); break; }
      case 'novoVeic': { const t = RE.VEICULOS_PADRAO.find((x) => x.tipo === v); const n = [...ST.veiculos.values()].filter((x) => x.tipo === v).length + 1; const id = v + '-' + uid(); await salvar('veiculos', id, Object.assign({}, t, { id, nome: ({ fiorino: 'Fiorino', van: 'Van', tubos: 'Van Tubos' })[v] + ' ' + n, exemplo: false })); registrar('Veículo cadastrado', id); render(); break; }
      case 'novoMot': { const id = 'm-' + uid(); await salvar('motoristas', id, { id, nome: 'Novo motorista', telefone: '', diaria: 0, ativo: true, disponivel: true }); render(); break; }
      case 'excluirMot': await remover('motoristas', v); render(); break;
      case 'cadTab': ui.cadTab = v; ui.confirmar = null; render(); break;
      case 'novoCombo': { const c = clone(ST.cfg); c.combos = (c.combos || []).concat([{ id: 'c-' + uid(), nome: 'Nova combinação', cidades: [] }]); await salvar('cfg', 'main', c); render(); break; }
      case 'excluirCombo': { const c = clone(ST.cfg); c.combos.splice(+v, 1); await salvar('cfg', 'main', c); render(); break; }
      case 'abrirPlano': ui.data = v; ui.tab = 'rotas'; render(); window.scrollTo(0, 0); break;
      case 'sbBuscar': buscarSobra(); break;
      case 'sbLimpar': ui.sb = null; render(); setTimeout(() => { const i = $('#sbNF'); if (i) i.focus(); }, 30); break;
      case 'sbRegistrar': await registrarSobra(); break;
      case 'selNota': break;
      case 'excluirUma': { ui.notasSel = new Set([v]); ui.confirmar = { a: 'excluirSel' }; render(); window.scrollTo(0, 0); break; }
      case 'excluirSel': ui.confirmar = { a: 'excluirSel' }; render(); break;
      case 'fpcAdd': { const c = clone(ST.cfg); c.fretePctClientes = (c.fretePctClientes || []).concat([{ nome: '', pct: 0 }]); await salvar('cfg', 'main', c); render(); break; }
      case 'fpcDel': { const c = clone(ST.cfg); c.fretePctClientes = (c.fretePctClientes || []).filter((_, i) => i !== +v); await salvar('cfg', 'main', c); ui.escalaSuja = true; render(); break; }
      case 'semNotasPend': ui.tab = 'notas'; ui.notasSub = 'revisao'; render(); break;
      case 'semNotasForcar': {
        const d = ui.data, wd = RE.weekday(d), c = ctx(), it = [];
        for (const n of notasEnr()) {
          if (['entregue', 'cancelada', 'em_rota', 'roteirizada'].includes(n.status) || n.bloqueioUsuario || n.bloqueada) continue;
          const cid = c.cidades[n.cidadeId]; if (!cid || (cid.dias || []).includes(wd) || n.diaForcado === d) continue;
          const o = ST.notas.get(n.id); if (o) it.push({ id: n.id, data: Object.assign({}, o, { diaForcado: d }) });
        }
        await salvarVarios('notas', it); registrar('Programação', it.length + ' nota(s) forçadas para ' + dBR(d)); toast(it.length + ' nota(s) entram na programação de ' + dBR(d) + '.'); ui.escalaSuja = true; render(); break;
      }
      case 'excluirSelOk': await excluirNotas([...(ui.notasSel || [])]); break;
      case 'limparSel': ui.notasSel = new Set(); ui.confirmar = null; render(); break;
      case 'copiarNF': { const ok = await copiarTexto(v); toast(ok ? 'NF ' + v + ' copiada.' : 'Não consegui copiar a NF ' + v + '.', !ok); break; }
      case 'sswAtualizar': await atualizarSSW(true); break;
      case 'romAtualizar': ui.romCache = {}; await carregarRomaneios(true); break;
      case 'romVer': await roteirizarRomaneio(v, true); break;
      case 'romRefazer': { const k = romChave(ui.romData || hoje(), v); if (ui.romCache) delete ui.romCache[k]; await roteirizarRomaneio(v, true); break; }
      case 'romTodos': await roteirizarTodos(); break;
      case 'romMot': { const g = ((ui.romLista && ui.romLista.rows) || []).find((r) => RE.norm(r.motorista) === v && r.romaneios.length > 1); if (g) await roteirizarMotorista(g, true); break; }
      case 'sswSync': ui.sswSync = true; await sincronizarSSW(); break;
      case 'dispTodos': { const d = ui.data, dd = dispDia(d), mm = {}; for (const m of ST.motoristas.values()) mm[m.id] = v === '1' ? (RE.motoristaDisponivel(m, d) ? undefined : true) : false; for (const k in mm) if (mm[k] === undefined) delete mm[k]; await salvar('disponibilidade', d, { data: d, veiculos: Object.assign({}, dd.veiculos), motoristas: mm }); registrar('Disponibilidade', (v === '1' ? 'Todos os motoristas marcados' : 'Todos os motoristas desmarcados') + ' em ' + dBR(d)); render(); break; }
      case 'importarFrota': await importarFrota(); break;
      case 'atualizarSistema': try { (window.top || window).location.reload(); } catch (e) { location.reload(); } break;
      case 'tipoVeic': { const [id, t] = v.split('|'); await trocarTipoVeic(id, t); break; }
      case 'veicDet': ui.veicDet = ui.veicDet === v ? null : v; render(); break;
      case 'conferido': { const vv = ST.veiculos.get(v); if (vv) { const q = Object.assign({}, vv); delete q.conferir; await salvar('veiculos', v, q); render(); } break; }
      case 'irSSW': ui.tab = 'notas'; ui.notasSub = 'ssw'; render(); break;
      case 'sswTrazer': { const f = ui.sswFiltro || { q: '', so: 'novas' }; const q = RE.norm(f.q); await trazerSSW(sswLinhas().filter((r) => !q || RE.norm([r.nf, r.ctrc, r.cliente, r.cidade, r.remetente].join(' ')).includes(q))); break; }
      case 'nmSalvar': {
        const f = lerNotaManual('nm');
        if (!f.numero) { toast('Informe o número da NF.', true); return; }
        if (!(munPorTexto(f.cidade) || RE.findMun(null, f.cidade, 'SP'))) { toast('Escolha a cidade na lista (Cidade/UF).', true); return; }
        const id = await criarNotaManual(f); toast('NF ' + f.numero + ' inserida.'); ui.notaAberta = id; render(); break;
      }
      case 'sbAuto': { const s = ST.sobras.get(v); if (s) { const q = Object.assign({}, s); delete q.statusManual; delete q.statusManualEm; await salvar('sobras', v, q); ui.sbSyncEm = 0; render(); } break; }
      case 'sbExcluir': {
        const s = ST.sobras.get(v); await remover('sobras', v);
        if (s && s.notaId) { const n = ST.notas.get(s.notaId); if (n) { const oc = (n.ocorrencias || []).filter((o) => !(o.data === s.data && o.motivo === s.motivo)); const q = Object.assign({}, n, { ocorrencias: oc }); if (!oc.length) { q.prioridade = false; delete q.prioridadeDesde; delete q.dataMinima; } if (n.status === 'cancelada' && /^Devolvida/.test(n.motivoCancel || '')) q.status = 'pronta'; await salvar('notas', n.id, q); } }
        registrar('Nota que ficou desfeita', 'NF ' + (s && s.numero)); render(); break;
      }
      case 'xlsx': await exportarExcel(planoOuVazio()); break;
      case 'pdf': await exportarPDF(planoOuVazio(), ui.relTipo); break;
      case 'backup': { const o = { exportadoEm: agoraISO(), cfg: ST.cfg }; for (const c of COLS) o[c] = [...ST[c].values()]; await baixar('roteirizador-backup-' + hoje() + '.json', new Blob([JSON.stringify(o)], { type: 'application/json' })); break; }
    }
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.bloq) { const n = ST.notas.get(el.dataset.bloq); if (n) { const q = Object.assign({}, n); if (el.checked) { q.bloqueioUsuario = true; q.bloqueioEm = agoraISO(); q.bloqueioPor = ST.uid; } else { delete q.bloqueioUsuario; delete q.bloqueioEm; delete q.bloqueioPor; } await salvar('notas', n.id, q); if (el.checked) await tirarDosPlanos([n.id]); registrar('Nota ' + (el.checked ? 'bloqueada' : 'desbloqueada'), 'NF ' + n.numero); toast('NF ' + n.numero + (el.checked ? ' bloqueada: não entra na programação.' : ' desbloqueada.')); render(); } return; }
    if (el.dataset.sel) { const s = ui.notasSel || (ui.notasSel = new Set()); if (el.checked) s.add(el.dataset.sel); else s.delete(el.dataset.sel); ui.confirmar = null; render(); return; }
    if (el.dataset.selall) { const s = ui.notasSel || (ui.notasSel = new Set()); for (const c of $$('[data-sel]')) { if (el.checked) s.add(c.dataset.sel); else s.delete(c.dataset.sel); } ui.confirmar = null; render(); return; }
    if (el.id === 'fRomData') { if (el.value) { ui.romData = el.value; ui.romSel = null; ui.romTodos = false; render(); } return; }
    if (el.id === 'fData') { if (el.value) { ui.data = el.value; ui.cenarios = null; render(); } return; }
    if (el.dataset.disp) {
      const [t, id] = el.dataset.disp.split('|'); const d = ui.data; const dd = dispDia(d);
      const o = { data: d, veiculos: Object.assign({}, dd.veiculos), motoristas: Object.assign({}, dd.motoristas) };
      const k = t === 'v' ? 'veiculos' : 'motoristas';
      if (!el.checked) o[k][id] = false; else if (t === 'm' && !(RE.motoristaDisponivel(ST.motoristas.get(id), d) && motRecente(ST.motoristas.get(id), d))) { o[k][id] = true; ui.motQ = ''; } else delete o[k][id];
      await salvar('disponibilidade', d, o); ui.escalaSuja = true;
      const nome = t === 'v' ? (ST.veiculos.get(id) || {}).nome : (ST.motoristas.get(id) || {}).nome;
      registrar('Disponibilidade', (nome || id) + (el.checked ? ' disponível' : ' fora') + ' em ' + dBR(d));
      render(); return;
    }
    if (el.dataset.sbst) { const s = ST.sobras.get(el.dataset.sbst); if (s) { const st = el.value; const q = Object.assign({}, s, { statusManual: st, statusManualEm: hoje() }); await salvar('sobras', s.id, q); const n = s.notaId ? ST.notas.get(s.notaId) : null; if (n) { const ns = st === 'entregue' ? 'entregue' : st === 'em_rota' ? 'em_rota' : (['em_rota', 'entregue'].includes(n.status) ? 'pronta' : n.status); if (ns !== n.status) await salvar('notas', n.id, Object.assign({}, n, { status: ns }, ns === 'entregue' ? { entregueEm: hoje() } : {})); } registrar('Sobras', 'NF ' + s.numero + ': ' + SB_ST[st][0]); render(); } return; }
    if (el.dataset.sbmot) { const s = ST.sobras.get(el.dataset.sbmot); await salvar('sobras', s.id, Object.assign({}, s, { motivo: el.value })); if (s.notaId) { const n = ST.notas.get(s.notaId); if (n) { const oc = (n.ocorrencias || []).map((o) => (o.data === s.data && o.motivo === s.motivo ? Object.assign({}, o, { motivo: el.value }) : o)); await salvar('notas', n.id, Object.assign({}, n, { ocorrencias: oc })); } } render(); return; }
    if (el.id === 'sbMotivo' && ui.sb) { ui.sb.motivo = el.value; ui.sb.reenvio = !SEM_REENVIO.includes(el.value); const r = $('#sbReenvio'); if (r) r.checked = ui.sb.reenvio; return; }
    if (el.id === 'fSSW') { if (el.files[0]) carregarArquivoSSW(el.files[0]); el.value = ''; return; }
    if (el.id === 'fSSWso') { ui.sswFiltro.so = el.value; render(); return; }
    if (el.id === 'fArq') { importar(el.files); el.value = ''; return; }
    if (el.id === 'fStatus') { ui.notasFiltro.status = el.value; ui.notasPag = 0; render(); return; }
    if (el.id === 'fCidade') { ui.notasFiltro.cidade = el.value; ui.notasPag = 0; render(); return; }
    if (el.id === 'fRel') { ui.relTipo = el.value; render(); return; }
    if (el.id === 'fFoco') { ui.mapaFoco = el.value || null; render(); return; }
    if (el.id === 'fCombo') { ui.filtroCombo = el.value; render(); return; }
    if (el.id === 'fConsol') { await salvar('cfg', 'main', Object.assign({}, ST.cfg, { consolidar: el.checked })); render(); return; }
    if (el.id === 'fBase') { const m = munPorTexto(el.value); if (!m) { toast('Escolha a cidade na lista (Cidade/UF).', true); return; } await salvar('cfg', 'main', Object.assign({}, ST.cfg, { base: { nome: m.nome + '/' + m.uf, lat: m.lat, lon: m.lon } })); render(); return; }
    if (el.classList.contains('mv')) { if (el.value) await moverParada(el.dataset.de, el.dataset.key, el.value); return; }
    if (el.dataset.fpc) {
      const [i, campo] = el.dataset.fpc.split('|'), c = clone(ST.cfg), l = c.fretePctClientes = (c.fretePctClientes || []).slice();
      if (!l[+i]) return; l[+i] = Object.assign({}, l[+i], { [campo]: campo === 'pct' ? (parseFloat(String(el.value).replace(',', '.')) || 0) : String(el.value || '').trim() });
      await salvar('cfg', 'main', c); ui.escalaSuja = true; toast('Frete por cliente salvo.'); render(); return;
    }
    if (el.dataset.tabmot) {
      const [tipo, reg] = el.dataset.tabmot.split('|'), c = clone(ST.cfg), tab = c.tabelaMotorista || clone(RE.TABELA_MOTORISTA_PADRAO);
      const t = String(el.value || '').trim().toLowerCase(), num = parseFloat(t.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      tab.valores = tab.valores || {}; tab.valores[tipo] = tab.valores[tipo] || {};
      if (!t || !(num >= 0)) delete tab.valores[tipo][reg]; else tab.valores[tipo][reg] = /km/.test(t) ? { km: num } : { fixo: num };
      c.tabelaMotorista = tab; await salvar('cfg', 'main', c); ui.escalaSuja = true; toast('Tabela do motorista salva.'); render(); return;
    }
    if (el.dataset.trocav) {
      const de = el.dataset.trocav, para = el.value; if (!para) return;
      await editarPlano((q) => { const r = q.rotas.find((x) => x.veiculoId === de); if (!r) return false; const o = q.rotas.find((x) => x.veiculoId === para); if (o) o.veiculoId = de; r.veiculoId = para; }, para);
      return;
    }
    if (el.dataset.motorista) { await editarPlano((q) => { q.rotas.find((r) => r.veiculoId === el.dataset.motorista).motoristaId = el.value; }); return; }
    if (el.dataset.extras) { await editarPlano((q) => { const r = q.rotas.find((x) => x.veiculoId === el.dataset.extras); r.custo = Object.assign({}, r.custo, { extras: RE.num(el.value) || 0 }); }); return; }
    if (el.dataset.mun) { const m = munPorTexto(el.value); if (!m) { toast('Escolha a cidade na lista (Cidade/UF).', true); return; } const n = ST.notas.get(el.dataset.mun); await salvar('notas', n.id, Object.assign({}, n, { endereco: Object.assign({}, n.endereco, { cidade: m.nome, uf: m.uf, cMun: m.cod }) })); render(); return; }
    if (el.dataset.coord) {
      const k = el.dataset.coord, t = el.value.trim();
      const cl = Object.assign({ id: k }, ST.clientes.get(k) || {});
      if (!t) { delete cl.lat; delete cl.lon; }
      else { const m = /(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/.exec(t.replace(/(\d),(\d)/g, '$1.$2').replace(/\s*;\s*/, ', ')); if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) { toast('Coordenada inválida. Use o formato -22.9056, -47.0608', true); return; } cl.lat = +m[1]; cl.lon = +m[2]; }
      await salvar('clientes', k, cl); registrar('Coordenada de cliente', k); render(); return;
    }
    if (el.dataset.cli) { const [k, f] = el.dataset.cli.split('|'); const cl = Object.assign({ id: k }, ST.clientes.get(k) || {}); if (el.value) cl[f] = el.value; else delete cl[f]; await salvar('clientes', k, cl); render(); return; }
    if (el.dataset.combo != null) { const c = clone(ST.cfg); c.combos[+el.dataset.combo].nome = el.value; await salvar('cfg', 'main', c); return; }
    if (el.dataset.combocid) { const [i, cid] = el.dataset.combocid.split('|'); const c = clone(ST.cfg); const s = new Set(c.combos[+i].cidades); if (el.checked) s.add(cid); else s.delete(cid); c.combos[+i].cidades = [...s]; await salvar('cfg', 'main', c); return; }
    if (el.dataset.bind) {
      const [col, id, k] = el.dataset.bind.split('|');
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.t === 'num') { val = val === '' ? null : RE.num(val); if (el.value !== '' && val == null) { toast('Número inválido', true); return; } }
      if (col === 'veiculos' && k === 'tipo') { await trocarTipoVeic(id, val); return; }
      const obj = col === 'cfg' ? clone(ST.cfg) : clone(ST[col].get(id) || { id });
      setPath(obj, k, val);
      if (col === 'notas' && (k === 'pesoOperador' || k === 'volOperador') && val == null) delete obj[k];
      await salvar(col, id, obj);
      if (col !== 'notas' || ['travaVeiculo', 'prazo', 'diaForcado', 'frete'].includes(k)) registrar('Alteração', ({ cfg: 'Ajustes', veiculos: 'Veículo', motoristas: 'Motorista', cidades: 'Cidade', produtos: 'Produto', notas: 'Nota' })[col] + ' ' + id + ': ' + k + ' = ' + val);
      agendar();
    }
  });
  let qT = null;
  document.addEventListener('input', (e) => {
    if (e.target.id === 'fSSWq') { clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { ui.sswFiltro.q = v; render(); const i = $('#fSSWq'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); return; }
    if (e.target.id === 'fMotQ') { clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { ui.motQ = v; render(); const i = $('#fMotQ'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 200); return; }
    if (e.target.id === 'fQ') { clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { ui.notasFiltro.q = v; ui.notasPag = 0; render(); const i = $('#fQ'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'sbNF') { e.preventDefault(); buscarSobra(); return; } if (e.key === 'Escape' && ui.notaAberta) { ui.notaAberta = null; render(); } });

  // ---------------- início ----------------
  async function iniciar() {
    ui.data = hoje();
    shell();
    $('#main').innerHTML = '<div class="empty"><h3>Carregando dados…</h3></div>';
    let db = null, user = null;
    try { if (window.claude && window.claude.use) { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } } catch (e) { db = null; }
    if (user) {
      try { ST.admin = await user.canEdit(); } catch (e) { ST.admin = false; }
      try { ST.uid = (await user.id()) || 'anon'; } catch (e) { /* ok */ }
    }
    if (window.RC_HOST && window.RC_HOST.pronto) {
      let sb = null; try { sb = await window.RC_HOST.pronto; } catch (e) { sb = null; }
      if (sb) { ST.sandbox = sb; window.RC_HOST = undefined; }   // demonstração / teste grátis: sem SSW da CONSTRULOG
    }
    if (!db) { DB.local = true; ST.admin = true; carregarLocal(); VER++; render(); return; }
    DB.db = db;
    let prontos = 0;
    const total = COLS.length + 1;
    const pronto = () => {
      prontos++;
      if (prontos >= total) {
        render();
        if (ST.sandbox && ST.sandbox.demo && ST.admin && !ST.notas.size && !ui.demoAuto) { ui.demoAuto = true; setTimeout(() => carregarDemo().catch(() => {}), 120); }
        if (ST.sandbox && !ui.sbAviso) { ui.sbAviso = true; toast(ST.sandbox.demo ? 'Demonstração com dados fictícios: fique à vontade para testar.' : 'Bem-vindo ao teste grátis' + (ST.sandbox.testeAte ? ' (até ' + new Date(ST.sandbox.testeAte).toLocaleDateString('pt-BR') + ')' : '') + '.'); }
      } else if (prontos === 1) render();
    };
    db.doc(PATH.cfg).onSnapshot((s) => { ST.carregado.cfgDoc = s.exists; ST.cfg = Object.assign({}, RE.CFG_PADRAO, s.exists ? s.data() : {}); if (!ST.cfg.base || ST.cfg.base.lat == null) ST.cfg.base = RE.CFG_PADRAO.base; VER++; if (!ST.carregado.cfg) { ST.carregado.cfg = 1; pronto(); } else agendar(); }, (e) => toast('Conexão com o banco interrompida (' + e.code + '). Recarregue a página.', true));
    for (const c of COLS) {
      db.collection(PATH[c]).onSnapshot((s) => {
        ST[c] = new Map(s.docs.map((d) => [d.id, Object.assign({}, d.data(), { id: d.id })]));
        VER++;
        if (!ST.carregado[c]) { ST.carregado[c] = 1; pronto(); } else agendar();
        if (c === 'log' && user) resolverNomes(user);
      }, (e) => toast('Conexão com o banco interrompida (' + e.code + '). Recarregue a página.', true));
    }
  }
  let nomesT = null;
  function resolverNomes(user) {
    clearTimeout(nomesT);
    nomesT = setTimeout(async () => {
      const ids = new Set();
      for (const d of ST.log.values()) for (const e of d.entradas || []) if (e.u && /^u_/.test(e.u)) ids.add(e.u);
      if (!ids.size) return;
      try { const ps = await user.profiles([...ids].slice(0, 64)); for (const id of Object.keys(ps || {})) ST.nomes[id] = ps[id].name || ''; if (ui.tab === 'cfg') agendar(); } catch (e) { /* sem nomes */ }
    }, 400);
  }
  iniciar();
})();
