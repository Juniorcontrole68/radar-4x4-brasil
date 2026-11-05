// Link de agendamento (agendamento-link.js): o SAC manda pelo WhatsApp, o cliente escolhe a data na página.
// Roda direto contra o banco de teste, sem servidor e sem rede.
const { Pool } = require('pg');
const ag = require('../agendamento.js');
const wa = require('../agendamento-whatsapp.js');
const lk = require('../agendamento-link.js');
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  OK   ', name); } else { fail++; console.log('  FALHA', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); if (process.env.GITHUB_ACTIONS) console.log('::error title=Link de agendamento::' + name); } }

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://teste:teste@127.0.0.1:5432/construlog_teste', ssl: false });
  await ag.ensureSchema(pool); await wa.ensureSchema(pool); await lk.ensureSchema(pool);
  await pool.query('DELETE FROM ag_link_envios;DELETE FROM ag_links;DELETE FROM ag_wa_mensagens;DELETE FROM ag_wa_conversas;DELETE FROM ag_rotas;DELETE FROM ag_reservas;DELETE FROM ag_locais;DELETE FROM ag_eventos;DELETE FROM ag_agendamentos;DELETE FROM ag_notas;DELETE FROM ag_config');
  const cli = null;
  await ag.gravarConfig(pool, cli, { parceiros: '' }, 'teste');
  await ag.aplicarSnapshot(pool, cli, { pendentes: [
    { nf: '7001', ctrc: 'AMR007001-1', remetente: 'QUADRI COMERCIO ..', destinatario: 'MADA CABRAL 1330321', cidade: 'CAMPINAS', uf: 'SP' },
    { nf: '7002', ctrc: 'AMR007002-2', remetente: 'QUADRI COMERCIO ..', destinatario: 'MADA CABRAL 1330321', cidade: 'CAMPINAS', uf: 'SP' },
    { nf: '7003', ctrc: 'AMR007003-3', remetente: 'FCB', destinatario: 'OSASCO LTDA', cidade: 'OSASCO', uf: 'SP' },
  ], verificados: {} }, null);
  await pool.query("UPDATE ag_notas SET telefone='(19) 99158-7277'");
  const id = async nf => (await pool.query('SELECT id::text FROM ag_notas WHERE nf=$1', [nf])).rows[0].id;
  const sac = { id: null, username: 'maria', is_admin: false };
  await pool.query("INSERT INTO ag_reservas(client_id,chave,usuario,expira_em) VALUES(NULL,'MADA CABRAL 1330321|CAMPINAS','maria',NOW()+INTERVAL '2 hours')");

  console.log('Link do SAC');
  const l = await lk.criarLink(pool, cli, sac, await id('7001'), 'https://exemplo.test');
  check('link com as duas notas do cliente e o WhatsApp do celular da nota', l.notas.join() === '7001,7002' && l.telefone === '5519991587277' && l.whatsapp.startsWith('https://wa.me/5519991587277?text=') && l.url === 'https://exemplo.test/agendar/' + l.token, l);
  check('mensagem com primeiro nome, loja, NFs, cidade, link, sem cobrança e aviso dos 15 dias', /Olá, Mada!/.test(l.texto) && !/Ana/.test(l.texto) && /sua compra na \*Quadri\*/.test(l.texto) && /Nota fiscal: 7001, 7002/.test(l.texto)
    && /Campinas\/SP/.test(l.texto) && l.texto.includes(l.url) && /não pedimos pagamento/.test(l.texto) && /15 dias/.test(l.texto) && /Não reconhece esta compra/.test(l.texto), l.texto);
  let e2 = null; try { await lk.criarLink(pool, cli, sac, await id('7002'), 'https://exemplo.test'); } catch (e) { e2 = e; }
  check('mesmo cliente no mesmo dia: travado até amanhã', e2 && e2.status === 409 && /já foi enviado hoje às \d\d:\d\d por maria/.test(e2.message), e2 && e2.message);
  const lista = await ag.listar(pool, cli, 'sem', {});
  check('lista do SAC mostra o envio de hoje nas duas notas do cliente', ['7001', '7002'].every(nf => { const r = lista.rows.find(x => x.nf === nf); return r && r.link && r.link.hoje === true && r.link.por === 'maria'; }), lista.rows.map(r => [r.nf, r.link]));
  await pool.query("UPDATE ag_links SET enviado_em=NOW()-INTERVAL '1 day'");
  const l2 = await lk.criarLink(pool, cli, sac, await id('7002'), 'https://exemplo.test');
  check('no dia seguinte libera e reaproveita o mesmo link', l2.token === l.token && (await ag.listar(pool, cli, 'sem', {})).rows.find(x => x.nf === '7002').link.hoje === true);
  let erro = null; try { await lk.criarLink(pool, cli, sac, await id('7003'), 'x'); } catch (e) { erro = e; }
  check('cidade sem entrega (Osasco) não gera link', erro && erro.status === 422, erro && erro.message);

  let sr = await ag.listar(pool, cli, 'sem', { link: 'sem_resposta' });
  check('filtro "Enviado, sem resposta": as duas notas do cliente', sr.rows.map(r => r.nf).sort().join() === '7001,7002', sr.rows.map(r => r.nf));
  check('filtro "ligar" (2+ dias): ainda nenhuma', (await ag.listar(pool, cli, 'sem', { link: 'ligar' })).rows.length === 0);
  await pool.query("UPDATE ag_links SET enviado_em=NOW()-INTERVAL '3 days'");
  sr = await ag.listar(pool, cli, 'sem', { link: 'ligar' });
  check('3 dias sem resposta: aparece no filtro "ligar" com os dias', sr.rows.length === 2 && sr.rows[0].link.dias === 3, sr.rows.map(r => r.link));
  await pool.query("UPDATE ag_links SET enviado_em=NOW()");
  console.log('Página do cliente');
  let d = await lk.dadosLink(pool, l.token);
  check('dados: nome, entrega, datas da rota e sem agendamento', d.nome === 'Mada' && d.loja === 'Quadri' && /NFs 7001, 7002/.test(d.entrega) && d.datas.length === 8 && !d.agendada && !d.tem_local, d);
  erro = null; try { await lk.escolher(pool, l.token, { data: '2099-01-01' }); } catch (e) { erro = e; }
  check('data fora da rota é recusada', erro && erro.status === 422);
  const dt = d.datas[1].data;
  let r = await lk.escolher(pool, l.token, { data: dt, local: '-22.905600,-47.060800' });
  const ags = (await pool.query("SELECT to_char(data_agendada,'YYYY-MM-DD') d,criado_por_nome FROM ag_agendamentos WHERE status='ativo'")).rows;
  check('escolheu: as duas notas agendadas, mesmo com o cliente reservado pelo SAC', r.notas === 2 && ags.length === 2 && ags.every(a => a.d === dt && a.criado_por_nome === 'Cliente (link)'), ags);
  const loc = (await pool.query("SELECT lat FROM ag_locais WHERE chave='MADA CABRAL 1330321|CAMPINAS'")).rows[0];
  check('localização do celular vai para o campo Localização', r.localizacao && loc && Math.abs(loc.lat + 22.9056) < 1e-6, loc);
  check('escolheu: sai do filtro "sem resposta"', (await ag.listar(pool, cli, 'sem', { link: 'sem_resposta' })).rows.length === 0);
  d = await lk.dadosLink(pool, l.token);
  check('abrindo de novo: mostra a data agendada e a localização recebida', d.agendada === dt && d.tem_local);
  const dt2 = d.datas[3].data;
  await lk.escolher(pool, l.token, { data: dt2 });
  const re = (await pool.query("SELECT to_char(data_agendada,'YYYY-MM-DD') d,reagendamentos FROM ag_agendamentos WHERE status='ativo'")).rows;
  check('mudar a data pelo link é reagendamento', re.length === 2 && re.every(a => a.d === dt2 && a.reagendamentos === 1), re);
  check('histórico: link enviado pelo SAC e agendado pelo cliente', (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='whatsapp' AND para='link' AND usuario='maria'")).rows[0].n >= 2
    && (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='agendado' AND usuario='Cliente (link)'")).rows[0].n === 2);

  console.log('Relatório');
  const rel = await lk.relatorio(pool, cli, {});
  check('relatório: 2 envios da maria, 1 abriu e escolheu a data (100% no último)', rel.total.enviados === 2 && rel.por_usuario[0].usuario === 'maria' && rel.por_usuario[0].enviados === 2 && rel.rows[0].abriu && rel.rows[0].respondeu && rel.rows[0].nfs === '7001, 7002', rel);
  check('relatório: filtro por atendente e por data', (await lk.relatorio(pool, cli, { usuario: 'joao' })).rows.length === 0 && (await lk.relatorio(pool, cli, { de: '2001-01-01', ate: '2001-01-02' })).rows.length === 0);
  console.log('Agendamento não cumprido');
  // a mercadoria não saiu: o agendamento continua com a data de hoje; um link comum já foi hoje (não pode travar o pedido)
  const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  await pool.query("UPDATE ag_agendamentos SET data_agendada=$1::date WHERE status='ativo'", [hojeIso]);
  await pool.query('UPDATE ag_links SET enviado_em=NOW()');
  let lista0 = await ag.listar(pool, cli, 'agendadas', {});
  check('lista: o agendamento de hoje ainda não é prioridade', lista0.rows.length === 2 && lista0.rows.every(x => x.prioridade === false), lista0.rows.map(x => [x.nf, x.prioridade]));
  // saiu para entrega no SSW: travado até a entrega ou um insucesso
  await pool.query("UPDATE ag_notas SET situacao='em_rota',status_ssw='SAIDA PARA ENTREGA' WHERE nf IN ('7001','7002')");
  erro = null; try { await lk.criarLink(pool, cli, sac, await id('7001'), 'https://exemplo.test'); } catch (e) { erro = e; }
  check('em rota sem insucesso: não pede nova data', erro && erro.status === 409 && /em rota/.test(erro.message), erro && erro.message);
  await pool.query("UPDATE ag_notas SET status_ssw='TENTATIVA DE ENTREGA - DESTINATARIO AUSENTE' WHERE nf IN ('7001','7002')");
  const rl = await lk.criarLink(pool, cli, sac, await id('7001'), 'https://exemplo.test');
  check('não cumprido: o envio vira pedido de desculpas e nova data, mesmo com link enviado hoje', rl.reagendar === true && /Pedimos desculpas/.test(rl.texto) && /prevista para hoje/.test(rl.texto)
    && /\*prioridade\*/.test(rl.texto) && /não pedimos pagamento/.test(rl.texto) && rl.notas.join() === '7001,7002' && rl.token === l.token, rl.texto);
  erro = null; try { await lk.criarLink(pool, cli, sac, await id('7002'), 'https://exemplo.test'); } catch (e) { erro = e; }
  check('o pedido de nova data não se repete no mesmo dia', erro && erro.status === 409 && /pedido de nova data/.test(erro.message), erro && erro.message);
  lista0 = await ag.listar(pool, cli, 'agendadas', {});
  check('lista: botão do pedido travado hoje e selo "nova data pedida"', lista0.rows.every(x => x.link && x.link.reagendar && x.link.reagendar_hoje), lista0.rows.map(x => x.link));
  check('relatório: o envio aparece como reagendar', (await pool.query("SELECT COUNT(*)::int n FROM ag_link_envios WHERE tipo='reagendar'")).rows[0].n === 1);
  let dr = await lk.dadosLink(pool, l.token);
  check('página: pede desculpas pelo dia que falhou e não mostra a data antiga como agendada', dr.reagendar && /, \d\d\/\d\d$/.test(dr.reagendar_texto) && !dr.agendada, dr);
  const nova = dr.datas[0].data;
  await lk.escolher(pool, l.token, { data: nova });
  const pr = (await pool.query("SELECT to_char(data_agendada,'YYYY-MM-DD') d,prioridade,prioridade_motivo FROM ag_agendamentos WHERE status='ativo'")).rows;
  check('cliente escolheu a nova data: as duas notas ficam como PRIORIDADE', pr.length === 2 && pr.every(x => x.d === nova && x.prioridade && /^Não cumprido em \d\d\/\d\d/.test(x.prioridade_motivo)), pr);
  check('histórico do reagendamento diz que não foi cumprido', (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='reagendado' AND detalhe LIKE '%Não cumprido em%prioridade%'")).rows[0].n === 2);
  const lp = await ag.listar(pool, cli, 'agendadas', { card: 'prioridade' });
  check('filtro ⚡ Prioridade e indicador mostram as duas', lp.rows.length === 2 && lp.rows.every(x => x.prioridade) && (await ag.indicadores(pool, cli)).prioridade === 2, lp.rows.length);
  dr = await lk.dadosLink(pool, l.token);
  check('página depois de escolher: mostra a nova data, sem o pedido de desculpas', !dr.reagendar && dr.agendada === nova, dr);
  // reagendar pelo painel (operador): agendamento vencido ganha nova data e vira prioridade; mudar uma data futura não vira
  const a7 = (await pool.query("SELECT a.id::text FROM ag_agendamentos a JOIN ag_notas n ON n.id=a.nota_id WHERE a.status='ativo' AND n.nf='7002'")).rows[0].id;
  await pool.query("UPDATE ag_agendamentos SET prioridade=FALSE,prioridade_motivo=NULL,data_agendada=$2::date-1 WHERE id=$1", [a7, hojeIso]);
  await ag.alterar(pool, cli, sac, a7, { data_agendada: dr.datas[2].data, motivo: 'A mercadoria não saiu' });
  const op = (await pool.query('SELECT prioridade FROM ag_agendamentos WHERE id=$1', [a7])).rows[0];
  check('operador reagendou um vencido: vira prioridade', op.prioridade === true, op);
  await pool.query('UPDATE ag_agendamentos SET prioridade=FALSE WHERE id=$1', [a7]);
  await ag.alterar(pool, cli, sac, a7, { data_agendada: dr.datas[3].data });
  check('mudar uma data futura não marca prioridade', (await pool.query('SELECT prioridade FROM ag_agendamentos WHERE id=$1', [a7])).rows[0].prioridade === false);

  console.log('Limite por cidade e sábado no link');
  {
    const sp = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    let sab = ''; for (let i = 3; i < 14 && !sab; i++) { const d = sp(i); if (new Date(d + 'T12:00:00Z').getUTCDay() === 6) sab = d; }
    await pool.query("UPDATE ag_rotas SET limite_dia=1,sabados=ARRAY[$1]::date[] WHERE chave='CAMPINAS'", [sab]);
    const rota = await wa.rotaDa(pool, cli, 'CAMPINAS', 'SP');
    check('sábado aberto pelo administrador entra nas datas da rota', rota.limite_dia === 1 && wa.proximasDatas(rota, { n: 10 }).includes(sab), wa.proximasDatas(rota, { n: 10 }));
    const X = (await pool.query("SELECT to_char(a.data_agendada,'YYYY-MM-DD') d FROM ag_agendamentos a JOIN ag_notas n ON n.id=a.nota_id WHERE a.status='ativo' AND n.nf='7001'")).rows[0].d;
    await ag.gravarNota(pool, cli, { nf: '7101', ctrc: 'AMR007101-1', remetente: 'QUADRI COMERCIO ..', destinatario: 'OUTRO CLIENTE LIMITE', cidade: 'CAMPINAS', uf: 'SP' }, { origem: 'consulta', pendente: true, situacaoNova: 'pendente' });
    await pool.query("UPDATE ag_notas SET telefone='(19) 99158-7000' WHERE nf='7101'");
    const lot = await ag.datasLotadas(pool, cli, { cidade: 'CAMPINAS', uf: 'SP', remetentes: ['QUADRI COMERCIO ..'], cliente: 'OUTRO CLIENTE LIMITE|CAMPINAS', datas: [X] });
    const lotProprio = await ag.datasLotadas(pool, cli, { cidade: 'CAMPINAS', uf: 'SP', remetentes: ['QUADRI COMERCIO ..'], cliente: 'MADA CABRAL 1330321|CAMPINAS', datas: [X] });
    check('data com a cota do grupo cheia: lotada para cliente novo, livre para quem já está nela', lot.has(X) && !lotProprio.has(X), [X, [...lot], [...lotProprio]]);
    const l7 = await lk.criarLink(pool, cli, sac, await id('7101'), 'https://exemplo.test');
    const d7 = await lk.dadosLink(pool, l7.token);
    check('link do cliente novo não oferece a data lotada', d7.datas.length > 0 && !d7.datas.some(x => x.data === X), d7.datas.map(x => x.data));
    erro = null; try { await ag.agendar(pool, cli, sac, { nota_id: await id('7101'), data_agendada: X, forcar: true }); } catch (e) { erro = e; }
    check('SAC sem ser administrador não força o limite', erro && erro.status === 409 && /Limite atingido/.test(erro.message), erro && erro.message);
    await pool.query("UPDATE ag_rotas SET limite_dia=NULL,sabados='{}' WHERE chave='CAMPINAS'");
  }

  console.log('Segurança');
  erro = null; try { await lk.dadosLink(pool, 'x'.repeat(24)); } catch (e) { erro = e; }
  check('link inexistente -> 404', erro && erro.status === 404);
  await pool.query("UPDATE ag_links SET expira_em=NOW()-INTERVAL '1 minute'");
  erro = null; try { await lk.dadosLink(pool, l.token); } catch (e) { erro = e; }
  check('link vencido -> 410', erro && erro.status === 410);
  check('página do cliente não tem dados embutidos (só carrega pelo link)', !/MADA|7001/.test(lk.PAGINA) && /noindex/.test(lk.PAGINA));

  await pool.end();
  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
