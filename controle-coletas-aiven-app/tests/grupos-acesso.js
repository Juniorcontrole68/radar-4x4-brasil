// Grupos de acesso em Usuários: 4 grupos iniciais, autorizações do grupo valem para os membros,
// autorizações extras (manuais) somam, e trocar o grupo muda o acesso na hora.
// Uso: BASE_URL=http://127.0.0.1:10000 ADMIN_USER=admin_teste ADMIN_PASS=... node tests/grupos-acesso.js
const B = process.env.BASE_URL || 'http://127.0.0.1:10000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin_teste', ADMIN_PASS = process.env.ADMIN_PASS || 'senha-de-teste-123';
if (/onrender\.com/i.test(B) && !/teste/i.test(B)) { console.error('Recusado: BASE_URL parece ser a produção.'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  OK   ', name); } else { fail++; console.log('  FALHA', name, typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 300)); if (process.env.GITHUB_ACTIONS) console.log('::error title=Teste falhou::' + String(name)); } }
async function call(method, p, { body, cookie } = {}) {
  const h = {}; if (body !== undefined) h['Content-Type'] = 'application/json'; if (cookie) h.Cookie = cookie;
  const r = await fetch(B + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, setCookie: r.headers.get('set-cookie') || '' };
}
const login = async (u, s) => { const r = await call('POST', '/api/auth/login', { body: { username: u, password: s } }); return (r.setCookie.match(/cl_session=[^;]+/) || [''])[0]; };
const temAcesso = async (ck) => (await call('GET', '/api/rc/eu', { cookie: ck })).status === 200; // exige 'roteirizador'

(async () => {
  const adm = await login(ADMIN_USER, ADMIN_PASS);
  check('login do administrador', !!adm);
  let r = await call('GET', '/api/painel/auth/groups', { cookie: adm });
  check('4 grupos iniciais', r.status === 200 && r.json.rows.length >= 4 && r.json.rows.slice(0, 4).every((g, i) => g.nome), r.json);
  const g1 = r.json.rows[0], g2 = r.json.rows[1];
  r = await call('PATCH', '/api/painel/auth/groups/' + g1.id, { cookie: adm, body: { nome: 'Operação', permissions: ['roteirizador', 'programacao'] } });
  check('renomeia o grupo e define as autorizações', r.status === 200 && r.json.group.nome === 'Operação' && r.json.group.permissions.includes('roteirizador'), r.json);
  const nome = 'grp_' + Date.now().toString(36);
  r = await call('POST', '/api/painel/auth/users', { cookie: adm, body: { username: nome, password: 'senha-grp-1', permissions: [], group_id: g1.id } });
  check('cria usuário no grupo, sem autorizações próprias', r.status === 201 && r.json.user.group_id === g1.id, r.text.slice(0, 200));
  const uid = r.json.user.id;
  let ck = await login(nome, 'senha-grp-1');
  check('membro recebe a autorização do grupo', await temAcesso(ck));
  r = await call('PATCH', '/api/painel/auth/users/' + uid, { cookie: adm, body: { group_id: g2.id } });
  check('troca de grupo', r.status === 200 && r.json.user.group_id === g2.id, r.json);
  check('  ...e perde o que vinha do grupo anterior', !(await temAcesso(ck)));
  r = await call('PATCH', '/api/painel/auth/users/' + uid, { cookie: adm, body: { permissions: ['roteirizador'] } });
  check('autorização extra inserida à mão vale mesmo fora do grupo', r.status === 200 && await temAcesso(ck));
  r = await call('PATCH', '/api/painel/auth/users/' + uid, { cookie: adm, body: { permissions: [], group_id: g1.id } });
  r = await call('PATCH', '/api/painel/auth/groups/' + g1.id, { cookie: adm, body: { permissions: ['programacao'] } });
  check('tirar do grupo tira de todos os membros', !(await temAcesso(ck)));
  r = await call('PATCH', '/api/painel/auth/users/' + uid, { cookie: adm, body: { group_id: '999999' } });
  check('grupo inexistente é recusado', r.status === 400, r.status);
  r = await call('GET', '/api/painel/auth/groups', { cookie: ck });
  check('só administrador mexe nos grupos', r.status === 403 || r.status === 401, r.status);
  r = await call('POST', '/api/painel/auth/groups', { cookie: adm, body: { nome: 'Temporário' } });
  const tmp = r.json && r.json.group && r.json.group.id;
  r = await call('DELETE', '/api/painel/auth/groups/' + tmp, { cookie: adm });
  check('cria e exclui grupo', !!tmp && r.status === 200);
  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
