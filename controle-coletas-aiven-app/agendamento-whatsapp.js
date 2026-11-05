'use strict';
// Agendamento de entregas pelo WhatsApp (API oficial da Meta, WhatsApp Cloud API), sem o SAC.
//
// Como funciona:
//   1. A cada 15 min (08h às 18h, seg a sáb) procura notas pendentes, sem agendamento, com celular do destinatário
//      e cidade com rota na grade (opção 107 do SSW). As notas do mesmo celular na mesma cidade vão juntas.
//   2. Manda ao destinatário as próximas datas válidas para a cidade dele (dias da rota, prazo, sem domingo e feriado).
//      Fora da janela de 24 h do WhatsApp vai primeiro o modelo aprovado pela Meta, com o botão "Escolher data".
//   3. O cliente escolhe a data na lista e o agendamento é gravado pelo mesmo caminho do SAC (agendamento.agendar),
//      com o usuário "WhatsApp". Remarcar usa agendamento.alterar.
//   4. Véspera da entrega (10h): lembrete com Confirmar / Remarcar.
//   5. O que o robô não resolve vai para o SAC (estado 'sac' na conversa e evento "whatsapp" no histórico da nota):
//      cliente pediu atendente, mandou texto que o robô não entende, cliente reservado por alguém do SAC, sem resposta em 48 h.
//
// Liga com as variáveis do Render:
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID      envio (token permanente do usuário do sistema)
//   WHATSAPP_VERIFY_TOKEN                   texto combinado com a Meta para validar o webhook
//   WHATSAPP_APP_SECRET                     chave secreta do app: confere a assinatura de cada aviso da Meta
//   WHATSAPP_AUTO=1                         envio automático das ofertas (sem ele, só o teste manual pelo painel)
//   WHATSAPP_TESTE_FONES                    se preenchido, só manda para estes números (vírgula entre eles)
//   WHATSAPP_MODELO_OFERTA / _LEMBRETE      nomes dos modelos aprovados (padrão agendamento_entrega / lembrete_entrega)
// Testado em tests/agendamento-whatsapp.js (sem rede: a API da Meta é simulada).

const crypto = require('crypto');
const ag = require('./agendamento');
const GRADE = require('./agendamento-rotas.json');

const USUARIO = { id: null, username: 'WhatsApp', is_admin: false };
const DIAS_NOME = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HORA_CORTE = '18:00';          // a partir das 18h, "amanhã" já não dá para programar: a primeira data anda um dia
const OFERTAS_POR_VEZ = 30;          // por rodada de 15 min (não estoura o limite de envio da Meta)
const DATAS_NA_LISTA = 6;
const HORAS_SEM_RESPOSTA = 48;

const limpo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const semAcento = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
// "Santa Bárbara d'Oeste" = "SANTA BARBARA D OESTE" (como sai na grade do SSW)
const chaveCidade = v => semAcento(v).replace(/[^A-Z0-9]+/g, ' ').trim();
const hojeSp = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const horaSp = (d = new Date()) => d.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const isoMais = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSemana = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
const br = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const dataLonga = iso => DIAS_NOME[diaSemana(iso)] + ', ' + br(iso);

// ------------------------------------------------------------------ feriados nacionais
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}
const FERIADOS_CACHE = new Map();
function feriados(ano) {
  if (FERIADOS_CACHE.has(ano)) return FERIADOS_CACHE.get(ano);
  const p = pascoa(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(x => ano + '-' + x);
  // Carnaval (seg e ter), Sexta-feira Santa e Corpus Christi
  const s = new Set(fixos.concat([isoMais(p, -48), isoMais(p, -47), isoMais(p, -2), isoMais(p, 60)]));
  FERIADOS_CACHE.set(ano, s);
  return s;
}
const ehFeriado = iso => feriados(Number(iso.slice(0, 4))).has(iso);

// ------------------------------------------------------------------ datas válidas da rota
// dias = "STQQS." (seg a sáb, ponto = não entrega). Primeira data: hoje + prazo (mínimo 1 dia), mais um dia a partir das 18h.
function proximasDatas(rota, { agora = new Date(), n = DATAS_NA_LISTA, extras = [] } = {}) {
  if (!rota || !rota.entrega || !/^[STQ.]{6}$/.test(rota.dias || '') || !/[STQ]/.test(rota.dias)) return [];
  const bloqueadas = new Set(extras), sabados = new Set(rota.sabados || []);   // sábado avulso aberto pelo administrador
  let ini = Math.max(1, Number(rota.prazo) || 1);
  if (horaSp(agora) >= HORA_CORTE) ini++;
  const hoje = hojeSp(agora), out = [];
  for (let i = ini; i <= ini + 45 && out.length < n; i++) {
    const d = isoMais(hoje, i), w = diaSemana(d);
    if (w === 0 || (rota.dias[w - 1] === '.' && !(w === 6 && sabados.has(d))) || ehFeriado(d) || bloqueadas.has(d)) continue;
    out.push(d);
  }
  return out;
}

// Datas da rota sem as que já bateram o limite diário da cidade para o grupo de remetentes das notas (agendamento.js)
const chaveCliente = (dest, cidade) => [dest, cidade].map(v => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase()).join('|');
async function datasDisponiveis(db, cli, rota, { agora = new Date(), n = DATAS_NA_LISTA, cidade = '', uf = '', remetentes = [], cliente = '' } = {}) {
  const base = proximasDatas(rota, { agora, n: n + 15 });
  if (!base.length) return [];
  const lotadas = await ag.datasLotadas(db, cli, { cidade: cidade || (rota && rota.cidade) || '', uf: uf || (rota && rota.uf) || '', remetentes, cliente, datas: base });
  return base.filter(d => !lotadas.has(d)).slice(0, n);
}

// ------------------------------------------------------------------ telefones
// Celular do texto gravado na nota ("(19) 99888-7766 / (19) 3333-4444") -> "5519998887766". Fixo não serve.
function celular(texto) {
  for (const parte of String(texto || '').split(/[\/,;]| ou /)) {
    let d = parte.replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);   // celular antigo, sem o 9
    if (d.length === 11 && d[2] === '9' && !/^0/.test(d)) return '55' + d;
  }
  return '';
}
// A Meta às vezes devolve o número do Brasil sem o 9 ("551998887766"): a chave ignora o 9 para casar os dois.
function chaveFone(f) {
  let d = String(f || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') d = d.slice(0, 4) + d.slice(5);
  return d;
}

// ------------------------------------------------------------------ configuração
function configDoAmbiente(env = process.env) {
  const teste = String(env.WHATSAPP_TESTE_FONES || '').split(/[,;\s]+/).map(x => chaveFone(celular(x) || x)).filter(x => x.length >= 10);
  return {
    token: String(env.WHATSAPP_TOKEN || '').trim(),
    phoneId: String(env.WHATSAPP_PHONE_ID || '').trim(),
    verify: String(env.WHATSAPP_VERIFY_TOKEN || '').trim(),
    appSecret: String(env.WHATSAPP_APP_SECRET || '').trim(),
    api: String(env.WHATSAPP_API || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
    auto: /^(1|true|sim)$/i.test(String(env.WHATSAPP_AUTO || '').trim()),
    teste,
    modeloOferta: limpo(env.WHATSAPP_MODELO_OFERTA || 'agendamento_entrega', 80),
    modeloLembrete: limpo(env.WHATSAPP_MODELO_LEMBRETE || 'lembrete_entrega', 80),
    idioma: limpo(env.WHATSAPP_IDIOMA || 'pt_BR', 10),
  };
}
const podeEnviar = cfg => !!(cfg.token && cfg.phoneId);
const liberadoPara = (cfg, fone) => !cfg.teste.length || cfg.teste.includes(chaveFone(fone));

// ------------------------------------------------------------------ banco
async function ensureSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_rotas (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, uf TEXT NOT NULL, cidade TEXT NOT NULL, chave TEXT NOT NULL,
    praca TEXT, dias TEXT NOT NULL, prazo INTEGER, entrega BOOLEAN NOT NULL DEFAULT TRUE, restrito BOOLEAN NOT NULL DEFAULT FALSE,
    origem TEXT, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_ag_rotas ON ag_rotas (COALESCE(client_id,0), uf, chave)');
  // definidos pelo administrador: máximo de entregas por dia na cidade (por grupo de remetentes) e sábados abertos avulsos
  await pool.query('ALTER TABLE ag_rotas ADD COLUMN IF NOT EXISTS limite_dia INTEGER');
  await pool.query("ALTER TABLE ag_rotas ADD COLUMN IF NOT EXISTS sabados DATE[] NOT NULL DEFAULT '{}'");
  // uma conversa = um celular + as notas oferecidas juntas
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_wa_conversas (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, telefone TEXT NOT NULL, chave_fone TEXT NOT NULL, nota_ids BIGINT[] NOT NULL,
    destinatario TEXT, cidade TEXT, uf TEXT, estado TEXT NOT NULL DEFAULT 'oferta',
    datas TEXT[] NOT NULL DEFAULT '{}', data_escolhida DATE, motivo_sac TEXT, origem TEXT NOT NULL DEFAULT 'auto',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    respondido_em TIMESTAMPTZ, lembrete_em TIMESTAMPTZ)`);
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_wa_conv_fone ON ag_wa_conversas (chave_fone, atualizado_em DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_wa_conv_notas ON ag_wa_conversas USING GIN (nota_ids)');
  await pool.query(`CREATE TABLE IF NOT EXISTS ag_wa_mensagens (
    id BIGSERIAL PRIMARY KEY, client_id BIGINT, conversa_id BIGINT, telefone TEXT NOT NULL, chave_fone TEXT NOT NULL,
    direcao TEXT NOT NULL, tipo TEXT, texto TEXT, wamid TEXT, status TEXT, erro TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_ag_wa_msg_wamid ON ag_wa_mensagens (wamid, direcao) WHERE wamid IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS ix_ag_wa_msg_fone ON ag_wa_mensagens (chave_fone, criado_em DESC)');
}

// Grade da opção 107 gravada no arquivo agendamento-rotas.json: carrega na primeira vez de cada empresa.
async function garantirRotas(pool, cli) {
  const q = await pool.query('SELECT COUNT(*)::int n FROM ag_rotas WHERE client_id IS NOT DISTINCT FROM $1', [cli]);
  if (q.rows[0].n) return 0;
  return gravarRotas(pool, cli, GRADE.cidades, 'grade SSW 107');
}
async function gravarRotas(pool, cli, cidades, origem) {
  let n = 0;
  for (const c of cidades || []) {
    const uf = limpo(c.uf, 2).toUpperCase(), cidade = limpo(c.cidade, 80), dias = String(c.dias || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade || !/^[STQ.]{6}$/.test(dias)) continue;
    await pool.query(`INSERT INTO ag_rotas(client_id,uf,cidade,chave,praca,dias,prazo,entrega,restrito,origem) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (COALESCE(client_id,0),uf,chave) DO UPDATE SET cidade=$3,praca=$5,dias=$6,prazo=$7,entrega=$8,restrito=$9,origem=$10,atualizado_em=NOW()`,
      [cli, uf, cidade, chaveCidade(cidade), limpo(c.praca, 20) || null, dias, Number.isInteger(c.prazo) ? c.prazo : null, c.entrega !== false, !!c.restrito, origem]);
    n++;
  }
  return n;
}
async function rotaDa(db, cli, cidade, uf) {
  const q = await db.query('SELECT uf,cidade,dias,prazo,entrega,restrito,limite_dia,ARRAY(SELECT to_char(x,\'YYYY-MM-DD\') FROM unnest(sabados) x ORDER BY x) AS sabados FROM ag_rotas WHERE client_id IS NOT DISTINCT FROM $1 AND chave=$2 AND ($3=\'\' OR uf=$3) ORDER BY (uf=$3) DESC LIMIT 1',
    [cli, chaveCidade(cidade), limpo(uf, 2).toUpperCase()]);
  return q.rows[0] || null;
}
async function eventoNotas(db, cli, ids, para, detalhe) {
  for (const id of ids) await db.query('INSERT INTO ag_eventos(client_id,nota_id,tipo,para,detalhe,usuario) VALUES($1,$2,$3,$4,$5,$6)', [cli, id, 'whatsapp', para || null, detalhe ? limpo(detalhe, 500) : null, 'WhatsApp']);
}

// ------------------------------------------------------------------ envio (WhatsApp Cloud API)
async function enviar(ctx, conv, fone, corpo, resumo) {
  const { pool, cfg, fetchFn = fetch } = ctx;
  const cli = conv ? conv.client_id : ctx.cli ?? null;
  if (!podeEnviar(cfg)) throw Object.assign(new Error('WhatsApp não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID).'), { status: 503 });
  if (!liberadoPara(cfg, fone)) throw Object.assign(new Error('Modo de teste: ' + fone + ' não está em WHATSAPP_TESTE_FONES.'), { status: 403 });
  const r = await fetchFn(cfg.api + '/' + cfg.phoneId + '/messages', {
    method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: fone, ...corpo }), signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  const wamid = j.messages && j.messages[0] && j.messages[0].id || null;
  const erro = r.ok ? null : limpo((j.error && (j.error.error_data && j.error.error_data.details || j.error.message)) || ('HTTP ' + r.status), 300);
  await pool.query('INSERT INTO ag_wa_mensagens(client_id,conversa_id,telefone,chave_fone,direcao,tipo,texto,wamid,status,erro) VALUES($1,$2,$3,$4,\'out\',$5,$6,$7,$8,$9)',
    [cli, conv ? conv.id : null, fone, chaveFone(fone), corpo.type, limpo(resumo, 1000), wamid, erro ? 'erro' : 'enviada', erro]);
  if (erro) throw Object.assign(new Error('WhatsApp recusou: ' + erro), { status: 502, meta: j.error });
  return wamid;
}
const texto = (ctx, conv, fone, t) => enviar(ctx, conv, fone, { type: 'text', text: { body: t, preview_url: false } }, t);

// janela de 24 h: o cliente escreveu nas últimas 24 h -> mensagem livre; senão, só modelo aprovado
async function janelaAberta(db, fone) {
  const q = await db.query("SELECT 1 FROM ag_wa_mensagens WHERE chave_fone=$1 AND direcao='in' AND criado_em>NOW()-INTERVAL '23 hours 50 minutes' LIMIT 1", [chaveFone(fone)]);
  return !!q.rowCount;
}

const nfsTexto = notas => { const l = [...new Set(notas.map(n => n.nf))]; return (l.length > 1 ? 'NFs ' : 'NF ') + (l.length > 4 ? l.slice(0, 4).join(', ') + ' e mais ' + (l.length - 4) : l.join(', ')); };
// Nome da loja como o cliente conhece: "QUADRI COMERCIO ELETRONIC .." -> "Quadri".
// A razão social vem cortada do SSW; tira o pedaço cortado, a parte jurídica/atividade e deixa só a marca.
const PALAVRA_GENERICA = /^(com[eé]rcio|comercial|com\.?|eletr[oô]nic\w*|distribui\w*|dist\.?|ind[uú]stri\w*|ind\.?|importa\w*|exporta\w*|atacad\w*|varejo|varejista|servi[cç]os?|log[ií]stica|transportes?|cia\.?|ltda\.?|me|epp|eireli|s\/?a\.?|s\.a\.?)$/i;
const CONECTIVO = /^(de|da|do|dos|das|e)$/i;
function nomeLoja(v) {
  const bruto = limpo(v, 80), cortado = /\.\.+\s*$|…\s*$/.test(bruto);
  let p = bruto.replace(/[\s.…]+$/, '').split(' ').filter(Boolean);
  if (cortado && p.length > 1) p.pop();                       // a última palavra veio pela metade
  const i = p.findIndex((w, k) => k > 0 && PALAVRA_GENERICA.test(w));
  if (i > 0) p = p.slice(0, i);
  while (p.length > 1 && CONECTIVO.test(p[p.length - 1])) p.pop();
  // sigla sem vogal (FCB) ou nome de uma palavra curta (ABC) fica em maiúsculas; o resto vira "Casa do Construtor"
  const sigla = w => /^[A-Z0-9&]{2,5}$/.test(w) && (!/[AEIOU]/.test(w) || p.length === 1);
  return titulo(p.slice(0, 4).join(' ')).split(' ').map((w, k) => sigla(p[k]) ? p[k] : w).join(' ');
}
const titulo = t => limpo(t, 80).toLowerCase().split(' ').map((w, k) => k > 0 && CONECTIVO.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const remetentes = notas => [...new Set(notas.map(n => nomeLoja(n.remetente)).filter(Boolean))].slice(0, 2).join(' e ') || 'nosso cliente';
// "MADA CABRAL 1330321" -> "Mada" (só o primeiro nome; o número do pedido colado no nome sai); empresa (LTDA, loja...) fica sem nome no "Olá"
const primeiroNome = v => {
  const s = limpo(String(v || '').replace(/\s+\d{4,}\s*$/, ''), 60);
  if (!s || /\b(ltda|eireli|me|epp|s\/?a|cia|comercio|com[eé]rcio|ind[uú]stria|materiais|dep[oó]sito|loja|construtora|condom[ií]nio)\b/i.test(s)) return '';
  const p = s.split(' ').find(w => /^[a-zà-ú'-]{2,}$/i.test(w));
  return p ? titulo(p) : '';
};
const cidadeUf = (cidade, uf) => titulo(limpo(cidade, 40)) + (uf ? '/' + limpo(uf, 2).toUpperCase() : '');
const NAO_COBRAMOS = 'Você só escolhe a data: *não pedimos pagamento, taxa, senha nem dados bancários*.';

async function notasDa(db, conv) {
  return (await db.query(`SELECT n.id::text,n.nf,n.remetente,n.destinatario,n.cidade,n.uf,n.situacao,
      (SELECT a.id::text FROM ag_agendamentos a WHERE a.nota_id=n.id AND a.status='ativo') AS ag_id,
      (SELECT to_char(a.data_agendada,'YYYY-MM-DD') FROM ag_agendamentos a WHERE a.nota_id=n.id AND a.status='ativo') AS ag_data
    FROM ag_notas n WHERE n.id=ANY($1::bigint[]) ORDER BY n.nf`, [conv.nota_ids])).rows;
}

// ------------------------------------------------------------------ textos do agendamento
// A mensagem fala como empresa (sem personagem), diz de qual loja é a compra (o cliente não conhece a Construlog),
// traz a NF (dado que golpista não tem) e deixa claro que não se pede pagamento: o cliente achava que era golpe.
const ANA = {
  ola: nome => 'Olá' + (nome ? ', ' + nome : '') + '!',
  entrega: (notas, cidade, uf) => 'A *Construlog* é a transportadora responsável pela entrega da sua compra na *' + remetentes(notas) + '*.\n\n' +
    '📦 Nota fiscal: ' + nfsTexto(notas).replace(/^NFs? /, '') + '\n📍 Entrega em: ' + cidadeUf(cidade, uf),
  escolha: 'Toque em *Ver datas* para escolher o melhor dia para receber.\n' + NAO_COBRAMOS,
  naoReconhece: 'Obrigado por avisar! Não vamos agendar nada. Uma pessoa da nossa equipe vai conferir o pedido e, se precisar, fala com você por aqui.',
  apresentacao: 'Olá! Aqui é a *Construlog*, transportadora 🚚\n\nPor este número agendamos as entregas das compras que transportamos. Quando houver uma entrega para você, enviamos as datas disponíveis por aqui.\n\nNão pedimos pagamento, taxa, senha nem dados bancários.',
  agendado: (data, notas) => '✅ *Prontinho!* Sua entrega está agendada para *' + dataLonga(data) + '*, em horário comercial.\n📦 ' + nfsTexto(notas) +
    '\n\n⚠️ *Importante:* precisa ter alguém no local para receber. Se não houver recebedor, a entrega será reagendada para até *15 dias*.\n\n🔔 Na véspera eu mando um lembrete. Precisa mudar a data? É só responder *REMARCAR*.',
  pedeLocal: '📍 Para o motorista chegar certinho, pode me enviar a *localização* do endereço de entrega?\n\n📱 *Android:* toque no 📎 (clipe) → *Localização*\n🍎 *iPhone:* toque no ➕ → *Localização*\n\nSe não estiver no local, pode colar aqui o link do endereço no Google Maps 🗺️',
  localOk: '📍 Localização recebida, obrigado! Já está no seu agendamento para o motorista 🚚',
  localRuim: 'Não consegui ler essa localização 😕 Tente pelo 📎 (Android) ou ➕ (iPhone) → *Localização*, ou cole o link do Google Maps.',
  indisponivel: 'Essa data não está mais disponível 😕 Escolha outra, por favor 👇',
  paraAtendente: 'Tudo bem! 🙋‍♀️ Vou chamar uma pessoa da nossa equipe para falar com você por aqui.',
  confirmouSac: 'Recebi a sua escolha 👍 Uma pessoa da nossa equipe vai confirmar com você por aqui.',
  semData: cidade => 'Não encontrei uma data de entrega disponível para ' + limpo(cidade, 40) + ' 😕 Uma pessoa da nossa equipe vai falar com você por aqui.',
  naoEntendi: 'Recebi sua mensagem 😉 Uma pessoa da nossa equipe vai responder por aqui.',
  confirmado: 'Obrigado! Entrega confirmada ✅ Até amanhã 🚚',
  ateLa: 'Obrigado! Até lá 🚚',
  lembrete: (nome, data, notas) => '⏰ Oi' + (nome ? ', ' + nome : '') + '! Aqui é da *Construlog*, transportadora da sua compra.\n\nSua entrega chega *amanhã, ' + dataLonga(data) + '*, em horário comercial.\n📦 ' + nfsTexto(notas) + '\n\nLembre que precisa ter alguém no local para receber 🙂',
};

// Lista com as datas (dentro da janela de 24 h)
async function enviarDatas(ctx, conv, intro) {
  const { pool } = ctx;
  const notas = await notasDa(pool, conv);
  const rota = await rotaDa(pool, conv.client_id, conv.cidade, conv.uf);
  const datas = await datasDisponiveis(pool, conv.client_id, rota, { agora: ctx.agora ? ctx.agora() : new Date(), cidade: conv.cidade, uf: conv.uf, remetentes: notas.map(x => x.remetente), cliente: chaveCliente(conv.destinatario, conv.cidade) });
  if (!datas.length) return paraSac(ctx, conv, 'Cidade sem dia de entrega na grade', ANA.semData(conv.cidade));
  await pool.query("UPDATE ag_wa_conversas SET datas=$2,estado=CASE WHEN estado='agendado' THEN 'remarcando' ELSE 'escolhendo' END,atualizado_em=NOW() WHERE id=$1", [conv.id, datas]);
  const corpo = (intro ? intro + '\n\n' : '') + ANA.entrega(notas, conv.cidade, conv.uf) + '\n\n' + ANA.escolha;
  const rows = datas.map(d => ({ id: 'd:' + conv.id + ':' + d, title: DIAS_CURTO[diaSemana(d)] + ' ' + br(d), description: DIAS_NOME[diaSemana(d)] + ' · horário comercial' }));
  rows.push({ id: 'sac:' + conv.id, title: 'Nenhuma data serve', description: 'Falar com uma pessoa da equipe' });
  rows.push({ id: 'nr:' + conv.id, title: 'Não reconheço a compra', description: 'Avisar a equipe e não agendar' });
  return enviar(ctx, conv, conv.telefone, {
    type: 'interactive',
    interactive: { type: 'list', header: { type: 'text', text: ('🚚 Entrega da sua compra na ' + remetentes(notas)).slice(0, 60) }, body: { text: corpo.slice(0, 1024) }, footer: { text: 'Construlog · Transportadora' },
      action: { button: 'Ver datas', sections: [{ title: 'Datas disponíveis', rows }] } },
  }, 'Lista de datas: ' + datas.map(br).join(', '));
}

// Primeiro contato: lista direto se a janela estiver aberta; senão o modelo aprovado com o botão "Escolher data"
async function ofertar(ctx, conv) {
  const { pool, cfg } = ctx;
  if (await janelaAberta(pool, conv.telefone)) return enviarDatas(ctx, conv, ANA.ola(primeiroNome(conv.destinatario)));
  const notas = await notasDa(pool, conv);
  return enviar(ctx, conv, conv.telefone, {
    type: 'template',
    template: { name: cfg.modeloOferta, language: { code: cfg.idioma }, components: [
      { type: 'body', parameters: [{ type: 'text', text: primeiroNome(conv.destinatario) || 'cliente' }, { type: 'text', text: nfsTexto(notas) }, { type: 'text', text: remetentes(notas) }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'ofertar:' + conv.id }] },
    ] },
  }, 'Modelo ' + cfg.modeloOferta + ': ' + nfsTexto(notas));
}

async function paraSac(ctx, conv, motivo, aviso) {
  const { pool } = ctx;
  await pool.query("UPDATE ag_wa_conversas SET estado='sac',motivo_sac=$2,atualizado_em=NOW() WHERE id=$1", [conv.id, limpo(motivo, 300)]);
  await eventoNotas(pool, conv.client_id, conv.nota_ids, 'SAC', motivo);
  if (aviso) await texto(ctx, conv, conv.telefone, aviso).catch(e => console.log('WHATSAPP aviso SAC: ' + e.message));
}

// Cliente escolheu a data: grava (ou remarca) todas as notas da conversa e pede a localização
async function escolherData(ctx, conv, data) {
  const { pool } = ctx;
  const notas = await notasDa(pool, conv);
  if (!conv.datas.includes(data) || !(await datasDisponiveis(pool, conv.client_id, await rotaDa(pool, conv.client_id, conv.cidade, conv.uf), { agora: ctx.agora ? ctx.agora() : new Date(), n: 30,
      cidade: conv.cidade, uf: conv.uf, remetentes: notas.map(x => x.remetente), cliente: chaveCliente(conv.destinatario, conv.cidade) })).includes(data))
    return enviarDatas(ctx, conv, ANA.indisponivel);
  const feitas = [], problemas = [];
  for (const n of notas) {
    if (ag.FINAIS.includes(n.situacao)) continue;
    try {
      if (n.ag_id) { if (n.ag_data !== data) await ag.alterar(pool, conv.client_id, USUARIO, n.ag_id, { data_agendada: data, motivo: 'Remarcado pelo cliente no WhatsApp' }); }
      else await ag.agendar(pool, conv.client_id, USUARIO, { nota_id: n.id, data_agendada: data, observacao: 'Agendado pelo cliente no WhatsApp (' + conv.telefone + ')' });
      feitas.push(n);
    } catch (e) { problemas.push('NF ' + n.nf + ': ' + e.message); }
  }
  if (!feitas.length) return paraSac(ctx, conv, 'Não gravou pelo WhatsApp: ' + problemas.join(' | '), ANA.confirmouSac);
  await pool.query("UPDATE ag_wa_conversas SET estado='agendado',data_escolhida=$2,lembrete_em=NULL,motivo_sac=$3,atualizado_em=NOW() WHERE id=$1", [conv.id, data, problemas.length ? limpo(problemas.join(' | '), 300) : null]);
  if (problemas.length) await eventoNotas(pool, conv.client_id, conv.nota_ids, 'SAC', 'Parte das notas não foi agendada: ' + problemas.join(' | '));
  await texto(ctx, conv, conv.telefone, ANA.agendado(data, feitas));
  // a localização do cliente já guardada (destinatário + cidade) vale para esta entrega: não pede de novo
  if (!(await temLocal(pool, conv))) await texto(ctx, conv, conv.telefone, ANA.pedeLocal);
  return 'agendado';
}

// ------------------------------------------------------------------ localização do cliente
async function temLocal(db, conv) {
  const q = await db.query(`SELECT 1 FROM ag_locais l JOIN ag_notas n ON COALESCE(l.client_id,0)=COALESCE(n.client_id,0)
      AND l.chave=upper(regexp_replace(trim(COALESCE(n.destinatario,'')),'\\s+',' ','g'))||'|'||upper(regexp_replace(trim(COALESCE(n.cidade,'')),'\\s+',' ','g'))
    WHERE n.id=ANY($1::bigint[]) LIMIT 1`, [conv.nota_ids]);
  return !!q.rowCount;
}
// Pino do WhatsApp (mensagem do tipo location) ou link do Google Maps / Waze no texto -> campo Localização do agendamento
async function receberLocal(ctx, conv, entrada) {
  const { pool } = ctx;
  let ok = 0;
  for (const id of conv.nota_ids) {
    try { await ag.gravarLocalizacao(pool, conv.client_id, USUARIO, String(id), entrada, ctx.abrirLink ? { abrir: ctx.abrirLink } : undefined); ok++; }
    catch (e) { console.log('WHATSAPP localização nota ' + id + ': ' + e.message); }
  }
  await texto(ctx, conv, conv.telefone, ok ? ANA.localOk : ANA.localRuim);
  return ok ? 'localizacao' : 'localizacao_invalida';
}
const TEM_LINK_MAPA = /https?:\/\/\S*(google\.[a-z.]+\/maps|maps\.google|goo\.gl|maps\.app\.goo\.gl|waze\.com|maps\.apple\.com)/i;

// ------------------------------------------------------------------ mensagens recebidas
async function conversaDoFone(db, fone, id) {
  const p = [chaveFone(fone)];
  let w = 'chave_fone=$1';
  if (id) { p.push(String(id)); w += ' AND id=$2'; }
  return (await db.query(`SELECT * FROM ag_wa_conversas WHERE ${w} ORDER BY (estado IN ('oferta','escolhendo','remarcando','agendado')) DESC, atualizado_em DESC LIMIT 1`, p)).rows[0] || null;
}
const PEDE_REMARCAR = /\b(remarcar|reagendar|mudar|trocar|alterar|outra data|outro dia)\b/i;
const PEDE_ATENDENTE = /\b(atendente|humano|pessoa|falar com|ajuda|sac)\b/i;
const CONFIRMA = /^\s*(ok|sim|confirm\w*|certo|combinado|beleza|blz|obrigad\w*|valeu|👍)\s*[.!]*\s*$/i;

async function receber(ctx, m) {
  const { pool } = ctx;
  const fone = String(m.from || '');
  const loc = m.type === 'location' && m.location && Number.isFinite(Number(m.location.latitude)) ? Number(m.location.latitude) + ',' + Number(m.location.longitude) : '';
  const txt = m.type === 'text' ? limpo(m.text && m.text.body, 1000)
    : m.type === 'interactive' ? limpo((m.interactive.list_reply || m.interactive.button_reply || {}).title, 200)
    : m.type === 'button' ? limpo(m.button && m.button.text, 200)
    : loc ? 'Localização: ' + loc : '[' + m.type + ']';
  const resposta = m.type === 'interactive' ? (m.interactive.list_reply || m.interactive.button_reply || {}).id
    : m.type === 'button' ? m.button && m.button.payload : '';
  const ref = String(resposta || '').match(/^(d|sac|nr|ofertar|confirmar|remarcar):(\d+)(?::(\d{4}-\d{2}-\d{2}))?$/);
  const conv = await conversaDoFone(pool, fone, ref && ref[2]);
  const ins = await pool.query("INSERT INTO ag_wa_mensagens(client_id,conversa_id,telefone,chave_fone,direcao,tipo,texto,wamid,status) VALUES($1,$2,$3,$4,'in',$5,$6,$7,'recebida') ON CONFLICT DO NOTHING RETURNING id",
    [conv ? conv.client_id : null, conv ? conv.id : null, fone, chaveFone(fone), m.type, txt, m.id || null]);
  if (!ins.rowCount) return 'repetida';   // a Meta reenvia o mesmo aviso: processa uma vez só
  if (!conv) {
    await texto(ctx, null, fone, ANA.apresentacao).catch(() => {});
    return 'sem_conversa';
  }
  await pool.query('UPDATE ag_wa_conversas SET respondido_em=NOW(),atualizado_em=NOW() WHERE id=$1', [conv.id]);
  // o número da Meta pode vir sem o 9: as próximas mensagens vão para o formato que a Meta usa
  if (fone && fone !== conv.telefone) { await pool.query('UPDATE ag_wa_conversas SET telefone=$2 WHERE id=$1', [conv.id, fone]); conv.telefone = fone; }
  const tipo = ref ? ref[1] : '';
  if (tipo === 'd') return escolherData(ctx, conv, ref[3]);
  if (tipo === 'sac') return paraSac(ctx, conv, 'Cliente pediu outra data / atendente', ANA.paraAtendente);
  if (tipo === 'nr') return paraSac(ctx, conv, 'Cliente não reconhece a compra', ANA.naoReconhece);
  if (tipo === 'ofertar' || tipo === 'remarcar') return enviarDatas(ctx, conv, '');
  if (tipo === 'confirmar') { await eventoNotas(pool, conv.client_id, conv.nota_ids, 'confirmado', 'Cliente confirmou a entrega no lembrete'); return texto(ctx, conv, conv.telefone, ANA.confirmado); }
  // localização vale em qualquer momento da conversa (inclusive com o SAC)
  if (loc || (m.type === 'text' && TEM_LINK_MAPA.test(txt))) return receberLocal(ctx, conv, loc || txt);
  if (conv.estado === 'sac') { await eventoNotas(pool, conv.client_id, conv.nota_ids, null, 'Mensagem do cliente: ' + txt); return 'sac'; }
  if (conv.estado === 'agendado' && CONFIRMA.test(txt)) return texto(ctx, conv, conv.telefone, ANA.ateLa);
  if (PEDE_ATENDENTE.test(txt)) return paraSac(ctx, conv, 'Cliente pediu atendente: ' + txt, ANA.paraAtendente);
  if (PEDE_REMARCAR.test(txt) || ['oferta', 'escolhendo', 'remarcando', 'sem_resposta'].includes(conv.estado)) return enviarDatas(ctx, conv, conv.estado === 'agendado' || conv.estado === 'remarcando' ? '' : ANA.escolha.replace('Toque', 'Para agendar, toque'));
  return paraSac(ctx, conv, 'Mensagem que o robô não entendeu: ' + txt, ANA.naoEntendi);
}

function statusEnvio(ctx, s) {
  const erro = s.errors && s.errors[0] ? limpo(s.errors[0].error_data && s.errors[0].error_data.details || s.errors[0].title || s.errors[0].message, 300) : null;
  return ctx.pool.query("UPDATE ag_wa_mensagens SET status=$2,erro=COALESCE($3,erro) WHERE wamid=$1 AND direcao='out'", [s.id, limpo(s.status, 20), erro]);
}

// ------------------------------------------------------------------ rodadas automáticas
// Notas prontas para oferta: pendentes, sem agendamento, de parceiro, sem conversa aberta ou recente, cliente sem reserva do SAC.
async function candidatas(pool, cli) {
  const cfgAg = await ag.lerConfig(pool, cli);
  const termos = ag.termosParceiros(cfgAg.parceiros);
  const rows = (await pool.query(`SELECT n.id::text,n.nf,n.remetente,n.pagador,n.destinatario,n.cidade,n.uf,n.telefone FROM ag_notas n
    WHERE n.client_id IS NOT DISTINCT FROM $1 AND n.tipo_operacao='entrega' AND n.situacao='pendente' AND COALESCE(n.telefone,'')<>''
      AND NOT EXISTS (SELECT 1 FROM ag_agendamentos a WHERE a.nota_id=n.id AND a.status='ativo')
      AND NOT EXISTS (SELECT 1 FROM ag_wa_conversas c WHERE n.id=ANY(c.nota_ids) AND c.origem<>'teste' AND (c.estado<>'sem_resposta' OR c.atualizado_em>NOW()-INTERVAL '7 days'))
      AND NOT EXISTS (SELECT 1 FROM ag_reservas r WHERE COALESCE(r.client_id,0)=COALESCE(n.client_id,0) AND r.expira_em>NOW()
        AND r.chave=upper(regexp_replace(trim(COALESCE(n.destinatario,'')),'\\s+',' ','g'))||'|'||upper(regexp_replace(trim(COALESCE(n.cidade,'')),'\\s+',' ','g')))
    ORDER BY n.id LIMIT 2000`, [cli])).rows;
  const grupos = new Map();
  for (const n of rows) {
    if (!ag.ehParceiro(termos, n.remetente, n.pagador)) continue;
    const fone = celular(n.telefone);
    if (!fone) continue;
    const k = chaveFone(fone) + '|' + chaveCidade(n.cidade);
    if (!grupos.has(k)) grupos.set(k, { fone, cidade: n.cidade, uf: n.uf, destinatario: n.destinatario, notas: [] });
    grupos.get(k).notas.push(n);
  }
  return [...grupos.values()];
}

async function abrirConversa(pool, cli, g, origem) {
  return (await pool.query('INSERT INTO ag_wa_conversas(client_id,telefone,chave_fone,nota_ids,destinatario,cidade,uf,origem) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [cli, g.fone, chaveFone(g.fone), g.notas.map(n => n.id), limpo(g.destinatario, 120), limpo(g.cidade, 80), limpo(g.uf, 2).toUpperCase(), origem])).rows[0];
}

async function rodadaOfertas(ctx, cli) {
  const { pool, cfg } = ctx;
  const r = { grupos: 0, enviadas: 0, sem_rota: 0, fora_do_teste: 0, erros: 0 };
  await garantirRotas(pool, cli);
  const agora = ctx.agora ? ctx.agora() : new Date();
  for (const g of await candidatas(pool, cli)) {
    if (r.enviadas >= OFERTAS_POR_VEZ) break;
    r.grupos++;
    if (!liberadoPara(cfg, g.fone)) { r.fora_do_teste++; continue; }
    if (!proximasDatas(await rotaDa(pool, cli, g.cidade, g.uf), { agora }).length) { r.sem_rota++; continue; }
    const conv = await abrirConversa(pool, cli, g, 'auto');
    try { await ofertar(ctx, conv); r.enviadas++; await eventoNotas(pool, cli, conv.nota_ids, 'oferta', 'Datas oferecidas no WhatsApp ' + g.fone); }
    catch (e) { r.erros++; await pool.query("UPDATE ag_wa_conversas SET estado='erro',motivo_sac=$2,atualizado_em=NOW() WHERE id=$1", [conv.id, limpo(e.message, 300)]); }
  }
  // sem resposta em 48 h: volta para o SAC
  const sr = await pool.query(`UPDATE ag_wa_conversas SET estado='sem_resposta',atualizado_em=NOW() WHERE client_id IS NOT DISTINCT FROM $1 AND estado IN ('oferta','escolhendo')
    AND criado_em<NOW()-($2||' hours')::interval AND (respondido_em IS NULL OR respondido_em<NOW()-($2||' hours')::interval) RETURNING client_id,nota_ids`, [cli, String(HORAS_SEM_RESPOSTA)]);
  for (const c of sr.rows) await eventoNotas(pool, c.client_id, c.nota_ids, 'SAC', 'Cliente não respondeu no WhatsApp em ' + HORAS_SEM_RESPOSTA + ' h');
  r.sem_resposta = sr.rowCount;
  return r;
}

// véspera: lembrete com Confirmar / Remarcar (modelo aprovado; a janela de 24 h normalmente já fechou)
async function rodadaLembretes(ctx, cli) {
  const { pool, cfg } = ctx;
  const amanha = isoMais(hojeSp(ctx.agora ? ctx.agora() : new Date()), 1);
  const convs = (await pool.query("SELECT * FROM ag_wa_conversas WHERE client_id IS NOT DISTINCT FROM $1 AND estado='agendado' AND data_escolhida=$2 AND lembrete_em IS NULL", [cli, amanha])).rows;
  let n = 0;
  for (const conv of convs) {
    const notas = (await notasDa(pool, conv)).filter(x => x.ag_id && x.ag_data === amanha);
    if (!notas.length) continue;
    try {
      if (await janelaAberta(pool, conv.telefone)) {
        await enviar(ctx, conv, conv.telefone, { type: 'interactive', interactive: { type: 'button', body: { text: ANA.lembrete(primeiroNome(conv.destinatario), amanha, notas) },
          action: { buttons: [{ type: 'reply', reply: { id: 'confirmar:' + conv.id, title: '✅ Confirmar' } }, { type: 'reply', reply: { id: 'remarcar:' + conv.id, title: '📅 Remarcar' } }] } } }, 'Lembrete ' + amanha);
      } else {
        await enviar(ctx, conv, conv.telefone, { type: 'template', template: { name: cfg.modeloLembrete, language: { code: cfg.idioma }, components: [
          { type: 'body', parameters: [{ type: 'text', text: nfsTexto(notas) }, { type: 'text', text: dataLonga(amanha) }] },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'confirmar:' + conv.id }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'remarcar:' + conv.id }] },
        ] } }, 'Modelo ' + cfg.modeloLembrete + ' ' + amanha);
      }
      await pool.query('UPDATE ag_wa_conversas SET lembrete_em=NOW() WHERE id=$1', [conv.id]);
      n++;
    } catch (e) { console.log('WHATSAPP lembrete ' + conv.id + ': ' + e.message); }
  }
  return n;
}

function iniciar({ pool, clientes, env = process.env, fetchFn }) {
  const cfg = configDoAmbiente(env);
  if (!cfg.auto || !podeEnviar(cfg)) { console.log('WHATSAPP agendamento automático desligado' + (podeEnviar(cfg) ? ' (WHATSAPP_AUTO)' : ' (falta WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)')); return null; }
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    const agora = new Date(), h = horaSp(agora), w = diaSemana(hojeSp(agora));
    if (w === 0 || h < '08:00' || h >= '18:00') return;
    rodando = true;
    try {
      for (const cli of await clientes()) {
        const r = await rodadaOfertas({ pool, cfg, fetchFn }, cli);
        if (r.enviadas || r.erros || r.sem_resposta) console.log('WHATSAPP ofertas: ' + JSON.stringify(r));
        if (h >= '10:00') { const l = await rodadaLembretes({ pool, cfg, fetchFn }, cli); if (l) console.log('WHATSAPP lembretes: ' + l); }
      }
    } catch (e) { console.log('WHATSAPP rodada ERRO: ' + (e.message || e)); } finally { rodando = false; }
  };
  setTimeout(tick, 90 * 1000);
  console.log('WHATSAPP agendamento automático ligado' + (cfg.teste.length ? ' (modo teste: ' + cfg.teste.length + ' número(s))' : ''));
  return setInterval(tick, 15 * 60 * 1000);
}

// ------------------------------------------------------------------ rotas HTTP
function assinaturaOk(cfg, raw, cab) {
  if (!cfg.appSecret) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(raw).digest('hex');
  const a = Buffer.from(String(cab || '')), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function lerCru(req, max = 512 * 1024) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('Aviso grande demais.'), { status: 413 }); partes.push(Buffer.from(c)); }
  return Buffer.concat(partes);
}

// Webhook da Meta: /api/whatsapp/webhook (sem login; GET valida, POST traz mensagens e status)
// Painel (administrador): /api/painel/agendamento-whatsapp/{status,rotas,teste}
// Política de privacidade pública do atendimento pelo WhatsApp (a Meta exige o endereço para publicar o app)
const PRIVACIDADE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade - Agendamento de entregas CONSTRULOG</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:0 auto;padding:28px;color:#1f2937;line-height:1.6;background:#fff}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.6em}.box{background:#f3f4f6;border-radius:8px;padding:14px 16px}</style></head><body>
<h1>Política de Privacidade do agendamento de entregas pelo WhatsApp</h1>
<p>Última atualização: 4 de novembro de 2026.</p>
<p>A CONSTRULOG usa o WhatsApp (API oficial da Meta) para combinar com o destinatário o dia da entrega das mercadorias que transporta. Esta política explica quais dados usamos nesse atendimento e como.</p>
<h2>Dados utilizados</h2>
<ul>
<li><b>Telefone e nome do destinatário</b>, que constam no documento de transporte (CT-e) ou na nota fiscal da mercadoria.</li>
<li><b>Dados da entrega</b>: número da nota fiscal, remetente, cidade e endereço de entrega.</li>
<li><b>Mensagens trocadas neste canal</b>: a data escolhida, pedidos de remarcação e as mensagens enviadas ao atendimento.</li>
</ul>
<h2>Finalidades</h2>
<ul>
<li>Oferecer as datas de entrega disponíveis para a cidade do destinatário e registrar a data escolhida.</li>
<li>Enviar o lembrete na véspera da entrega e permitir confirmar ou remarcar.</li>
<li>Encaminhar ao atendimento (SAC) da CONSTRULOG os casos que precisam de uma pessoa.</li>
</ul>
<p>Os dados não são vendidos, não são usados para publicidade e não são compartilhados com anunciantes. Não enviamos mensagens de propaganda por este canal.</p>
<h2>Compartilhamento</h2>
<p>As mensagens passam pela plataforma WhatsApp Business da Meta, conforme os termos do WhatsApp. Os dados ficam nos servidores do sistema da CONSTRULOG, contratados de provedores de nuvem, e são acessados pela equipe de operação e atendimento. A data agendada pode ser informada ao remetente da mercadoria (cliente da transportadora).</p>
<h2>Retenção</h2>
<p>O histórico do agendamento é mantido enquanto necessário para a operação, a conferência das entregas e as obrigações legais.</p>
<h2 id="exclusao">Seus direitos</h2>
<p>Pela Lei Geral de Proteção de Dados (LGPD), você pode pedir acesso, correção ou exclusão dos seus dados e pedir para não receber mais mensagens deste canal. Basta responder "atendente" no WhatsApp ou escrever para o contato abaixo.</p>
<h2>Contato</h2>
<div class="box">CONSTRULOG • Central de operação<br>E-mail: <a href="mailto:junior.controle68@gmail.com">junior.controle68@gmail.com</a></div>
</body></html>`;

async function handle(req, res, u, { pool, sendJson, readJsonBodyLimited, dashboardSession, clientes, env = process.env, fetchFn, desligado = false, testMode = false }) {
  if (req.method === 'GET' && (u.pathname === '/whatsapp/privacidade' || u.pathname === '/whatsapp/privacidade/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(PRIVACIDADE);
    return true;
  }
  const web = u.pathname === '/api/whatsapp/webhook', painel = u.pathname.startsWith('/api/painel/agendamento-whatsapp/');
  if (!web && !painel) return false;
  if (desligado) { sendJson(res, 404, { ok: false, error: 'Não disponível.' }); return true; }
  const cfg = configDoAmbiente(env);
  const ctx = { pool, cfg, fetchFn };
  if (web && req.method === 'GET') {
    const ok = cfg.verify && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === cfg.verify;
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? String(u.searchParams.get('hub.challenge') || '') : 'forbidden');
    return true;
  }
  if (web && req.method === 'POST') {
    try {
      const raw = await lerCru(req);
      if (!assinaturaOk(cfg, raw, req.headers['x-hub-signature-256']) && !(testMode && !cfg.appSecret)) {
        console.log('WHATSAPP webhook recusado: ' + (cfg.appSecret ? 'assinatura inválida' : 'falta WHATSAPP_APP_SECRET'));
        sendJson(res, cfg.appSecret ? 401 : 503, { ok: false }); return true;
      }
      const j = JSON.parse(raw.toString('utf8') || '{}');
      sendJson(res, 200, { ok: true });   // responde logo: a Meta reenvia se demorar
      for (const e of j.entry || []) for (const ch of e.changes || []) {
        const v = ch.value || {};
        if (cfg.phoneId && v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== cfg.phoneId) continue;
        for (const s of v.statuses || []) await statusEnvio(ctx, s).catch(x => console.log('WHATSAPP status: ' + x.message));
        for (const m of v.messages || []) await receber(ctx, m).catch(x => console.log('WHATSAPP mensagem ' + (m.id || '') + ' ERRO: ' + x.message));
      }
    } catch (e) { console.log('WHATSAPP webhook ERRO: ' + e.message); if (!res.headersSent) sendJson(res, e.status || 400, { ok: false }); }
    return true;
  }
  try {
    const user = await dashboardSession(req, false);
    if (!user.is_admin) return sendJson(res, 403, { ok: false, error: 'Só o administrador configura o WhatsApp.' }), true;
    const cli = user.client_id ? String(user.client_id) : ((await clientes())[0] ?? null);
    const p = u.pathname.slice('/api/painel/agendamento-whatsapp'.length);
    if (p === '/status' && req.method === 'GET') {
      await garantirRotas(pool, cli);
      const est = (await pool.query('SELECT estado,COUNT(*)::int n FROM ag_wa_conversas WHERE client_id IS NOT DISTINCT FROM $1 GROUP BY 1', [cli])).rows;
      const sac = (await pool.query("SELECT id::text,telefone,destinatario,cidade,motivo_sac,atualizado_em FROM ag_wa_conversas WHERE client_id IS NOT DISTINCT FROM $1 AND estado IN ('sac','sem_resposta','erro') ORDER BY atualizado_em DESC LIMIT 100", [cli])).rows;
      const msgs = (await pool.query('SELECT telefone,direcao,tipo,texto,status,erro,criado_em FROM ag_wa_mensagens WHERE client_id IS NOT DISTINCT FROM $1 OR client_id IS NULL ORDER BY id DESC LIMIT 50', [cli])).rows;
      const rotas = (await pool.query('SELECT COUNT(*)::int n FROM ag_rotas WHERE client_id IS NOT DISTINCT FROM $1', [cli])).rows[0].n;
      return sendJson(res, 200, { ok: true, configurado: podeEnviar(cfg), webhook_assinado: !!cfg.appSecret, verify_token: !!cfg.verify, automatico: cfg.auto, modo_teste: cfg.teste.length, rotas, conversas: est, para_o_sac: sac, mensagens: msgs }), true;
    }
    if (p === '/rotas' && req.method === 'GET') {
      await garantirRotas(pool, cli);
      const rows = (await pool.query('SELECT uf,cidade,praca,dias,prazo,entrega,restrito,origem,atualizado_em FROM ag_rotas WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY cidade', [cli])).rows;
      return sendJson(res, 200, { ok: true, rows: rows.map(r => ({ ...r, proximas: proximasDatas(r, { n: 3 }) })) }), true;
    }
    // envia a oferta de uma nota para um número escolhido (teste com o número de teste da Meta)
    if (p === '/teste' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 64 * 1024);
      const fone = celular(b.telefone);
      if (!fone) return sendJson(res, 400, { ok: false, error: 'Informe um celular com DDD.' }), true;
      await garantirRotas(pool, cli);
      const n = (await pool.query('SELECT id::text,nf,remetente,destinatario,cidade,uf FROM ag_notas WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2', [String(b.nota_id || ''), cli])).rows[0];
      if (!n) return sendJson(res, 404, { ok: false, error: 'Nota não encontrada.' }), true;
      const conv = await abrirConversa(pool, cli, { fone, cidade: n.cidade, uf: n.uf, destinatario: n.destinatario, notas: [n] }, 'teste');
      try { await ofertar({ ...ctx, cli }, conv); }
      catch (e) { await pool.query("UPDATE ag_wa_conversas SET estado='erro',motivo_sac=$2 WHERE id=$1", [conv.id, limpo(e.message, 300)]); throw e; }
      return sendJson(res, 200, { ok: true, conversa_id: conv.id }), true;
    }
    return sendJson(res, 404, { ok: false, error: 'Rota não encontrada.' }), true;
  } catch (e) { return sendJson(res, e.status || 500, { ok: false, error: e.message || 'Erro.' }), true; }
}

module.exports = { datasDisponiveis, chaveCliente, ANA, nomeLoja, primeiroNome, cidadeUf, remetentes, nfsTexto, NAO_COBRAMOS, proximasDatas, feriados, pascoa, celular, chaveFone, chaveCidade, configDoAmbiente, ensureSchema, garantirRotas, gravarRotas, rotaDa,
  candidatas, rodadaOfertas, rodadaLembretes, receber, ofertar, escolherData, assinaturaOk, iniciar, handle, GRADE };
