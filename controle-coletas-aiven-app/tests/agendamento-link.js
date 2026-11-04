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
  await pool.query('DELETE FROM ag_links;DELETE FROM ag_wa_mensagens;DELETE FROM ag_wa_conversas;DELETE FROM ag_rotas;DELETE FROM ag_reservas;DELETE FROM ag_locais;DELETE FROM ag_eventos;DELETE FROM ag_agendamentos;DELETE FROM ag_notas;DELETE FROM ag_config');
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
  check('mensagem da Ana com nome limpo, NFs, cidade, link e aviso dos 15 dias', /Olá, Mada Cabral! 👋 Sou a \*Ana\*/.test(l.texto) && /NFs 7001, 7002 — QUADRI COMERCIO/.test(l.texto) && l.texto.includes(l.url) && /15 dias/.test(l.texto), l.texto);
  let e2 = null; try { await lk.criarLink(pool, cli, sac, await id('7002'), 'https://exemplo.test'); } catch (e) { e2 = e; }
  check('mesmo cliente no mesmo dia: travado até amanhã', e2 && e2.status === 409 && /já foi enviado hoje às \d\d:\d\d por maria/.test(e2.message), e2 && e2.message);
  const lista = await ag.listar(pool, cli, 'sem', {});
  check('lista do SAC mostra o envio de hoje nas duas notas do cliente', ['7001', '7002'].every(nf => { const r = lista.rows.find(x => x.nf === nf); return r && r.link && r.link.hoje === true && r.link.por === 'maria'; }), lista.rows.map(r => [r.nf, r.link]));
  await pool.query("UPDATE ag_links SET enviado_em=NOW()-INTERVAL '1 day'");
  const l2 = await lk.criarLink(pool, cli, sac, await id('7002'), 'https://exemplo.test');
  check('no dia seguinte libera e reaproveita o mesmo link', l2.token === l.token && (await ag.listar(pool, cli, 'sem', {})).rows.find(x => x.nf === '7002').link.hoje === true);
  let erro = null; try { await lk.criarLink(pool, cli, sac, await id('7003'), 'x'); } catch (e) { erro = e; }
  check('cidade sem entrega (Osasco) não gera link', erro && erro.status === 422, erro && erro.message);

  console.log('Página do cliente');
  let d = await lk.dadosLink(pool, l.token);
  check('dados: nome, entrega, datas da rota e sem agendamento', d.nome === 'Mada Cabral' && /NFs 7001, 7002/.test(d.entrega) && d.datas.length === 8 && !d.agendada && !d.tem_local, d);
  erro = null; try { await lk.escolher(pool, l.token, { data: '2099-01-01' }); } catch (e) { erro = e; }
  check('data fora da rota é recusada', erro && erro.status === 422);
  const dt = d.datas[1].data;
  let r = await lk.escolher(pool, l.token, { data: dt, local: '-22.905600,-47.060800' });
  const ags = (await pool.query("SELECT to_char(data_agendada,'YYYY-MM-DD') d,criado_por_nome FROM ag_agendamentos WHERE status='ativo'")).rows;
  check('escolheu: as duas notas agendadas, mesmo com o cliente reservado pelo SAC', r.notas === 2 && ags.length === 2 && ags.every(a => a.d === dt && a.criado_por_nome === 'Cliente (link)'), ags);
  const loc = (await pool.query("SELECT lat FROM ag_locais WHERE chave='MADA CABRAL 1330321|CAMPINAS'")).rows[0];
  check('localização do celular vai para o campo Localização', r.localizacao && loc && Math.abs(loc.lat + 22.9056) < 1e-6, loc);
  d = await lk.dadosLink(pool, l.token);
  check('abrindo de novo: mostra a data agendada e a localização recebida', d.agendada === dt && d.tem_local);
  const dt2 = d.datas[3].data;
  await lk.escolher(pool, l.token, { data: dt2 });
  const re = (await pool.query("SELECT to_char(data_agendada,'YYYY-MM-DD') d,reagendamentos FROM ag_agendamentos WHERE status='ativo'")).rows;
  check('mudar a data pelo link é reagendamento', re.length === 2 && re.every(a => a.d === dt2 && a.reagendamentos === 1), re);
  check('histórico: link enviado pelo SAC e agendado pelo cliente', (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='whatsapp' AND para='link' AND usuario='maria'")).rows[0].n >= 2
    && (await pool.query("SELECT COUNT(*)::int n FROM ag_eventos WHERE tipo='agendado' AND usuario='Cliente (link)'")).rows[0].n === 2);

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
