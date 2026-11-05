// Agendamento pelo WhatsApp (agendamento-whatsapp.js): datas da rota, oferta, escolha, remarcação, SAC e lembrete.
// Roda direto contra o banco de teste, sem servidor e sem rede: a API da Meta é simulada aqui.
const { Pool } = require('pg');
const crypto = require('crypto');
const ag = require('../agendamento.js');
const wa = require('../agendamento-whatsapp.js');
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  OK   ', name); } else { fail++; console.log('  FALHA', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); if (process.env.GITHUB_ACTIONS) console.log('::error title=Agendamento WhatsApp::' + name); } }

const hojeSp = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const mais = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
const em = (iso, hora) => new Date(iso + 'T' + hora + ':00-03:00');
// próxima segunda-feira útil a partir de amanhã (as datas do teste ficam sempre no futuro)
let SEG = mais(hojeSp(), 1);
while (dow(SEG) !== 1 || wa.feriados(Number(SEG.slice(0, 4))).has(SEG) || [1, 2, 3, 4, 5].some(i => wa.feriados(Number(SEG.slice(0, 4))).has(mais(SEG, i)))) SEG = mais(SEG, 1);

(async () => {
  console.log('Funções puras');
  const todo = { dias: 'STQQS.', prazo: 1, entrega: true }, quaSex = { dias: '..Q.S.', prazo: 1, entrega: true };
  check('seg a sex, segunda 11h: começa na terça', wa.proximasDatas(todo, { agora: em(SEG, '11:00'), n: 3 }).join() === [mais(SEG, 1), mais(SEG, 2), mais(SEG, 3)].join(), wa.proximasDatas(todo, { agora: em(SEG, '11:00'), n: 3 }));
  check('até 17:59 ainda dá para o dia seguinte', wa.proximasDatas(todo, { agora: em(SEG, '17:59'), n: 1 })[0] === mais(SEG, 1));
  check('a partir das 18h a primeira data anda um dia', wa.proximasDatas(todo, { agora: em(SEG, '18:00'), n: 1 })[0] === mais(SEG, 2));
  check('qua e sex: só quartas e sextas', wa.proximasDatas(quaSex, { agora: em(SEG, '11:00'), n: 4 }).every(d => [3, 5].includes(dow(d))));
  check('prazo 2 dias (Vale do Paraíba): segunda -> quarta', wa.proximasDatas({ dias: 'STQQS.', prazo: 2, entrega: true }, { agora: em(SEG, '09:00'), n: 1 })[0] === mais(SEG, 2));
  check('nunca domingo, mesmo com sábado na rota', wa.proximasDatas({ dias: 'STQQSS', prazo: 1, entrega: true }, { agora: em(SEG, '09:00'), n: 12 }).every(d => dow(d) !== 0));
  check('feriado fica de fora (Consciência Negra 20/11/2026)', !wa.proximasDatas(todo, { agora: em('2026-11-18', '09:00'), n: 3 }).includes('2026-11-20'));
  check('Páscoa e feriados móveis (2027: Sexta Santa 26/03, Corpus Christi 27/05)', wa.pascoa(2027) === '2027-03-28' && wa.feriados(2027).has('2027-03-26') && wa.feriados(2027).has('2027-05-27'));
  check('cidade sem entrega (Osasco) não tem data', wa.proximasDatas({ dias: 'STQQS.', prazo: 1, entrega: false }).length === 0);
  check('nome da loja limpo: razão social cortada vira a marca', wa.nomeLoja('QUADRI COMERCIO ELETRONIC ..') === 'Quadri' && wa.nomeLoja('CASA DO CONSTRUTOR LTDA') === 'Casa do Construtor' && wa.nomeLoja('TELHA NORTE S/A') === 'Telha Norte' && wa.nomeLoja('FCB') === 'FCB', [wa.nomeLoja('QUADRI COMERCIO ELETRONIC ..'), wa.nomeLoja('CASA DO CONSTRUTOR LTDA')]);
  check('primeiro nome do cliente sem o número do pedido; empresa fica sem nome', wa.primeiroNome('MADA CABRAL 1330321') === 'Mada' && wa.primeiroNome('LOJA DO ZE') === '' && wa.primeiroNome('OSASCO LTDA') === '' && wa.cidadeUf('CAMPINAS', 'sp') === 'Campinas/SP');
  check('celular do texto da nota (pula o fixo)', wa.celular('(19) 3333-4444 / (19) 99888-7766') === '5519998887766' && wa.celular('19 3333-4444') === '' && wa.celular('+55 (11) 98765-4321') === '5511987654321');
  check('celular antigo sem o 9 ganha o 9', wa.celular('(19) 9888-7766') === '5519998887766');
  check('número da Meta sem o 9 casa com o com 9', wa.chaveFone('5519998887766') === wa.chaveFone('551998887766'));
  check('cidade com apóstrofo e acento casa com a grade', wa.chaveCidade("Santa Bárbara d'Oeste") === 'SANTA BARBARA D OESTE');
  check('grade da opção 107 com as 151 cidades', wa.GRADE.cidades.length === 151 && wa.GRADE.cidades.find(c => c.cidade === 'SAO PAULO').dias === 'ST.Q..');
  const cfgSeg = wa.configDoAmbiente({ WHATSAPP_APP_SECRET: 'segredo' }), corpo = Buffer.from('{"a":1}');
  check('assinatura da Meta confere', wa.assinaturaOk(cfgSeg, corpo, 'sha256=' + crypto.createHmac('sha256', 'segredo').update(corpo).digest('hex')));
  check('assinatura errada ou sem segredo é recusada', !wa.assinaturaOk(cfgSeg, corpo, 'sha256=00') && !wa.assinaturaOk(wa.configDoAmbiente({}), corpo, 'x'));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://teste:teste@127.0.0.1:5432/construlog_teste', ssl: false });
  await ag.ensureSchema(pool);
  await wa.ensureSchema(pool);
  await pool.query('DELETE FROM ag_wa_mensagens;DELETE FROM ag_wa_conversas;DELETE FROM ag_rotas;DELETE FROM ag_reservas;DELETE FROM ag_locais;DELETE FROM ag_eventos;DELETE FROM ag_agendamentos;DELETE FROM ag_notas;DELETE FROM ag_config');
  const cli = null;
  await ag.gravarConfig(pool, cli, { parceiros: '' }, 'teste');

  console.log('Rotas');
  check('grade carregada na primeira vez', await wa.garantirRotas(pool, cli) === 151 && await wa.garantirRotas(pool, cli) === 0);
  const r = await wa.rotaDa(pool, cli, "Santa Bárbara d'Oeste", 'SP');
  check('rota encontrada pelo nome da nota', r && r.dias === 'STQQS.' && r.prazo === 1, r);

  console.log('Oferta');
  await ag.aplicarSnapshot(pool, cli, { pendentes: [
    { nf: '5001', ctrc: 'AMR005001-1', remetente: 'FCB', destinatario: 'LOJA DO ZE', cidade: 'CAMPINAS', uf: 'SP', peso: 10, volumes: 1 },
    { nf: '5002', ctrc: 'AMR005002-2', remetente: 'FCB', destinatario: 'LOJA DO ZE', cidade: 'CAMPINAS', uf: 'SP', peso: 20, volumes: 2 },
    { nf: '5003', ctrc: 'AMR005003-3', remetente: 'FCB', destinatario: 'DEPOSITO OSASCO', cidade: 'OSASCO', uf: 'SP', peso: 5, volumes: 1 },
    { nf: '5004', ctrc: 'AMR005004-4', remetente: 'FCB', destinatario: 'SO FIXO', cidade: 'CAMPINAS', uf: 'SP', peso: 5, volumes: 1 },
    { nf: '5005', ctrc: 'AMR005005-5', remetente: 'FCB', destinatario: 'FORA DO TESTE', cidade: 'JUNDIAI', uf: 'SP', peso: 5, volumes: 1 },
    { nf: '5006', ctrc: 'AMR005006-6', remetente: 'FCB', destinatario: 'RESERVADO', cidade: 'AMERICANA', uf: 'SP', peso: 5, volumes: 1 },
  ], verificados: {} }, null);
  const fones = { '5001': '(19) 99888-7766', '5002': '19998887766', '5003': '(11) 97777-6666', '5004': '(19) 3333-4444', '5005': '(11) 95555-4444', '5006': '(19) 96666-5555' };
  for (const [nf, f] of Object.entries(fones)) await pool.query('UPDATE ag_notas SET telefone=$2 WHERE nf=$1', [nf, f]);
  const idDe = async nf => (await pool.query('SELECT id::text FROM ag_notas WHERE nf=$1', [nf])).rows[0].id;
  await pool.query("INSERT INTO ag_reservas(client_id,chave,usuario,expira_em) VALUES(NULL,'RESERVADO|AMERICANA','maria',NOW()+INTERVAL '2 hours')");

  const enviados = [];
  const fetchFn = async (url, o) => { const b = JSON.parse(o.body); enviados.push({ url, b }); return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OUT' + enviados.length }] }) }; };
  let agora = em(SEG, '11:00');
  const ctx = { pool, fetchFn, agora: () => agora, cfg: wa.configDoAmbiente({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123', WHATSAPP_AUTO: '1', WHATSAPP_TESTE_FONES: '19998887766, 11977776666, 19966665555' }) };
  const g = await wa.candidatas(pool, cli);
  check('candidatas: as duas notas do mesmo celular e cidade vão juntas; fixo e reservado pelo SAC ficam de fora',
    g.length === 3 && g.find(x => x.fone === '5519998887766').notas.length === 2 && !g.some(x => x.destinatario === 'RESERVADO') && !g.some(x => x.destinatario === 'SO FIXO'), g);
  let rod = await wa.rodadaOfertas(ctx, cli);
  check('rodada: 1 oferta enviada, Osasco sem rota, Jundiaí fora do modo teste', rod.enviadas === 1 && rod.sem_rota === 1 && rod.fora_do_teste === 1, rod);
  check('fora da janela de 24 h vai o modelo aprovado, com o botão apontando para a conversa', enviados.length === 1 && enviados[0].b.type === 'template' && enviados[0].b.template.name === 'agendamento_entrega'
    && enviados[0].b.template.components[0].parameters[1].text === 'NFs 5001, 5002' && /^ofertar:\d+$/.test(enviados[0].b.template.components[1].parameters[0].payload), enviados[0]);
  rod = await wa.rodadaOfertas(ctx, cli);
  check('a segunda rodada não manda de novo', rod.enviadas === 0, rod);
  const conv = (await pool.query('SELECT * FROM ag_wa_conversas')).rows[0];

  console.log('Escolha da data');
  const msg = (id, extra) => ({ from: '551998887766', id, timestamp: '1', ...extra });   // a Meta manda sem o 9
  await wa.receber(ctx, msg('wamid.IN1', { type: 'button', button: { text: 'Escolher data', payload: 'ofertar:' + conv.id } }));
  const lista = enviados[enviados.length - 1].b;
  const rows = lista.interactive && lista.interactive.action.sections[0].rows || [];
  check('clicou "Escolher data": lista com 6 datas de seg a sex a partir de terça + "Nenhuma data serve"', lista.type === 'interactive' && rows.length === 7 && rows[0].id === 'd:' + conv.id + ':' + mais(SEG, 1) && rows[6].id === 'sac:' + conv.id, rows);
  check('responde para o número no formato da Meta', lista.to === '551998887766');
  check('a mesma mensagem reenviada pela Meta é ignorada', await wa.receber(ctx, msg('wamid.IN1', { type: 'button', button: { text: 'Escolher data', payload: 'ofertar:' + conv.id } })) === 'repetida');
  const qua = mais(SEG, 2);
  await wa.receber(ctx, msg('wamid.IN2', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'd:' + conv.id + ':' + qua, title: 'Qua' } } }));
  let ags = (await pool.query("SELECT n.nf,to_char(a.data_agendada,'YYYY-MM-DD') d,a.criado_por_nome FROM ag_agendamentos a JOIN ag_notas n ON n.id=a.nota_id WHERE a.status='ativo' ORDER BY n.nf")).rows;
  check('escolheu quarta: as duas notas agendadas pelo usuário WhatsApp', ags.length === 2 && ags.every(a => a.d === qua && a.criado_por_nome === 'WhatsApp'), ags);
  const conf = enviados[enviados.length - 2].b.text.body, pede = enviados[enviados.length - 1].b.text.body;
  check('confirmação da Ana com a data, o aviso dos 15 dias e o REMARCAR', /Prontinho/.test(conf) && /agendada para \*quarta-feira/.test(conf) && /até \*15 dias\*/.test(conf) && /REMARCAR/.test(conf), conf);
  check('em seguida pede a localização', /localização/.test(pede) && /📍/.test(pede), pede);
  const lista0 = enviados.find(e => e.b.type === 'interactive' && e.b.interactive.type === 'list').b.interactive;
  check('a lista diz a loja, as NFs e que não se pede pagamento (sem personagem)', !/Ana/.test(lista0.body.text) && lista0.action.button === 'Ver datas' && /📦 Nota fiscal: 5001, 5002/.test(lista0.body.text)
    && /transportadora responsável pela entrega da sua compra na \*FCB\*/.test(lista0.body.text) && /não pedimos pagamento/.test(lista0.body.text) && /FCB/.test(lista0.header.text), lista0);
  const linhas = lista0.action.sections[0].rows;
  check('a lista tem a saída "Não reconheço a compra" (até 24 letras)', linhas.some(r => r.id === 'nr:' + conv.id && r.title.length <= 24) && linhas.length <= 10, linhas);
  check('histórico da nota mostra o agendamento', (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='agendado' AND usuario='WhatsApp'")).rows[0].n === 2);

  console.log('Remarcação');
  await wa.receber(ctx, msg('wamid.IN3', { type: 'text', text: { body: 'Preciso remarcar, quarta não dá' } }));
  check('"remarcar" manda a lista de novo', enviados[enviados.length - 1].b.type === 'interactive');
  const n0 = enviados.length;
  await wa.receber(ctx, msg('wamid.IN4', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'd:' + conv.id + ':' + mais(SEG, 40), title: 'x' } } }));
  check('data que não foi oferecida: não grava e manda a lista de novo', enviados.length === n0 + 1 && enviados[n0].b.type === 'interactive' && (await pool.query("SELECT COUNT(*)::int n FROM ag_agendamentos WHERE status='ativo' AND data_agendada=$1", [qua])).rows[0].n === 2);
  const sex = mais(SEG, 4);
  await wa.receber(ctx, msg('wamid.IN5', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'd:' + conv.id + ':' + sex, title: 'Sex' } } }));
  ags = (await pool.query("SELECT to_char(data_agendada,'YYYY-MM-DD') d,reagendamentos FROM ag_agendamentos WHERE status='ativo'")).rows;
  check('remarcou para sexta (reagendamento, não agendamento novo)', ags.length === 2 && ags.every(a => a.d === sex && a.reagendamentos === 1), ags);

  console.log('Localização');
  await wa.receber(ctx, msg('wamid.L1', { type: 'location', location: { latitude: -22.9056, longitude: -47.0608, name: 'Loja do Zé' } }));
  let loc = (await pool.query("SELECT link,lat,lon,atualizado_por FROM ag_locais WHERE chave='LOJA DO ZE|CAMPINAS'")).rows[0];
  check('pino do WhatsApp vai para o campo Localização do agendamento', loc && Math.abs(loc.lat + 22.9056) < 1e-6 && /google\.com\/maps/.test(loc.link) && loc.atualizado_por === 'WhatsApp', loc);
  check('agradece a localização', /Localização recebida/.test(enviados[enviados.length - 1].b.text.body));
  check('histórico das duas notas mostra a localização', (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='localizacao' AND usuario='WhatsApp'")).rows[0].n === 2);
  await wa.receber(ctx, msg('wamid.L2', { type: 'text', text: { body: 'é aqui: https://www.google.com/maps/@-22.9100,-47.0700,17z' } }));
  loc = (await pool.query("SELECT lat FROM ag_locais WHERE chave='LOJA DO ZE|CAMPINAS'")).rows[0];
  check('link do Google Maps no texto também troca a localização', loc && Math.abs(loc.lat + 22.91) < 1e-6, loc);
  const nLoc = enviados.length;
  await wa.receber(ctx, msg('wamid.L3', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'd:' + conv.id + ':' + mais(SEG, 3), title: 'Qui' } } }));
  check('com a localização já guardada, remarcar não pede de novo', enviados.length === nLoc + 1 && /Prontinho/.test(enviados[nLoc].b.text.body), enviados.slice(nLoc).map(e => e.b.text && e.b.text.body));
  await wa.receber(ctx, msg('wamid.L4', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'd:' + conv.id + ':' + sex, title: 'Sex' } } }));

  console.log('Lembrete da véspera');
  agora = em(mais(sex, -1), '10:30');
  let l = await wa.rodadaLembretes(ctx, cli);
  const lem = enviados[enviados.length - 1].b;
  check('véspera: lembrete com Confirmar / Remarcar', l === 1 && lem.type === 'interactive' && lem.interactive.type === 'button' && lem.interactive.action.buttons.length === 2, lem);
  check('não manda o lembrete duas vezes', await wa.rodadaLembretes(ctx, cli) === 0);
  await wa.receber(ctx, msg('wamid.IN6', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'confirmar:' + conv.id, title: 'Confirmar' } } }));
  check('lembrete da Construlog, com o aviso do recebedor', /Aqui é da \*Construlog\*/.test(lem.interactive.body.text) && !/Ana/.test(lem.interactive.body.text) && /alguém no local/.test(lem.interactive.body.text) && lem.interactive.action.buttons[0].reply.title === '✅ Confirmar', lem.interactive.body.text);
  check('confirmou: agradece e registra no histórico', /confirmada/.test(enviados[enviados.length - 1].b.text.body) && (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='whatsapp' AND para='confirmado'")).rows[0].n === 2);
  await pool.query("DELETE FROM ag_wa_mensagens WHERE direcao='in'");   // janela de 24 h fechada
  await pool.query('UPDATE ag_wa_conversas SET lembrete_em=NULL');
  await wa.rodadaLembretes(ctx, cli);
  check('janela fechada: lembrete pelo modelo aprovado', enviados[enviados.length - 1].b.type === 'template' && enviados[enviados.length - 1].b.template.name === 'lembrete_entrega');

  console.log('Não reconhece a compra');
  const cNr = conv, estadoAntes = (await pool.query('SELECT estado FROM ag_wa_conversas WHERE id=$1', [conv.id])).rows[0].estado;
  {
    const antesNr = enviados.length;
    await wa.receber(ctx, msg('wamid.INNR', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'nr:' + cNr.id, title: 'Não reconheço a compra' } } }));
    const eNr = (await pool.query('SELECT estado,motivo_sac FROM ag_wa_conversas WHERE id=$1', [cNr.id])).rows[0];
    check('"Não reconheço a compra": vai para o SAC e avisa o cliente', eNr.estado === 'sac' && /não reconhece/.test(eNr.motivo_sac) && enviados.length === antesNr + 1 && /Não vamos agendar/.test(enviados[antesNr].b.text.body), eNr);
    await pool.query('UPDATE ag_wa_conversas SET estado=$2,motivo_sac=NULL WHERE id=$1', [cNr.id, estadoAntes]);
  }

  console.log('SAC');
  agora = em(SEG, '11:00');
  await pool.query("UPDATE ag_notas SET telefone='(11) 97777-6666', cidade='JUNDIAI', destinatario='OUTRO' WHERE nf='5003'");
  await wa.rodadaOfertas(ctx, cli);
  const c2 = (await pool.query("SELECT * FROM ag_wa_conversas WHERE destinatario='OUTRO'")).rows[0];
  await wa.receber(ctx, { from: '5511977776666', id: 'wamid.IN7', type: 'text', text: { body: 'quero falar com um atendente' } });
  const c2b = (await pool.query('SELECT estado,motivo_sac FROM ag_wa_conversas WHERE id=$1', [c2.id])).rows[0];
  check('pediu atendente: conversa vai para o SAC, com evento na nota', c2b.estado === 'sac' && /atendente/.test(c2b.motivo_sac) && (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos e JOIN ag_notas n ON n.id=e.nota_id WHERE n.nf='5003' AND e.tipo='whatsapp' AND e.para='SAC'")).rows[0].n === 1, c2b);
  await wa.receber(ctx, { from: '5511977776666', id: 'wamid.IN8', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'd:' + conv.id + ':' + mais(SEG, 1), title: 'x' } } });
  check('não consegue mexer na conversa de outro número', (await pool.query("SELECT COUNT(*)::int n FROM ag_agendamentos WHERE status='ativo' AND data_agendada=$1", [mais(SEG, 1)])).rows[0].n === 0);
  const n1 = enviados.length;
  check('modo teste: número fora da lista não recebe nada', await wa.receber(ctx, { from: '5521911112222', id: 'wamid.IN9', type: 'text', text: { body: 'oi' } }) === 'sem_conversa' && enviados.length === n1);
  const ctxLivre = { ...ctx, cfg: wa.configDoAmbiente({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123' }) };
  check('número desconhecido recebe a apresentação e nada é criado', await wa.receber(ctxLivre, { from: '5521911112222', id: 'wamid.IN10', type: 'text', text: { body: 'oi' } }) === 'sem_conversa' && enviados.length === n1 + 1 && /Aqui é a \*Construlog\*/.test(enviados[n1].b.text.body) && /Não pedimos pagamento/.test(enviados[n1].b.text.body)
    && (await pool.query("SELECT COUNT(*)::int n FROM ag_wa_conversas WHERE chave_fone LIKE '5521%'")).rows[0].n === 0);
  await pool.query("UPDATE ag_wa_conversas SET estado='oferta',criado_em=NOW()-INTERVAL '49 hours',respondido_em=NULL WHERE id=$1", [c2.id]);
  rod = await wa.rodadaOfertas(ctx, cli);
  check('sem resposta em 48 h: volta para o SAC', rod.sem_resposta === 1 && (await pool.query('SELECT estado FROM ag_wa_conversas WHERE id=$1', [c2.id])).rows[0].estado === 'sem_resposta');

  console.log('Erro da Meta');
  await pool.query("UPDATE ag_notas SET destinatario='ERRO',cidade='CAMPINAS',telefone='(19) 96666-5555' WHERE nf='5006'");
  await pool.query('DELETE FROM ag_reservas');
  const ctxErro = { ...ctx, fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Template name does not exist in the translation' } }) }) };
  rod = await wa.rodadaOfertas(ctxErro, cli);
  const ce = (await pool.query("SELECT estado,motivo_sac FROM ag_wa_conversas WHERE destinatario='ERRO'")).rows[0];
  check('Meta recusou o envio: conversa marcada com o erro (aparece no painel)', rod.erros === 1 && ce.estado === 'erro' && /Template name/.test(ce.motivo_sac), ce);
  check('a mensagem recusada fica no registro com o motivo', (await pool.query("SELECT COUNT(*)::int n FROM ag_wa_mensagens WHERE status='erro' AND erro LIKE 'Template%'")).rows[0].n === 1);

  await pool.end();
  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
