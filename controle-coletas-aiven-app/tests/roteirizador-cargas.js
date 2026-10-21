// Roteirizador de Cargas (roteirizador-cargas.js + roteirizador-cargas.html), servidor em modo teste.
// Cobre: página e API exigem login e permissão, carga inicial (cidades e dias de rota), gravação e
// leitura incremental de documentos, cadastros só para administrador, e o portal sem os roteirizadores antigos.
// Uso: BASE_URL=http://127.0.0.1:10000 ADMIN_USER=admin_teste ADMIN_PASS=... node tests/roteirizador-cargas.js
const B = process.env.BASE_URL || 'http://127.0.0.1:10000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin_teste', ADMIN_PASS = process.env.ADMIN_PASS || 'senha-de-teste-123';
if (/onrender\.com/i.test(B) && !/teste/i.test(B)) { console.error('Recusado: BASE_URL parece ser a produção.'); process.exit(2); }
const fs = require('fs'), path = require('path');
const lib = require('../roteirizador-cargas.js');
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  OK   ', name); } else { fail++; console.log('  FALHA', name, typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 300)); if (process.env.GITHUB_ACTIONS) console.log('::error title=Teste falhou::' + String(name).replace(/[\r\n]+/g, ' ')); } }
async function call(method, p, { body, cookie } = {}) {
  const h = {}; if (body !== undefined) h['Content-Type'] = 'application/json'; if (cookie) h.Cookie = cookie;
  const r = await fetch(B + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, setCookie: r.headers.get('set-cookie') || '', location: r.headers.get('location') || '' };
}
const login = async (u, s) => { const r = await call('POST', '/api/auth/login', { body: { username: u, password: s } }); return (r.setCookie.match(/cl_session=[^;]+/) || [''])[0]; };

(async () => {
  console.log('Regras do módulo');
  check('caminhos de documento: pares coleção/documento', lib.caminhoValido('cad/main') && lib.caminhoValido('op/main/notas/3526') && !lib.caminhoValido('op/main/notas') && !lib.caminhoValido('op/../x/y') && !lib.caminhoValido('a b/c'));
  check('cadastros só para administrador', lib.podeGravar({ is_admin: true }, 'cad/main/cidades/1') && !lib.podeGravar({ is_admin: false }, 'cad/main/cidades/1') && lib.podeGravar({ is_admin: false }, 'op/main/notas/1'));
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'roteirizador-cargas.seed.json'), 'utf8'));
  const arac = seed.find((d) => d.path === 'cad/main/cidades/3502903');
  check('carga inicial: 148 cidades, Araçoiaba da Serra terça e quinta', seed.filter((d) => d.path.startsWith('cad/main/cidades/')).length === 148 && arac && arac.data.dias.join() === '2,4', arac);

  console.log('Sobras em galpão: baixa pelo SSW de hora em hora, das 05:00 às 20:00');
  check('horários da conferência', lib.HORARIOS_SOBRAS.length === 16 && lib.HORARIOS_SOBRAS[0] === '05:00' && lib.HORARIOS_SOBRAS[15] === '20:00');
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await lib.ensureSchema(pool);
    const C = 'teste-sobras', put = (p, d) => pool.query('INSERT INTO rc_docs(cliente,path,colecao,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT (cliente,path) DO UPDATE SET data=EXCLUDED.data', [C, p, lib.colecaoDe(p), JSON.stringify(d)]);
    await pool.query('DELETE FROM rc_docs WHERE cliente=$1', [C]);
    await put('op/main/notas/n-a', { id: 'n-a', numero: '669950', status: 'pronta' });
    await put('op/main/sobras/2026-10-20_n-a', { id: '2026-10-20_n-a', data: '2026-10-20', notaId: 'n-a', numero: '669950', ctrc: 'AMR15326-5' });
    await put('op/main/sobras/2026-10-20_nf1001', { id: '2026-10-20_nf1001', data: '2026-10-20', numero: '1001' });
    await put('op/main/sobras/2026-10-20_nf1002', { id: '2026-10-20_nf1002', data: '2026-10-20', numero: '1002', statusManual: 'pendente' });
    await put('op/main/sobras/2026-09-01_nf1003', { id: '2026-09-01_nf1003', data: '2026-09-01', numero: '1003' });
    let pedidas = null;
    const x = await lib.conferirSobras(pool, C, async (nfs, desde) => { pedidas = { nfs: nfs.slice().sort(), desde }; return { ok: true, itens: { 669950: { status: 'entregue', em: '2026-10-21', fonte: 'Baixa no SSW' }, 1001: { status: 'em_rota', fonte: 'romaneio' }, 1002: { status: 'entregue' }, 1003: { status: 'entregue' } } }; }, '2026-10-21');
    check('confere só as sobras abertas dos últimos 20 dias e sem situação marcada à mão', pedidas && pedidas.nfs.join() === '1001,669950' && pedidas.desde === '2026-10-20', pedidas);
    const doc = async (p) => (await pool.query('SELECT data,updated_by FROM rc_docs WHERE cliente=$1 AND path=$2', [C, p])).rows[0];
    const a = await doc('op/main/sobras/2026-10-20_n-a'), na = await doc('op/main/notas/n-a'), b = await doc('op/main/sobras/2026-10-20_nf1001'), m = await doc('op/main/sobras/2026-10-20_nf1002');
    check('baixa no SSW: a sobra fica entregue (sai da lista) e a nota acompanha', a.data.status === 'entregue' && a.data.entregueEm === '2026-10-21' && a.data.ctrc === 'AMR15326-5' && na.data.status === 'entregue' && a.updated_by === 'conferência SSW', [a, na]);
    check('saiu em romaneio: em rota', b.data.status === 'em_rota' && !b.data.entregueEm, b.data);
    check('marcada à mão não muda', !m.data.status, m.data);
    check('resumo da conferência', x.conferidas === 2 && x.entregues === 1 && x.emRota === 1 && x.alteradas === 2, x);
    const y = await lib.conferirSobras(pool, C, async (nfs) => ({ itens: { 1001: { status: 'em_rota' } } }), '2026-10-21');
    check('segunda conferência: a entregue não é consultada de novo', y.conferidas === 1 && y.alteradas === 0, y);
    await pool.query('DELETE FROM rc_docs WHERE cliente=$1', [C]);
    await pool.end();
  } else console.log('  (sem DATABASE_URL: conferência no banco não testada)');
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'roteirizador-cargas-fonte', 'app.js'), 'utf8');
  check('tela de sobras tem o campo do CT-e ao lado da NF', fonte.includes('id="sbCTE"') && fonte.includes('CT-e (código de barras)') && fonte.includes("flex:0 1 200px"));
  check('a página não consulta mais as sobras no SSW a cada 10 minutos', !fonte.includes('sincronizarSobras'));

  console.log('Sem login');
  let r = await call('GET', '/roteirizador-cargas');
  check('página sem login vai para o login do portal', r.status === 302 && /login=1/.test(r.location), r.status + ' ' + r.location);
  r = await call('GET', '/api/rc/mudancas'); check('API sem login -> 401', r.status === 401, 'veio ' + r.status);
  r = await call('PUT', '/api/rc/doc', { body: { path: 'op/main/notas/x', data: { a: 1 } } }); check('gravar sem login -> 401', r.status === 401, 'veio ' + r.status);

  r = await call('GET', '/api/rc/sistema');
  check('versão do sistema é pública (botão Atualizar sistema)', r.status === 200 && !!r.json.versao && !!r.json.pagina, r.status);
  r = await call('GET', '/dashboard/');
  console.log('Administrador');
  const adm = await login(ADMIN_USER, ADMIN_PASS);
  check('login', !!adm);
  r = await call('GET', '/roteirizador-cargas', { cookie: adm });
  check('página abre (ponte do CONSTRULOG + aplicativo)', r.status === 200 && r.text.includes('RC_HOST') && r.text.includes('Roteirizador'), r.status);
  r = await call('GET', '/api/rc/versao', { cookie: adm });
  const pag = fs.readFileSync(path.join(__dirname, '..', 'roteirizador-cargas.html'), 'utf8');
  check('versão publicada igual à da página (aviso de versão nova)', r.status === 200 && r.json.versao && pag.includes('name="rc-versao" content="' + r.json.versao + '"'), r.json);
  r = await call('GET', '/api/rc/eu', { cookie: adm });
  check('usuário e perfil de administrador', r.status === 200 && r.json.admin === true && r.json.username === ADMIN_USER, r.json);
  r = await call('GET', '/api/roteirizador/cte-nf?codigo=12345', { cookie: adm });
  check('CT-e bipado nas sobras: código curto é recusado com aviso', r.status === 400 && /Não reconheci/.test(r.json && r.json.error), r.status + ' ' + r.text.slice(0, 200));
  r = await call('GET', '/api/roteirizador/cte-nf?codigo=' + '35261012345678000190' + '55' + '001' + '000669950' + '1' + '12345678' + '9', { cookie: adm });
  check('  ...código da NF-e (DANFE) pede o do CT-e', r.status === 400 && /DACTE/.test(r.json && r.json.error), r.status + ' ' + r.text.slice(0, 200));
  r = await call('GET', '/api/rc/mudancas', { cookie: adm });
  const cid = (r.json && r.json.docs || []).filter((d) => d.path.startsWith('cad/main/cidades/'));
  check('primeira leitura traz a carga inicial completa', r.status === 200 && r.json.completo === true && cid.length === 148 && r.json.docs.some((d) => d.path === 'cad/main'), r.status + ' ' + (r.json && r.json.docs || []).length);
  check('  ...e as notas que ficaram no galpão em 09/10', r.json.docs.filter((d) => d.path.startsWith('op/main/sobras/2026-10-09')).length === 25);
  const t0 = r.json.agora;
  r = await call('PUT', '/api/rc/doc', { cookie: adm, body: { path: 'cad/main/veiculos/van-teste', data: { id: 'van-teste', nome: 'Van Teste', tipo: 'van', capKg: 1500 } } });
  check('administrador grava cadastro', r.status === 200 && r.json.ok, r.json);
  r = await call('PUT', '/api/rc/doc', { cookie: adm, body: { path: 'op/main/notas/n1', data: { id: 'n1', numero: '123', status: 'pronta' } } });
  check('grava nota', r.status === 200);
  r = await call('GET', '/api/rc/mudancas?desde=' + encodeURIComponent(t0), { cookie: adm });
  check('leitura incremental traz só o que mudou', r.status === 200 && r.json.completo === false && r.json.docs.map((d) => d.path).sort().join() === 'cad/main/veiculos/van-teste,op/main/notas/n1', r.json && r.json.docs.map((d) => d.path));
  const t1 = r.json.agora;
  r = await call('DELETE', '/api/rc/doc?path=' + encodeURIComponent('op/main/notas/n1'), { cookie: adm });
  r = await call('GET', '/api/rc/mudancas?desde=' + encodeURIComponent(t1), { cookie: adm });
  check('exclusão aparece para os outros usuários', r.json.removidos.includes('op/main/notas/n1') && !r.json.docs.length, r.json);
  r = await call('PUT', '/api/rc/doc', { cookie: adm, body: { path: 'op/main/notas', data: { a: 1 } } });
  check('caminho de coleção é recusado', r.status === 400);
  r = await call('PUT', '/api/rc/doc', { cookie: adm, body: { path: 'op/main/notas/n2', data: [1, 2] } });
  check('documento precisa ser objeto', r.status === 400);

  console.log('Operador e usuário sem acesso');
  const nome = 'oper_rc_' + Date.now().toString(36), nome2 = 'sem_rc_' + Date.now().toString(36);
  r = await call('POST', '/api/painel/auth/users', { cookie: adm, body: { username: nome, password: 'senha-oper-1', permissions: ['roteirizador'] } });
  check('cria operador com o Roteirizador', r.status === 201, r.text.slice(0, 120));
  r = await call('POST', '/api/painel/auth/users', { cookie: adm, body: { username: nome2, password: 'senha-oper-2', permissions: ['coletas'] } });
  const op = await login(nome, 'senha-oper-1'), sem = await login(nome2, 'senha-oper-2');
  r = await call('GET', '/api/rc/eu', { cookie: op });
  check('operador entra como operador', r.status === 200 && r.json.admin === false, r.json);
  r = await call('PUT', '/api/rc/doc', { cookie: op, body: { path: 'op/main/sobras/x1', data: { id: 'x1', numero: '9' } } });
  check('operador lança nota que ficou', r.status === 200, r.json);
  r = await call('PUT', '/api/rc/doc', { cookie: op, body: { path: 'cad/main/cidades/3509502', data: { id: '3509502', dias: [6] } } });
  check('operador não altera dias de rota', r.status === 403, r.status);
  r = await call('GET', '/api/rc/mudancas', { cookie: sem });
  check('usuário sem a permissão não vê os dados', r.status === 403, r.status);
  r = await call('GET', '/roteirizador-cargas', { cookie: sem });
  check('  ...nem a página', r.status === 403, r.status);

  console.log('Portal');
  r = await call('GET', '/', { cookie: adm });
  const portal = fs.readFileSync(path.join(__dirname, '..', 'painel.html'), 'utf8');
  check('portal tem o botão Atualizar ao lado do nome', portal.includes('id="sysUpdate"'));
  const imgs = [...portal.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
  check('logo do portal é uma imagem válida', imgs.length >= 2 && imgs.every((b) => Buffer.from(b, 'base64').toString('base64') === b && Buffer.from(b, 'base64').slice(1, 4).toString() === 'PNG'));
  check('portal tem o Roteirizador novo e não tem mais o Teste nem o V02', portal.includes('data-module="roteirizador-cargas"') && !portal.includes('data-module="roteirizador-teste"') && !portal.includes('data-module="roteirizador-v02"'));

  check('portal tem o card Financeiro com Financeiro, Receita SSW e Clientes Remetentes', portal.includes('data-group="financeiro"') && ['fin-op', 'receita-ssw', 'remetentes'].every((m) => portal.includes('data-module="' + m + '"')));
  const grupo = (g) => (portal.match(new RegExp('data-group-panel="' + g + '">([\\s\\S]*?)</div>')) || [])[1] || '';
  check('em cima ficam Operação, Financeiro e R.H.; embaixo só os cards de cada um', ['operacao', 'financeiro', 'rh'].every((g) => portal.includes('group-card') && portal.includes('data-group="' + g + '">')) && !portal.includes('data-group-panel="lotacao"') && /data-module="coletas"[\s\S]*data-module="frota"/.test(grupo('operacao')) && grupo('financeiro').includes('data-module="contas"') && grupo('rh').includes('data-module="holerites"'));
  const dash = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'index.html'), 'utf8');
  check('menu do dashboard tem o botão Atualizar sistema', dash.includes('id="sysUpdate"'));
  check('envio dos holerites saiu da DRE e fica em R.H. • Holerites', !/<section id="despesas"[\s\S]*?id="holFile"[\s\S]*?<\/section>/.test(dash.match(/<section id="despesas"[\s\S]*?<\/section>/)[0]) && /<section id="holerites"[\s\S]*?id="holFile"/.test(dash));
  check('Dashboards sem os cards Financeiro, Receita SSW e Clientes Remetentes', !/<h3>(Financeiro|Receita SSW|Entregas por Cliente Remetente)<\/h3>/.test(dash));
  check('menu do dashboard tem o Roteirizador novo e não tem o Teste nem o V02', dash.includes('data-tab="roteirizador-cargas"') && !dash.includes('data-tab="roteirizador-v02"') && !dash.includes('data-tab="roteirizador-teste"'));

  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
