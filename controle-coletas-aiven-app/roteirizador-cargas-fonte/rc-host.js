/* Ponte do Roteirizador dentro do CONSTRULOG: oferece à página a mesma interface que ela usa
   como artefato (claude.use('db' | 'user' | 'downloads')), gravando no banco do CONSTRULOG
   (/api/rc/...) com a sessão do usuário. Também expõe RC_HOST para buscar no SSW e na Frota. */
(function () {
  'use strict';
  const LOGIN = '/?login=1#roteirizador-cargas';
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = {};
    try { j = await r.json(); } catch (e) { /* sem corpo */ }
    if (r.status === 401) { try { (window.top || window).location.href = LOGIN; } catch (e) { location.href = LOGIN; } }
    if (!r.ok || j.ok === false) {
      const e = new Error(j.error || 'HTTP ' + r.status);
      e.code = r.status === 403 || r.status === 400 ? 'invalid_argument' : r.status === 413 ? 'quota_exceeded' : r.status === 401 ? 'revoked' : 'unavailable';
      e.status = r.status;
      throw e;
    }
    return j;
  }

  // ---- banco de documentos com atualização periódica ----
  const docs = new Map();
  let desde = null, pronto = false, subs = [], timer = null, emAndamento = null;
  const colDe = (p) => p.slice(0, p.lastIndexOf('/'));
  const snapDoc = (p) => { const d = docs.get(p); return { id: p.slice(p.lastIndexOf('/') + 1), exists: !!d, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } }; };
  const snapCol = (c) => {
    const out = [];
    for (const [p, d] of docs) if (colDe(p) === c) out.push({ id: p.slice(p.lastIndexOf('/') + 1), exists: true, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } });
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { docs: out, size: out.length, empty: !out.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };
  function avisar(paths) {
    for (const s of subs.slice()) {
      if (paths && !paths.some((p) => (s.doc ? p === s.path : colDe(p) === s.path))) continue;
      try { s.cb(s.doc ? snapDoc(s.path) : snapCol(s.path)); } catch (e) { console.error(e); }
    }
  }
  async function buscar() {
    if (emAndamento) return emAndamento;
    emAndamento = (async () => {
      try {
        const j = await api('GET', '/api/rc/mudancas' + (desde ? '?desde=' + encodeURIComponent(desde) : ''));
        const mudou = [];
        if (j.completo) docs.clear();
        for (const d of j.docs || []) { docs.set(d.path, d.data); mudou.push(d.path); }
        for (const p of j.removidos || []) { docs.delete(p); mudou.push(p); }
        desde = j.agora;
        if (!pronto) { pronto = true; avisar(null); } else if (mudou.length) avisar(mudou);
      } catch (e) { console.warn('Roteirizador: sincronização', e.message); }
      finally { emAndamento = null; }
    })();
    return emAndamento;
  }
  function ligar() {
    if (timer) return;
    buscar();
    timer = setInterval(() => { if (document.visibilityState !== 'hidden') buscar(); }, 8000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') buscar(); });
  }
  function assinar(path, doc, cb) {
    const s = { path, doc, cb };
    subs.push(s);
    ligar();
    if (pronto) setTimeout(() => cb(doc ? snapDoc(path) : snapCol(path)), 0);
    return () => { subs = subs.filter((x) => x !== s); };
  }
  const db = {
    doc(path) {
      return {
        path, id: path.slice(path.lastIndexOf('/') + 1),
        onSnapshot: (cb) => assinar(path, true, cb),
        get: async () => { if (!pronto) await buscar(); return snapDoc(path); },
        set: async (data) => { await api('PUT', '/api/rc/doc', { path, data }); docs.set(path, data); avisar([path]); },
        update: async (data) => { const cur = Object.assign({}, docs.get(path) || {}, data); await api('PUT', '/api/rc/doc', { path, data: cur }); docs.set(path, cur); avisar([path]); },
        delete: async () => { await api('DELETE', '/api/rc/doc?path=' + encodeURIComponent(path)); docs.delete(path); avisar([path]); },
        collection: (sub) => db.collection(path + '/' + sub),
      };
    },
    collection(path) {
      return {
        path,
        onSnapshot: (cb) => assinar(path, false, cb),
        get: async () => { if (!pronto) await buscar(); return snapCol(path); },
        doc: (id) => db.doc(path + '/' + (id || Math.random().toString(36).slice(2, 12))),
        add: async (data) => { const d = db.doc(path + '/' + Math.random().toString(36).slice(2, 12)); await d.set(data); return d; },
        where() { return this; }, orderBy() { return this; }, limit() { return this; },
      };
    },
  };

  // ---- usuário ----
  let eu = null;
  const euP = api('GET', '/api/rc/eu').then((j) => (eu = j)).catch(() => null);
  const user = {
    canEdit: async () => { await euP; return !!(eu && eu.admin); },
    isOwner: async () => { await euP; return !!(eu && eu.admin); },
    can: async () => true,
    id: async () => { await euP; return eu ? eu.username : null; },
    me: async () => { await euP; return { id: eu && eu.username, name: eu && eu.username, email: null }; },
    profiles: async (ids) => Object.fromEntries((ids || []).map((i) => [i, { name: String(i) }])),
  };

  // ---- arquivos para baixar ----
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return { status: 'saved' };
    },
  };
  window.claude = { use: async (nome) => ({ db, user, downloads }[nome] || null) };

  // ---- aviso de versão nova ----
  (function () {
    const meta = document.querySelector('meta[name="rc-versao"]');
    const minha = meta && meta.content;
    if (!minha) return;
    let avisado = false;
    async function conferir() {
      if (avisado) return;
      try {
        const r = await fetch('/api/rc/sistema', { cache: 'no-store', credentials: 'same-origin' });
        const j = await r.json();
        if (j && j.pagina && j.pagina !== minha) mostrar();
      } catch (e) { /* sem rede: tenta depois */ }
    }
    function mostrar() {
      avisado = true;
      window.RC_HOST.novaVersao = true;
      const bt = document.getElementById('rcAtualizar'); if (bt) { bt.textContent = '🔄 Nova versão — atualizar'; bt.style.background = '#f5b301'; bt.style.color = '#16142f'; }
      const d = document.createElement('div');
      d.setAttribute('role', 'status');
      d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;background:#16142f;color:#fff;padding:10px 12px 10px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;font:14px system-ui,sans-serif;max-width:calc(100% - 32px)';
      d.innerHTML = '<span>Nova versão do Roteirizador disponível.</span>';
      const b = document.createElement('button');
      b.textContent = 'Atualizar agora';
      b.style.cssText = 'background:#f5b301;color:#16142f;border:0;border-radius:7px;padding:7px 12px;font:600 14px system-ui,sans-serif;cursor:pointer';
      b.onclick = () => { try { (window.top || window).location.reload(); } catch (e) { location.reload(); } };
      d.appendChild(b);
      document.body.appendChild(d);
    }
    setInterval(() => { if (document.visibilityState !== 'hidden') conferir(); }, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferir(); });
    setTimeout(conferir, 20000);
  })();

  // ---- integrações do CONSTRULOG ----
  const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };
  window.RC_HOST = {
    nome: 'CONSTRULOG',
    // empresa fora da CONSTRULOG (demonstração ou teste grátis): o app roda sem as integrações do SSW/Frota/Rastreio,
    // que leem dados da CONSTRULOG. Resolve com {demo, cliente, testeAte} nesse caso, ou null.
    pronto: euP.then((j) => (j && j.sandbox ? { demo: !!j.demo, cliente: j.cliente || '', testeAte: j.testeAte || null } : null)).catch(() => null),
    // CTRCs disponíveis para entrega: SSW opção 038 (pendências), com peso, m³ e frete do BI2
    // situação das notas que ficaram: em rota (saiu dos disponíveis = romaneio) ou entregue (baixa no BI2)
    statusNfs: (nfs, desde) => api('GET', '/api/programacao-entregas/status-nfs?nfs=' + encodeURIComponent(nfs.join(',')) + '&desde=' + encodeURIComponent(desde || '')),
    // romaneios emitidos no SSW num dia (por motorista) e a rota de um romaneio (km e pontos de entrega)
    romaneiosDoDia: (data) => api('GET', '/api/roteirizador/lista?date=' + encodeURIComponent(data)),
    recalcularRota: (corpo) => api('POST', '/api/roteirizador/recalcular', corpo),
    rotaRomaneio: (data, romaneio) => api('GET', '/api/roteirizador/rota?date=' + encodeURIComponent(data) + '&romaneio=' + encodeURIComponent(romaneio)),
    // endereço certo pelo XML do CT-e (opção 101 do SSW), já localizado no mapa; até 12 CTRCs por chamada
    enderecosCtrc: (ctrcs) => api('POST', '/api/roteirizador/enderecos-ctrc', { ctrcs }),
    sswDisponiveis: (forcar) => api('GET', '/api/programacao-entregas/disponiveis' + (forcar ? '?force=1' : '')),
    // veículos e motoristas: tela Frota + quem rodou no Rastreio de carga nos últimos dias
    async frotaERastreio(dias) {
      dias = dias || 14;
      const out = { veiculos: [], pessoas: [], rastreio: [], contatos: [], avisos: [] };
      try { const f = await api('GET', '/api/painel/frota-state'); out.veiculos = (f.data && f.data.vehicles) || []; out.pessoas = (f.data && f.data.people) || []; }
      catch (e) { out.avisos.push('Frota: ' + e.message); }
      try { out.contatos = (await api('GET', '/api/painel/tracking/contacts')).rows || []; } catch (e) { out.avisos.push('Telefones do rastreio: ' + e.message); }
      const datas = Array.from({ length: dias }, (_, i) => diasAtras(i));
      const res = await Promise.all(datas.map((d) => api('GET', '/api/painel/tracking/history-drivers?date=' + d).then((j) => (j.rows || []).map((r) => Object.assign({ data: d }, r))).catch((e) => { out.avisos.push('Rastreio de carga: ' + e.message); return []; })));
      out.rastreio = res.flat();
      out.avisos = [...new Set(out.avisos)].slice(0, 5);
      return out;
    },
  };
})();
