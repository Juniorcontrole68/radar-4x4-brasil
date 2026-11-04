'use strict';
// Agendamento pelo link (enquanto o número oficial do WhatsApp não é liberado pela Meta).
//
// O SAC clica em "📲 WhatsApp" na nota: o sistema cria um link pessoal do cliente e abre o WhatsApp do SAC
// com a mensagem da Ana pronta. O cliente abre o link, escolhe uma das datas válidas da rota da cidade dele
// (mesma regra do robô: grade da opção 107, prazo, corte às 18h, sem domingo e feriado) e, se quiser, manda
// a localização. O agendamento é gravado pelo mesmo agendar()/alterar() do SAC, sem o operador digitar nada.
//
// Rotas: POST /api/painel/agendamento-whatsapp/link (SAC) · GET /agendar/<token> (página do cliente)
//        GET/POST /api/agendar/<token> (dados e escolha). Testado em tests/agendamento-link.js.

const crypto = require('crypto');
const ag = require('./agendamento');
const wa = require('./agendamento-whatsapp');

const DIAS_VALIDADE = 10;
const USUARIO = { id: null, username: 'Cliente (link)', is_admin: true };   // o SAC mandou o link: vale mesmo com o cliente reservado
const DIAS_NOME = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const limpo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const br = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const dataLonga = iso => DIAS_NOME[new Date(iso + 'T12:00:00Z').getUTCDay()] + ', ' + br(iso);
const CHAVE_SQL = "upper(regexp_replace(trim(COALESCE(n.destinatario,'')),'\\s+',' ','g'))||'|'||upper(regexp_replace(trim(COALESCE(n.cidade,'')),'\\s+',' ','g'))";

async function ensureSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_links (
    token TEXT PRIMARY KEY, client_id BIGINT, chave TEXT NOT NULL, nota_ids BIGINT[] NOT NULL,
    destinatario TEXT, cidade TEXT, uf TEXT, telefone TEXT, criado_por TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), expira_em TIMESTAMPTZ NOT NULL,
    aberto_em TIMESTAMPTZ, data_escolhida DATE, escolhido_em TIMESTAMPTZ)`);
  // último envio pelo botão do SAC: trava o botão do cliente até o dia seguinte
  await pool.query('ALTER TABLE ag_links ADD COLUMN IF NOT EXISTS enviado_em TIMESTAMPTZ');
  await pool.query('ALTER TABLE ag_links ADD COLUMN IF NOT EXISTS enviado_por TEXT');
  // cada clique no botão 📲 WhatsApp (quem mandou e quando), para o relatório do SAC
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_link_envios (id BIGSERIAL PRIMARY KEY, token TEXT NOT NULL, client_id BIGINT, chave TEXT NOT NULL,
    nota_ids BIGINT[] NOT NULL, usuario TEXT, enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_link_envios_em ON ag_link_envios (COALESCE(client_id,0), enviado_em DESC)');
  // envios feitos antes desta tabela: o último envio de cada link
  await pool.query(`INSERT INTO ag_link_envios(token,client_id,chave,nota_ids,usuario,enviado_em) SELECT l.token,l.client_id,l.chave,l.nota_ids,COALESCE(l.enviado_por,l.criado_por),COALESCE(l.enviado_em,l.criado_em)
    FROM ag_links l WHERE NOT EXISTS (SELECT 1 FROM ag_link_envios e WHERE e.token=l.token)`);
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_links_chave ON ag_links (COALESCE(client_id,0), chave, expira_em DESC)');
}

const erro = (status, msg) => Object.assign(new Error(msg), { status });
const nfsTexto = notas => { const l = [...new Set(notas.map(n => n.nf))]; return (l.length > 1 ? 'NFs ' : 'NF ') + (l.length > 4 ? l.slice(0, 4).join(', ') + ' e mais ' + (l.length - 4) : l.join(', ')); };
const remetentes = notas => [...new Set(notas.map(n => limpo(n.remetente, 40).replace(/\s*\.+$/, '')).filter(Boolean))].slice(0, 2).join(' e ') || 'nosso cliente';
// "MADA CABRAL 1330321" -> "Mada Cabral" (o número do pedido que vem colado no nome sai)
const primeiroNome = v => limpo(String(v || '').replace(/\s+\d{5,}$/, ''), 60).split(' ').slice(0, 2)
  .map(p => /^(de|da|do|dos|das|e)$/i.test(p) ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');

function mensagem(dest, notas, cidade, uf, url) {
  return 'Olá' + (dest ? ', ' + primeiroNome(dest) : '') + '! 👋 Sou a *Ana*, atendente virtual da *Construlog* 🚚\n\n' +
    'Temos uma entrega para você:\n📦 ' + nfsTexto(notas) + ' — ' + remetentes(notas) + '\n📍 ' + limpo(cidade, 40) + (uf ? '/' + uf : '') + '\n\n' +
    '📅 Escolha o melhor dia para receber por este link:\n' + url + '\n\n' +
    '⚠️ Precisa ter alguém no local para receber. Se não houver recebedor, a entrega será reagendada para até 15 dias.';
}

// SAC: cria (ou reaproveita) o link do cliente da nota, com todas as notas pendentes dele na mesma cidade
async function criarLink(pool, cli, user, notaId, base) {
  const n = (await pool.query(`SELECT n.id::text,n.nf,n.remetente,n.destinatario,n.cidade,n.uf,n.telefone,n.situacao,${CHAVE_SQL} AS chave FROM ag_notas n WHERE n.id=$1 AND n.client_id IS NOT DISTINCT FROM $2`, [String(notaId || ''), cli])).rows[0];
  if (!n) throw erro(404, 'Nota não encontrada.');
  if (n.chave === '|') throw erro(400, 'A nota não tem destinatário.');
  if (ag.FINAIS.includes(n.situacao)) throw erro(409, 'A NF ' + n.nf + ' já foi ' + (n.situacao === 'entregue' ? 'entregue' : 'devolvida') + '.');
  // já mandado hoje para este cliente (destinatário + cidade): o botão fica travado até amanhã
  const hoje = (await pool.query(`SELECT enviado_por,to_char(enviado_em AT TIME ZONE 'America/Sao_Paulo','HH24:MI') AS hora FROM ag_links
    WHERE COALESCE(client_id,0)=COALESCE($1::bigint,0) AND chave=$2 AND (enviado_em AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
    ORDER BY enviado_em DESC LIMIT 1`, [cli, n.chave])).rows[0];
  if (hoje) throw erro(409, 'O link para ' + (n.destinatario || 'este cliente') + ' já foi enviado hoje às ' + hoje.hora + (hoje.enviado_por ? ' por ' + hoje.enviado_por : '') + '. Dá para mandar de novo a partir de amanhã.');
  await wa.garantirRotas(pool, cli);
  const rota = await wa.rotaDa(pool, cli, n.cidade, n.uf);
  if (!wa.proximasDatas(rota).length) throw erro(422, (n.cidade || 'A cidade') + ' não tem dia de entrega na grade (opção 107). Agende pelo botão Agendar.');
  // as outras notas do mesmo cliente na mesma cidade, ainda em aberto, vão no mesmo link
  const grupo = (await pool.query(`SELECT n.id::text,n.nf,n.remetente FROM ag_notas n WHERE n.client_id IS NOT DISTINCT FROM $1 AND ${CHAVE_SQL}=$2 AND n.situacao IN ('pendente','verificar')
      AND (n.id=$3 OR NOT EXISTS (SELECT 1 FROM ag_agendamentos a WHERE a.nota_id=n.id AND a.status='ativo')) ORDER BY n.nf LIMIT 30`, [cli, n.chave, n.id])).rows;
  if (!grupo.some(g => g.id === n.id)) grupo.unshift({ id: n.id, nf: n.nf, remetente: n.remetente });
  const ids = grupo.map(g => g.id);
  let token = (await pool.query("SELECT token FROM ag_links WHERE COALESCE(client_id,0)=COALESCE($1::bigint,0) AND chave=$2 AND expira_em>NOW()+INTERVAL '2 days' ORDER BY criado_em DESC LIMIT 1", [cli, n.chave])).rows[0]?.token;
  if (token) await pool.query('UPDATE ag_links SET nota_ids=$2,enviado_em=NOW(),enviado_por=$3 WHERE token=$1', [token, ids, limpo(user.username, 80)]);
  else {
    token = crypto.randomBytes(18).toString('base64url');
    await pool.query(`INSERT INTO ag_links(token,client_id,chave,nota_ids,destinatario,cidade,uf,telefone,criado_por,expira_em,enviado_em,enviado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+($10||' days')::interval,NOW(),$9)`,
      [token, cli, n.chave, ids, limpo(n.destinatario, 120), limpo(n.cidade, 80), limpo(n.uf, 2).toUpperCase(), limpo(n.telefone, 60), limpo(user.username, 80), String(DIAS_VALIDADE)]);
  }
  await pool.query('INSERT INTO ag_link_envios(token,client_id,chave,nota_ids,usuario) VALUES($1,$2,$3,$4,$5)', [token, cli, n.chave, ids, limpo(user.username, 80)]);
  for (const id of ids) await pool.query('INSERT INTO ag_eventos(client_id,nota_id,tipo,para,detalhe,usuario) VALUES($1,$2,$3,$4,$5,$6)', [cli, id, 'whatsapp', 'link', 'Link de agendamento enviado ao cliente pelo WhatsApp do SAC', limpo(user.username, 80)]);
  const url = String(base || '').replace(/\/+$/, '') + '/agendar/' + token;
  const texto = mensagem(n.destinatario, grupo, n.cidade, n.uf, url);
  const fone = wa.celular(n.telefone);
  return { token, url, texto, telefone: fone, whatsapp: 'https://wa.me/' + fone + '?text=' + encodeURIComponent(texto), notas: grupo.map(g => g.nf) };
}

async function lerLink(pool, token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token || ''))) throw erro(404, 'Link inválido.');
  const l = (await pool.query('SELECT * FROM ag_links WHERE token=$1', [token])).rows[0];
  if (!l) throw erro(404, 'Link inválido.');
  if (new Date(l.expira_em) < new Date()) throw erro(410, 'Este link expirou. Fale com a Construlog para receber um novo.');
  return l;
}
async function notasDoLink(pool, l) {
  return (await pool.query(`SELECT n.id::text,n.nf,n.remetente,n.situacao,
      (SELECT a.id::text FROM ag_agendamentos a WHERE a.nota_id=n.id AND a.status='ativo') AS ag_id,
      (SELECT to_char(a.data_agendada,'YYYY-MM-DD') FROM ag_agendamentos a WHERE a.nota_id=n.id AND a.status='ativo') AS ag_data
    FROM ag_notas n WHERE n.id=ANY($1::bigint[]) ORDER BY n.nf`, [l.nota_ids])).rows;
}
async function dadosLink(pool, token, { agora } = {}) {
  const l = await lerLink(pool, token);
  if (!l.aberto_em) await pool.query('UPDATE ag_links SET aberto_em=NOW() WHERE token=$1', [token]);
  const notas = await notasDoLink(pool, l);
  const abertas = notas.filter(n => !ag.FINAIS.includes(n.situacao));
  const datas = wa.proximasDatas(await wa.rotaDa(pool, l.client_id, l.cidade, l.uf), { agora: agora || new Date(), n: 8 });
  const local = (await pool.query('SELECT 1 FROM ag_locais WHERE COALESCE(client_id,0)=COALESCE($1::bigint,0) AND chave=$2', [l.client_id, l.chave])).rowCount > 0;
  const agendada = abertas.find(n => n.ag_data)?.ag_data || null;
  return { ok: true, nome: primeiroNome(l.destinatario), cidade: l.cidade, uf: l.uf, entrega: nfsTexto(abertas.length ? abertas : notas) + ' — ' + remetentes(notas),
    concluida: !abertas.length, agendada, agendada_texto: agendada ? dataLonga(agendada) : '', tem_local: local,
    datas: datas.map(d => ({ data: d, texto: dataLonga(d) })) };
}

async function escolher(pool, token, b, { agora, abrirLink } = {}) {
  const l = await lerLink(pool, token);
  const data = String(b.data || '');
  const notas = (await notasDoLink(pool, l)).filter(n => !ag.FINAIS.includes(n.situacao));
  if (!notas.length) throw erro(409, 'Esta entrega já foi concluída.');
  let feitas = 0;
  if (data) {
    const validas = wa.proximasDatas(await wa.rotaDa(pool, l.client_id, l.cidade, l.uf), { agora: agora || new Date(), n: 8 });
    if (!validas.includes(data)) throw erro(422, 'Essa data não está mais disponível. Escolha outra, por favor.');
    const problemas = [];
    for (const n of notas) {
      try {
        if (n.ag_id) { if (n.ag_data !== data) await ag.alterar(pool, l.client_id, USUARIO, n.ag_id, { data_agendada: data, motivo: 'Remarcado pelo cliente no link do WhatsApp' }); }
        else await ag.agendar(pool, l.client_id, USUARIO, { nota_id: n.id, data_agendada: data, observacao: 'Agendado pelo cliente no link do WhatsApp' });
        feitas++;
      } catch (e) { problemas.push('NF ' + n.nf + ': ' + e.message); }
    }
    if (!feitas) throw erro(409, 'Não consegui agendar agora. A Construlog vai falar com você pelo WhatsApp.');
    if (problemas.length) for (const n of notas) await pool.query('INSERT INTO ag_eventos(client_id,nota_id,tipo,para,detalhe,usuario) VALUES($1,$2,$3,$4,$5,$6)', [l.client_id, n.id, 'whatsapp', 'SAC', limpo('Parte das notas não foi agendada pelo link: ' + problemas.join(' | '), 500), USUARIO.username]);
    await pool.query('UPDATE ag_links SET data_escolhida=$2,escolhido_em=NOW() WHERE token=$1', [token, data]);
  }
  let local = null;
  const entrada = limpo(b.local, 2000);
  if (entrada) {
    try { for (const n of notas) local = await ag.gravarLocalizacao(pool, l.client_id, USUARIO, n.id, entrada, abrirLink ? { abrir: abrirLink } : undefined); }
    catch (e) { if (!data) throw erro(400, 'Não consegui ler essa localização. Use o botão de localização ou cole o link do Google Maps.'); }
  }
  return { ok: true, data: data || null, data_texto: data ? dataLonga(data) : '', notas: feitas, localizacao: !!local };
}

// ------------------------------------------------------------------ relatório do SAC
// Um envio = um clique no botão 📲 WhatsApp. Abriu = o cliente abriu o link; Respondeu = escolheu a data no link.
const dataIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
async function relatorio(pool, cli, f = {}) {
  const de = dataIso(f.de), ate = dataIso(f.ate), usuario = limpo(f.usuario, 80);
  const rows = (await pool.query(`SELECT e.id::text,e.enviado_em,e.usuario,l.destinatario,l.cidade,l.uf,l.aberto_em,l.escolhido_em,to_char(l.data_escolhida,'YYYY-MM-DD') AS data_escolhida,
      (SELECT string_agg(n.nf,', ' ORDER BY n.nf) FROM ag_notas n WHERE n.id=ANY(e.nota_ids)) AS nfs,
      (SELECT to_char(MIN(a.data_agendada),'YYYY-MM-DD') FROM ag_agendamentos a WHERE a.nota_id=ANY(e.nota_ids) AND a.status='ativo') AS agendada_para,
      (SELECT string_agg(DISTINCT a.criado_por_nome,', ') FROM ag_agendamentos a WHERE a.nota_id=ANY(e.nota_ids) AND a.status='ativo') AS agendada_por,
      (SELECT bool_and(n.situacao IN ('entregue','devolvida')) FROM ag_notas n WHERE n.id=ANY(e.nota_ids)) AS concluida,
      ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date-(e.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date) AS dias
    FROM ag_link_envios e JOIN ag_links l ON l.token=e.token
    WHERE COALESCE(e.client_id,0)=COALESCE($1::bigint,0)
      AND ($2::date IS NULL OR (e.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date>=$2::date)
      AND ($3::date IS NULL OR (e.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date<=$3::date)
      AND ($4='' OR lower(e.usuario)=lower($4))
    ORDER BY e.enviado_em DESC LIMIT 2000`, [cli, de, ate, usuario])).rows.map(r => ({
    ...r, abriu: !!r.aberto_em, respondeu: !!r.escolhido_em,
    situacao: r.concluida ? 'Entregue/concluída' : r.escolhido_em ? 'Escolheu a data' : r.agendada_para ? 'Agendada pelo SAC' : r.dias >= 2 ? 'Sem resposta (ligar)' : 'Sem resposta',
  }));
  const por = new Map();
  for (const r of rows) {
    const k = r.usuario || '(sem usuário)';
    if (!por.has(k)) por.set(k, { usuario: k, enviados: 0, abriram: 0, responderam: 0, sem_resposta: 0, ultimo: r.enviado_em });
    const p = por.get(k); p.enviados++; if (r.abriu) p.abriram++; if (r.respondeu) p.responderam++; if (!r.respondeu && !r.agendada_para && !r.concluida) p.sem_resposta++;
  }
  const porUsuario = [...por.values()].map(p => ({ ...p, pct_resposta: p.enviados ? Math.round(p.responderam * 100 / p.enviados) : 0 })).sort((a, b) => b.enviados - a.enviados);
  const total = porUsuario.reduce((t, p) => ({ enviados: t.enviados + p.enviados, abriram: t.abriram + p.abriram, responderam: t.responderam + p.responderam, sem_resposta: t.sem_resposta + p.sem_resposta }), { enviados: 0, abriram: 0, responderam: 0, sem_resposta: 0 });
  const usuarios = (await pool.query("SELECT DISTINCT usuario FROM ag_link_envios WHERE COALESCE(client_id,0)=COALESCE($1::bigint,0) AND usuario IS NOT NULL ORDER BY 1", [cli])).rows.map(r => r.usuario);
  return { ok: true, total: { ...total, pct_resposta: total.enviados ? Math.round(total.responderam * 100 / total.enviados) : 0 }, por_usuario: porUsuario, rows, usuarios };
}

// ------------------------------------------------------------------ página do cliente
const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Agendamento de entrega · Construlog</title>
<style>
:root{--az:#0b3b6f;--az2:#1d5fa8;--vd:#15803d;--tx:#1f2937;--mu:#6b7280;--bd:#e5e7eb;--fd:#f3f6fa}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fd);color:var(--tx);line-height:1.45}
header{background:var(--az);color:#fff;padding:18px 16px}header b{font-size:1.15rem}header div{opacity:.85;font-size:.9rem}
main{max-width:520px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid var(--bd);border-radius:14px;padding:16px;margin-bottom:14px}
.ana{display:flex;gap:12px;align-items:flex-start}.ana .av{flex:none;width:44px;height:44px;border-radius:50%;background:var(--az2);color:#fff;display:grid;place-items:center;font-size:1.3rem}
h2{font-size:1rem;margin:0 0 10px}.mu{color:var(--mu);font-size:.9rem}
.datas{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.datas button{border:1.5px solid var(--bd);background:#fff;border-radius:12px;padding:12px 8px;font:inherit;text-align:center;cursor:pointer;color:var(--tx)}
.datas button b{display:block;font-size:1.05rem}.datas button span{font-size:.8rem;color:var(--mu)}
.datas button.sel{border-color:var(--az2);background:#eaf2fc;box-shadow:0 0 0 2px var(--az2) inset}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:600;cursor:pointer;margin-top:10px}
.pri{background:var(--vd);color:#fff}.pri:disabled{background:#9ca3af}.sec{background:#eef2f7;color:var(--az)}
input{width:100%;border:1.5px solid var(--bd);border-radius:10px;padding:11px;font:inherit;margin-top:8px}
.aviso{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:12px;font-size:.9rem}
.ok{color:var(--vd);font-weight:600}.erro{color:#b91c1c;font-size:.9rem;margin-top:8px}
.feito{text-align:center}.feito .big{font-size:2.4rem}
</style></head><body>
<header><b>🚚 Construlog</b><div>Agendamento de entrega</div></header>
<main id="app"><div class="card mu">Carregando…</div></main>
<script>
const T=location.pathname.split('/').pop(),A=document.getElementById('app');let D=null,sel='',loc='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(m,b){const r=await fetch('/api/agendar/'+T,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw new Error(j.error||'Não consegui falar com o sistema. Tente de novo.');return j}
function tela(){
  if(D.concluida){A.innerHTML='<div class="card feito"><div class="big">📦</div><h2>Esta entrega já foi concluída.</h2><div class="mu">Obrigado!</div></div>';return}
  const d=D.datas.map(x=>{const[p,q]=x.texto.split(', ');return'<button type="button" data-d="'+x.data+'" class="'+(sel===x.data?'sel':'')+'"><b>'+esc(q)+'</b><span>'+esc(p)+'</span></button>'}).join('');
  A.innerHTML='<div class="card ana"><div class="av">👩</div><div>Olá'+(D.nome?', <b>'+esc(D.nome)+'</b>':'')+'! 👋 Sou a <b>Ana</b>, atendente virtual da <b>Construlog</b>.<br><br>📦 '+esc(D.entrega)+'<br>📍 '+esc(D.cidade)+(D.uf?'/'+esc(D.uf):'')+'</div></div>'+
  (D.agendada?'<div class="card"><span class="ok">✅ Entrega agendada para '+esc(D.agendada_texto)+'</span><div class="mu">Precisa mudar? Escolha outro dia abaixo.</div></div>':'')+
  '<div class="card"><h2>📅 '+(D.agendada?'Mudar a data':'Escolha o melhor dia para receber')+'</h2><div class="datas">'+(d||'<div class="mu">Sem datas disponíveis. A Construlog vai falar com você.</div>')+'</div><div class="mu" style="margin-top:8px">Entregas em horário comercial.</div></div>'+
  '<div class="card"><h2>📍 Localização do endereço de entrega '+(D.tem_local?'<span class="ok">(já recebida ✓)</span>':'<span class="mu">(opcional)</span>')+'</h2><div class="mu">Ajuda o motorista a chegar certinho.</div>'+
  '<button type="button" class="btn sec" id="gps">📍 Usar minha localização atual</button><input id="lk" placeholder="ou cole aqui o link do Google Maps" value="'+esc(loc.startsWith('http')?loc:'')+'"><div id="gpsok" class="ok" style="margin-top:6px">'+(loc&&!loc.startsWith('http')?'Localização capturada ✓':'')+'</div></div>'+
  '<div class="aviso">⚠️ Precisa ter alguém no local para receber. Se não houver recebedor, a entrega será reagendada para até <b>15 dias</b>.</div>'+
  '<button class="btn pri" id="ok" '+(sel||(D.agendada&&loc)?'':'disabled')+'>'+(sel?'Confirmar '+esc((D.datas.find(x=>x.data===sel)||{}).texto||''):D.agendada?'Enviar localização':'Escolha uma data')+'</button><div class="erro" id="er"></div>';
  A.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{sel=b.dataset.d;loc=loc||lkv();tela()});
  document.getElementById('lk').oninput=e=>{loc=e.target.value.trim();const ok=document.getElementById('ok');if(!sel&&D.agendada){ok.disabled=!loc}};
  document.getElementById('gps').onclick=()=>{const g=document.getElementById('gpsok');if(!navigator.geolocation){g.textContent='Seu celular não permitiu. Cole o link do Google Maps.';return}g.textContent='Pegando localização…';
    navigator.geolocation.getCurrentPosition(p=>{loc=p.coords.latitude.toFixed(6)+','+p.coords.longitude.toFixed(6);tela()},()=>{g.textContent='Não consegui pegar a localização. Permita o acesso ou cole o link do Google Maps.'},{enableHighAccuracy:true,timeout:15000})};
  document.getElementById('ok').onclick=enviar;
}
function lkv(){const e=document.getElementById('lk');return e?e.value.trim():''}
async function enviar(){const b=document.getElementById('ok'),er=document.getElementById('er');b.disabled=true;b.textContent='Enviando…';er.textContent='';
  try{const r=await api('POST',{data:sel||'',local:loc||lkv()});
    A.innerHTML='<div class="card feito"><div class="big">✅</div><h2>Prontinho!</h2>'+(r.data?'<div>Sua entrega está agendada para <b>'+esc(r.data_texto)+'</b>, em horário comercial.</div>':'')+(r.localizacao?'<div class="ok" style="margin-top:8px">📍 Localização recebida, obrigada!</div>':'')+'<div class="mu" style="margin-top:12px">Lembre que precisa ter alguém no local para receber 🙂<br>Precisa mudar? Abra este link de novo.</div></div>'}
  catch(e){er.textContent=e.message;b.disabled=false;b.textContent='Tentar de novo'}}
api('GET').then(j=>{D=j;tela()}).catch(e=>{A.innerHTML='<div class="card"><h2>😕 '+esc(e.message)+'</h2></div>'});
</script></body></html>`;

async function handle(req, res, u, { pool, sendJson, readJsonBodyLimited, dashboardSession, dashboardHas, clientes, desligado = false, base }) {
  const p = u.pathname;
  const pagina = /^\/agendar\/[A-Za-z0-9_-]{20,40}\/?$/.test(p), api = /^\/api\/agendar\/[A-Za-z0-9_-]{20,40}$/.test(p), painel = p === '/api/painel/agendamento-whatsapp/link';
  const rel = p === '/api/painel/agendamento-whatsapp/relatorio';
  if (!pagina && !api && !painel && !rel) return false;
  if (desligado) { sendJson(res, 404, { ok: false, error: 'Não disponível.' }); return true; }
  try {
    if (pagina && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
      res.end(PAGINA); return true;
    }
    const token = p.split('/').pop();
    if (api && req.method === 'GET') return sendJson(res, 200, await dadosLink(pool, token)), true;
    if (api && req.method === 'POST') return sendJson(res, 200, await escolher(pool, token, await readJsonBodyLimited(req, 16 * 1024))), true;
    if (rel && req.method === 'GET') {
      const user = await dashboardSession(req, false);
      if (!(user.is_admin || (dashboardHas && (dashboardHas(user, 'agendamentos_sac') || dashboardHas(user, 'agendamentos'))))) throw erro(403, 'Sem acesso ao relatório do WhatsApp.');
      const cli = user.client_id ? String(user.client_id) : ((await clientes())[0] ?? null);
      return sendJson(res, 200, await relatorio(pool, cli, Object.fromEntries(u.searchParams))), true;
    }
    if (painel && req.method === 'POST') {
      const user = await dashboardSession(req, false);
      if (!(user.is_admin || (dashboardHas && dashboardHas(user, 'agendamentos_sac')))) throw erro(403, 'Só usuários do SAC enviam o link de agendamento.');
      const cli = user.client_id ? String(user.client_id) : ((await clientes())[0] ?? null);
      const b = await readJsonBodyLimited(req, 16 * 1024);
      const raiz = base || (String(req.headers['x-forwarded-proto'] || 'https').split(',')[0] + '://' + req.headers.host);
      return sendJson(res, 200, { ok: true, ...(await criarLink(pool, cli, user, b.nota_id, raiz)) }), true;
    }
    return sendJson(res, 405, { ok: false, error: 'Método não permitido.' }), true;
  } catch (e) { return sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Não consegui completar agora. Tente de novo.' }), true; }
}

module.exports = { ensureSchema, criarLink, relatorio, dadosLink, escolher, mensagem, handle, PAGINA };
