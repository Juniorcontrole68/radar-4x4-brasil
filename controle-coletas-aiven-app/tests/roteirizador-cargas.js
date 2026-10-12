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

  console.log('Sem login');
  let r = await call('GET', '/roteirizador-cargas');
  check('página sem login vai para o login do portal', r.status === 302 && /login=1/.test(r.location), r.status + ' ' + r.location);
  r = await call('GET', '/api/rc/mudancas'); check('API sem login -> 401', r.status === 401, 'veio ' + r.status);
  r = await call('PUT', '/api/rc/doc', { body: { path: 'op/main/notas/x', data: { a: 1 } } }); check('gravar sem login -> 401', r.status === 401, 'veio ' + r.status);

  console.log('Administrador');
  const adm = await login(ADMIN_USER, ADMIN_PASS);
  check('login', !!adm);
  r = await call('GET', '/roteirizador-cargas', { cookie: adm });
  check('página abre (ponte do CONSTRULOG + aplicativo)', r.status === 200 && r.text.includes('RC_HOST') && r.text.includes('Roteirizador'), r.status);
  r = await call('GET', '/api/rc/eu', { cookie: adm });
  check('usuário e perfil de administrador', r.status === 200 && r.json.admin === true && r.json.username === ADMIN_USER, r.json);
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
  check('portal tem o Roteirizador novo e não tem mais o Teste nem o V02', portal.includes('data-module="roteirizador-cargas"') && !portal.includes('data-module="roteirizador-teste"') && !portal.includes('data-module="roteirizador-v02"'));

  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
