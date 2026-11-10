'use strict';
// Conferência de carga por código de barras das etiquetas dos clientes (a Construlog não imprime etiqueta própria).
//
// Descarga: a carga esperada são os CT-es emitidos no SSW na janela da descarga (padrão: 19:00 da véspera até
// 04:00 do dia), lidos do relatório 174 do BI2 pelo painel (rota /api/conferencia/ssw-esperado). Depois a carga
// inteira é bipada, volumes misturados. Cada etiqueta é reconhecida pelo formato do código e conta para o parceiro:
//   Transbarbosa  14 dígitos começando com 465701, um código por volume
//   Conasid       12 dígitos começando com 001000, um código por volume
//   Leal Dutra    número do pedido (6 dígitos), igual em todos os volumes: só conta
//   Comercial Leal QR de 23 dígitos, um por volume: NF (12) + 0 + 1001 + volume (3) + total (3),
//                 ex.: 00000032643501001013043 = NF 326435, volume 13 de 43 (o texto impresso embaixo é só o começo)
//   FCB / JT / THM 14 dígitos começando com 203818 (código de barras na vertical), um por volume. FCB Brasil
//                 Transportes, JT Transportes e THM são o mesmo cliente (remetente Construdecor)
// A etiqueta não traz NF nem CT-e: a conferência fecha por parceiro (esperado = soma dos volumes dos CT-es dele).
// DACTE (chave de 44 dígitos) também pode ser bipado: marca o CT-e como documento conferido, não conta volume.
//
// Carregamento: a carga esperada vem do romaneio de entregas (opção 38 do SSW) ou é montada bipando os DACTEs dos
// CT-es que vão no caminhão (cada DACTE novo entra na carga). Depois os volumes: volume de parceiro sem CT-e na
// carga ou a mais do que os CT-es dizem aparece em vermelho, "NÃO CARREGAR".
//
// Contagem do galpão: a carga esperada são os CT-es disponíveis para entrega na unidade (pendências da opção 38 do
// SSW, ainda sem romaneio). Bipa-se tudo o que está no galpão; fecha por parceiro: o que falta (está no SSW e não foi
// achado) e o que sobra (volume a mais ou de parceiro sem CT-e na unidade).
//
// Motorista: no carregamento, o conferente gera um link exclusivo daquela carga (placa/romaneio) e manda pelo
// WhatsApp. O motorista abre no celular sem login (/conferencia/m/<token>) e só bipa e acompanha: não desfaz
// leitura, não tira nem põe CT-e, não atualiza do SSW, não fecha e não vê outras cargas. O link vale enquanto a
// conferência estiver aberta (até 24 h) e pode ser trocado (o anterior para de funcionar).
//
// Galpão por rota: as rotas são cadastradas como listas de cidades (conf_rotas). Dentro da conferência do galpão o
// conferente abre uma rota (vários conferentes, várias rotas ao mesmo tempo): a rota é uma conferência filha
// (pai_id) com os CT-es do galpão cujas cidades são dela. Etiqueta que traz a NF (padrão com o grupo (?<nf>...),
// hoje a Comercial Leal), DANFE ou DACTE de um CT-e de outra rota dá "ROTA ERRADA". Etiqueta que só tem o número
// da caixa (Conasid, Transbarbosa, FCB) conta por parceiro dentro da rota: o que passa do total é sobra.
//
// A contagem do galpão é uma por dia (coluna dia): quem pede outra no mesmo dia entra na que já existe, e ela fica
// gravada com as leituras de todas as rotas. Relatório (/sessoes/:id/relatorio): por rota, o que foi e o que não foi
// bipado, e a lista só dos CT-es achados em rota errada. Consulta de nota (/nf/:nf): avisa se, na última contagem
// do galpão em que a nota estava, alguma caixa dela foi achada em outra rota.
//
// Tabelas: conf_rotas, conf_formatos (formatos de etiqueta por empresa, editáveis), conf_sessoes, conf_esperado, conf_leituras.
// Testado em tests/conferencia.js.

const crypto = require('crypto');
const limpo = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const semAcento = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const erro = (status, msg, code) => { const e = new Error(msg); e.status = status; if (code) e.code = code; return e; };

const FORMATOS_PADRAO = [
  { nome: 'Transbarbosa', padrao: '^465701\\d{8}$', termos: 'TRANSBARBOSA', por_volume: true },
  { nome: 'Conasid', padrao: '^001000\\d{6}$', termos: 'CONASID', por_volume: true },
  { nome: 'Leal Dutra', padrao: '^\\d{6}$', termos: 'LEAL DUTRA', por_volume: false },
  { nome: 'Comercial Leal', padrao: '^(?<nf>\\d{12})0\\d{10}$', termos: 'COMERCIAL LEAL', por_volume: true },
  { nome: 'FCB / JT / THM', padrao: '^203818\\d{8}$', termos: 'FCB, JT TRANSP, CONSTRUDECOR', por_volume: true },
];
// Formatos que entraram depois: são acrescentados a quem já tinha a lista (se não houver um com o mesmo nome;
// para não usar, o administrador desliga).
const FORMATOS_ACRESCIDOS = ['Comercial Leal', 'FCB / JT / THM'];
const TIPOS = ['descarga', 'carregamento', 'contagem'];

async function ensureSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_formatos (id BIGSERIAL PRIMARY KEY, client_id BIGINT, nome TEXT NOT NULL,
    padrao TEXT NOT NULL, termos TEXT NOT NULL DEFAULT '', por_volume BOOLEAN NOT NULL DEFAULT TRUE, ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ordem INT NOT NULL DEFAULT 0, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_sessoes (id BIGSERIAL PRIMARY KEY, client_id BIGINT, tipo TEXT NOT NULL,
    titulo TEXT NOT NULL DEFAULT '', janela_ini TIMESTAMPTZ, janela_fim TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'aberta',
    criado_por TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), carregado_em TIMESTAMPTZ,
    fechada_em TIMESTAMPTZ, fechada_por TEXT, observacao TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_esperado (id BIGSERIAL PRIMARY KEY, sessao_id BIGINT NOT NULL REFERENCES conf_sessoes(id) ON DELETE CASCADE,
    ctrc TEXT NOT NULL, nf TEXT NOT NULL DEFAULT '', volumes INT NOT NULL DEFAULT 0, chave TEXT NOT NULL DEFAULT '', destinatario TEXT NOT NULL DEFAULT '',
    cidade TEXT NOT NULL DEFAULT '', parceiro TEXT NOT NULL DEFAULT '', nomes TEXT NOT NULL DEFAULT '', emitido_em TIMESTAMPTZ,
    dacte_lido_em TIMESTAMPTZ, UNIQUE (sessao_id, ctrc))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_leituras (id BIGSERIAL PRIMARY KEY, sessao_id BIGINT NOT NULL REFERENCES conf_sessoes(id) ON DELETE CASCADE,
    uuid TEXT, codigo TEXT NOT NULL, tipo TEXT NOT NULL, parceiro TEXT NOT NULL DEFAULT '', ctrc TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL, usuario TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), desfeita_em TIMESTAMPTZ)`);
  // carregamento: modo 'romaneio' (referencia = romaneio do SSW) ou 'ctes' (carga montada pelos DACTEs bipados)
  await pool.query("ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS referencia TEXT NOT NULL DEFAULT ''");
  // link do motorista: só o hash do token fica no banco
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS motorista_token_hash TEXT');
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS motorista_link_em TIMESTAMPTZ');
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS motorista_terminou_em TIMESTAMPTZ');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_conf_motorista_token ON conf_sessoes (motorista_token_hash) WHERE motorista_token_hash IS NOT NULL');
  // DACTE do parceiro (Transbarbosa): a chave do CT-e dele, que bipamos no lugar do nosso
  await pool.query("ALTER TABLE conf_esperado ADD COLUMN IF NOT EXISTS chave_parceiro TEXT NOT NULL DEFAULT ''");
  await pool.query(`CREATE TABLE IF NOT EXISTS conf_rotas (id BIGSERIAL PRIMARY KEY, client_id BIGINT, nome TEXT NOT NULL,
    cidades TEXT NOT NULL DEFAULT '', ordem INT NOT NULL DEFAULT 0, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS pai_id BIGINT');
  await pool.query('ALTER TABLE conf_sessoes ADD COLUMN IF NOT EXISTS dia DATE');   // contagem do galpão: uma por dia
  await pool.query("CREATE INDEX IF NOT EXISTS idx_conf_sessoes_galpao ON conf_sessoes (client_id, dia) WHERE tipo='contagem' AND pai_id IS NULL");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_conf_sessoes_pai ON conf_sessoes (pai_id) WHERE pai_id IS NOT NULL');
  // Comercial Leal: o padrão passou a separar a NF (grupo nf)
  await pool.query("UPDATE conf_formatos SET padrao='^(?<nf>\\d{12})0\\d{10}$' WHERE nome='Comercial Leal' AND padrao='^\\d{12}0\\d{10}$'");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_conf_leitura_uuid ON conf_leituras (sessao_id, uuid) WHERE uuid IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_conf_leitura_sessao ON conf_leituras (sessao_id, id)');
}

// ------------------------------------------------------------------ formatos de etiqueta
async function formatos(db, cli) {
  let q = await db.query('SELECT id::text,nome,padrao,termos,por_volume,ativo,ordem FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli]);
  if (!q.rowCount) {
    for (const [i, f] of FORMATOS_PADRAO.entries())
      await db.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ordem) VALUES($1,$2,$3,$4,$5,$6)', [cli, f.nome, f.padrao, f.termos, f.por_volume, i]);
    q = await db.query('SELECT id::text,nome,padrao,termos,por_volume,ativo,ordem FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli]);
  }
  const faltam = FORMATOS_PADRAO.filter(f => FORMATOS_ACRESCIDOS.includes(f.nome) && !q.rows.some(r => r.nome === f.nome));
  if (faltam.length) {
    let ordem = Math.max(0, ...q.rows.map(r => r.ordem)) + 1;
    for (const f of faltam) await db.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ordem) VALUES($1,$2,$3,$4,$5,$6)', [cli, f.nome, f.padrao, f.termos, f.por_volume, ordem++]);
    q = await db.query('SELECT id::text,nome,padrao,termos,por_volume,ativo,ordem FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli]);
  }
  return q.rows;
}
function compilar(fs) {
  return fs.filter(f => f.ativo).map(f => {
    let re = null; try { re = new RegExp(f.padrao); } catch { re = null; }
    return { ...f, re, termosN: String(f.termos || '').split(/[,;\n]/).map(semAcento).filter(Boolean) };
  }).filter(f => f.re);
}
async function salvarFormatos(db, cli, lista) {
  if (!Array.isArray(lista) || !lista.length) throw erro(400, 'Informe ao menos um formato de etiqueta.');
  const ok = lista.slice(0, 40).map((f, i) => {
    const nome = limpo(f.nome, 60), padrao = String(f.padrao || '').trim().slice(0, 200);
    if (!nome || !padrao) throw erro(400, 'Cada formato precisa de nome e padrão.');
    try { new RegExp(padrao); } catch { throw erro(400, 'Padrão inválido em "' + nome + '".'); }
    return { nome, padrao, termos: limpo(f.termos, 300), por_volume: f.por_volume !== false, ativo: f.ativo !== false, ordem: i };
  });
  await db.query('DELETE FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1', [cli]);
  for (const f of ok) await db.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ativo,ordem) VALUES($1,$2,$3,$4,$5,$6,$7)', [cli, f.nome, f.padrao, f.termos, f.por_volume, f.ativo, f.ordem]);
}

// Ensinar etiqueta: a partir de 1 a 10 códigos bipados do mesmo cliente, monta o padrão (regex).
//   prefixo fixo (letras do começo e, se cada caixa tem código próprio, os primeiros dígitos até 6, só o que é comum
//   aos exemplos) + o resto pelo tipo de caractere e pelo tamanho.
//   "Mesmo código em todas as caixas" (número do pedido) muda a cada carga: aí só ficam as letras do começo.
const normCodigo = v => String(v || '').replace(/[\s\r\n\t]+/g, '').toUpperCase().slice(0, 120);
const escRe = v => v.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
function inferirPadrao(exemplos, porVolume = true) {
  const ex = [...new Set((Array.isArray(exemplos) ? exemplos : [exemplos]).map(normCodigo).filter(Boolean))].slice(0, 10);
  if (!ex.length) throw erro(400, 'Bipe ao menos uma etiqueta do cliente.');
  const min = Math.min(...ex.map(e => e.length)), max = Math.max(...ex.map(e => e.length));
  const letras = (ex[0].match(/^[^0-9]*/) || [''])[0];
  let pre;
  if (!porVolume) pre = ex.every(e => e.startsWith(letras)) ? letras : '';
  else if (ex.length === 1) pre = ex[0].slice(0, Math.max(letras.length, Math.min(6, Math.floor(ex[0].length / 2))));
  else {
    pre = ex[0];
    for (const e of ex.slice(1)) { let i = 0; while (i < pre.length && i < e.length && pre[i] === e[i]) i++; pre = pre.slice(0, i); }
    pre = pre.slice(0, Math.min(min - 2, Math.max(letras.length, Math.min(6, Math.floor(min / 2)))));   // volumes da mesma carga têm números seguidos
  }
  const restos = ex.map(e => e.slice(pre.length)).join('');
  const classe = /^\d*$/.test(restos) ? '\\d' : /^[A-Z0-9]*$/.test(restos) ? '[A-Z0-9]' : '\\S';
  const a = min - pre.length, b = max - pre.length;
  const padrao = '^' + escRe(pre) + (b <= 0 ? '' : classe + (a === b ? '{' + a + '}' : '{' + a + ',' + b + '}')) + '$';
  return { padrao, exemplos: ex };
}

// Formato novo ensinado no chão (qualquer usuário com acesso à Conferência). Entra no fim da lista: não muda o que
// já é reconhecido. Depois reaplica nas conferências abertas (leituras "não reconhecida" e CT-es sem parceiro).
async function ensinar(pool, cli, b) {
  const nome = limpo(b.nome, 60);
  if (!nome) throw erro(400, 'Informe o cliente desta etiqueta.');
  const porVolume = b.por_volume !== false;
  const inf = inferirPadrao(b.exemplos, porVolume);
  const padrao = String(b.padrao || inf.padrao).trim().slice(0, 200);
  let re; try { re = new RegExp(padrao); } catch { throw erro(400, 'Padrão inválido.'); }
  const naoBate = inf.exemplos.filter(e => !re.test(e));
  if (naoBate.length) throw erro(400, 'O padrão não reconhece a etiqueta ' + naoBate[0] + '.');
  const fs = compilar(await formatos(pool, cli));
  for (const e of inf.exemplos) {
    const c = classificar(fs, e);
    if (c.tipo === 'volume') throw erro(409, 'A etiqueta ' + e + ' já é reconhecida como ' + c.parceiro + '. Para trocar, o administrador ajusta o formato de ' + c.parceiro + '.');
    if (c.tipo === 'dacte' || c.tipo === 'danfe') throw erro(400, 'Este código é a chave de um ' + c.tipo.toUpperCase() + ', não a etiqueta do cliente.');
  }
  const termos = limpo(b.termos, 300) || semAcento(nome);
  const ordem = Number((await pool.query('SELECT COALESCE(MAX(ordem),0)+1 AS o FROM conf_formatos WHERE client_id IS NOT DISTINCT FROM $1', [cli])).rows[0].o);
  await pool.query('INSERT INTO conf_formatos(client_id,nome,padrao,termos,por_volume,ordem) VALUES($1,$2,$3,$4,$5,$6)', [cli, nome, padrao, termos, porVolume, ordem]);
  return { padrao, reaplicadas: await reaplicar(pool, cli) };
}

async function reaplicar(pool, cli) {
  const fs = compilar(await formatos(pool, cli));
  const abertas = (await pool.query("SELECT id::text FROM conf_sessoes WHERE client_id IS NOT DISTINCT FROM $1 AND status='aberta' AND criado_em > NOW() - INTERVAL '7 days'", [cli])).rows;
  let n = 0;
  for (const { id } of abertas) {
    for (const e of (await pool.query("SELECT ctrc,nomes FROM conf_esperado WHERE sessao_id=$1 AND parceiro=''", [id])).rows) {
      const p = parceiroDoCte(fs, [e.nomes]);
      if (p) await pool.query('UPDATE conf_esperado SET parceiro=$3 WHERE sessao_id=$1 AND ctrc=$2', [id, e.ctrc, p]);
    }
    // não reconhecidas que agora são etiqueta, e "sem CT-e" de parceiro que agora tem CT-e: lê de novo
    const comCte = new Set((await pool.query("SELECT DISTINCT parceiro FROM conf_esperado WHERE sessao_id=$1 AND parceiro<>''", [id])).rows.map(r => r.parceiro));
    for (const l of (await pool.query("SELECT id,codigo,usuario,situacao,parceiro FROM conf_leituras WHERE sessao_id=$1 AND situacao IN ('nao_reconhecido','sobra') AND desfeita_em IS NULL ORDER BY id", [id])).rows) {
      if (l.situacao === 'nao_reconhecido' ? classificar(fs, l.codigo).tipo !== 'volume' : !comCte.has(l.parceiro)) continue;
      await pool.query('UPDATE conf_leituras SET desfeita_em=NOW() WHERE id=$1', [l.id]);
      await ler(pool, cli, { username: l.usuario }, id, { codigo: l.codigo }, null);
      n++;
    }
  }
  return n;
}

// Ligar CT-e ao cliente da etiqueta: acrescenta um nome do CT-e (remetente, pagador...) aos termos do formato e
// refaz as conferências abertas (o CT-e ganha o parceiro e as leituras "sem CT-e" voltam a contar).
async function ligarNome(pool, cli, b) {
  const termo = semAcento(limpo(b.termo, 80)).replace(/[|,;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (termo.length < 3) throw erro(400, 'Escolha o nome do CT-e (remetente ou pagador).');
  const f = (await formatos(pool, cli)).find(x => x.nome === limpo(b.formato, 60));
  if (!f) throw erro(404, 'Etiqueta não cadastrada.');
  const termos = String(f.termos || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  if (!termos.map(semAcento).includes(termo)) termos.push(termo);
  await pool.query('UPDATE conf_formatos SET termos=$2 WHERE id=$1', [f.id, termos.join(', ').slice(0, 600)]);
  return { termos: termos.join(', '), reaplicadas: await reaplicar(pool, cli) };
}

// CT-e -> parceiro pelos nomes do relatório (remetente, pagador, tomador...)
function parceiroDoCte(fs, nomes) {
  const txt = semAcento((nomes || []).join(' | '));
  const f = fs.find(x => x.termosN.some(t => txt.includes(t)));
  return f ? f.nome : '';
}

// Código lido -> o que é. Chave de 44 dígitos: DACTE (modelo 57) ou DANFE (55).
function classificar(fs, bruto) {
  const codigo = String(bruto || '').replace(/[\s\r\n\t]+/g, '').toUpperCase().slice(0, 120);
  if (!codigo) return { codigo, tipo: 'vazio' };
  if (/^\d{44}$/.test(codigo)) {
    const modelo = codigo.slice(20, 22);
    if (modelo === '57') return { codigo, tipo: 'dacte' };
    if (modelo === '55') return { codigo, tipo: 'danfe', nf: codigo.slice(25, 34).replace(/^0+/, '') };
  }
  for (const cod of variantesCode39(codigo)) {
    const f = fs.find(x => x.re.test(cod));
    if (!f) continue;
    const nf = String(((f.re.exec(cod) || {}).groups || {}).nf || '').replace(/^0+/, '');
    return { codigo: cod, tipo: 'volume', parceiro: f.nome, por_volume: f.por_volume, ...(nf ? { nf } : {}) };
  }
  return { codigo, tipo: 'desconhecido' };
}
// Code 39 (etiqueta da Conasid): conforme a configuração, o coletor manda os asteriscos de início e fim e/ou o
// dígito verificador (módulo 43) no fim. Tenta o código como veio, sem os asteriscos e sem o verificador.
const C39 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
function variantesCode39(codigo) {
  const out = [codigo];
  const sem = codigo.replace(/^\*+|\*+$/g, '');
  if (sem && sem !== codigo) out.push(sem);
  if (sem.length > 4 && [...sem].every(c => C39.includes(c))) {
    const corpo = sem.slice(0, -1);
    if (C39[[...corpo].reduce((a, c) => a + C39.indexOf(c), 0) % 43] === sem.slice(-1)) out.push(corpo);
  }
  return out;
}

// ------------------------------------------------------------------ rotas do galpão
const SEM_ROTA = 'Sem rota';
const nomeCidade = v => semAcento(v).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const cidadesDe = txt => [...new Set(String(txt || '').split(/[,;\n]/).map(nomeCidade).filter(Boolean))];
// Relatório da opção 404 do SSW (ssw0004 "SETORES CADASTRADOS"): CIDADE UF CEP-INI CEP-FIN SET NOME-SETOR.
// Cada setor vira uma rota "Setor N · NOME" (o DACTE mostra o número). Número com mais de um nome junta os nomes.
function rotasDa404(texto) {
  const set = new Map();
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const m = linha.match(/^\s*(\S.*?)\s+([A-Z]{2})\s+(\d{8})\s+(\d{8})\s+(\d{1,4})\s+(.*?)\s*$/);
    if (!m) continue;
    const n = String(Number(m[5])), x = set.get(n) || { cidades: new Set(), nomes: new Map() };
    x.cidades.add(nomeCidade(m[1]));
    const nome = nomeCidade(m[6]) || n;
    x.nomes.set(nome, (x.nomes.get(nome) || 0) + 1);
    set.set(n, x);
  }
  const avisos = [];
  const rotas = [...set.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([n, x]) => {
    const nomes = [...x.nomes.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    if (nomes.length > 1) avisos.push('Setor ' + n + ' tem mais de um nome na 404: ' + nomes.join(', ') + '.');
    const rot = nomes.filter(x => x !== n).join(' / ');
    return { nome: ('Setor ' + n + (rot ? ' · ' + rot : '')).slice(0, 40), cidades: [...x.cidades] };
  });
  return { rotas, avisos };
}
const SETORES_PADRAO = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, 'conferencia-setores-404.txt'), 'utf8'); } catch { return ''; } })();
async function rotas(db, cli) {
  const n = (await db.query('SELECT COUNT(*)::int n FROM conf_rotas WHERE client_id IS NOT DISTINCT FROM $1', [cli])).rows[0].n;
  if (!n && SETORES_PADRAO) { try { await salvarRotas(db, cli, rotasDa404(SETORES_PADRAO).rotas); } catch (e) { console.log('CONFERENCIA setores 404: ' + e.message); } }
  return (await db.query('SELECT id::text,nome,cidades,ordem FROM conf_rotas WHERE client_id IS NOT DISTINCT FROM $1 ORDER BY ordem,id', [cli])).rows
    .map(r => ({ ...r, cidades: cidadesDe(r.cidades) }));
}
async function salvarRotas(db, cli, lista) {
  if (!Array.isArray(lista)) throw erro(400, 'Lista de rotas inválida.');
  const vistas = new Map();
  const ok = lista.slice(0, 80).map((r, i) => {
    const nome = limpo(r.nome, 40);
    if (!nome) throw erro(400, 'Cada rota precisa de um nome.');
    if (semAcento(nome) === semAcento(SEM_ROTA)) throw erro(400, '"' + SEM_ROTA + '" é reservado.');
    const cidades = cidadesDe(Array.isArray(r.cidades) ? r.cidades.join(',') : r.cidades);
    for (const c of cidades) { if (vistas.has(c) && vistas.get(c) !== nome) throw erro(400, c + ' está em duas rotas (' + vistas.get(c) + ' e ' + nome + ').'); vistas.set(c, nome); }
    return { nome, cidades: cidades.join(', '), ordem: i };
  });
  if (new Set(ok.map(r => semAcento(r.nome))).size !== ok.length) throw erro(400, 'Há duas rotas com o mesmo nome.');
  await db.query('DELETE FROM conf_rotas WHERE client_id IS NOT DISTINCT FROM $1', [cli]);
  for (const r of ok) await db.query('INSERT INTO conf_rotas(client_id,nome,cidades,ordem) VALUES($1,$2,$3,$4)', [cli, r.nome, r.cidades, r.ordem]);
}
// cidade do CT-e -> nome da rota ('Sem rota' quando nenhuma rota tem a cidade)
function rotaDaCidade(rs, cidade) {
  const c = nomeCidade(semAcento(cidade).replace(/\s*[-\/]\s*[A-Z]{2}$/, ''));
  const r = rs.find(x => x.cidades.includes(c));
  return r ? r.nome : SEM_ROTA;
}
// CT-es do galpão (conferência pai) que são da rota
async function esperadoDaRota(db, cli, paiId, nome) {
  const rs = await rotas(db, cli);
  const esp = (await db.query('SELECT ctrc,nf,volumes,chave,destinatario,cidade,parceiro,nomes,emitido_em,chave_parceiro FROM conf_esperado WHERE sessao_id=$1', [paiId])).rows;
  return esp.filter(e => rotaDaCidade(rs, e.cidade) === nome).map(e => ({ ...e, nomes: String(e.nomes || '').split(' | ').filter(Boolean) }));
}
// abre a rota dentro da conferência do galpão (ou entra na que já está aberta: vários conferentes na mesma rota)
async function abrirRota(pool, cli, user, paiId, nomeRota) {
  const pai = await sessao(pool, cli, paiId);
  if (pai.tipo !== 'contagem' || pai.pai_id) throw erro(400, 'Abra a rota dentro da conferência do galpão.');
  if (pai.status !== 'aberta') throw erro(409, 'A conferência do galpão já foi fechada.');
  const rs = await rotas(pool, cli);
  const nome = semAcento(nomeRota) === semAcento(SEM_ROTA) ? SEM_ROTA : (rs.find(r => semAcento(r.nome) === semAcento(nomeRota)) || {}).nome;
  if (!nome) throw erro(404, 'Rota não cadastrada.');
  const ja = await pool.query("SELECT id::text FROM conf_sessoes WHERE pai_id=$1 AND referencia=$2 AND status='aberta' ORDER BY id DESC LIMIT 1", [paiId, nome]);
  if (ja.rowCount) return { id: ja.rows[0].id, nova: false };
  const s = await pool.query("INSERT INTO conf_sessoes(client_id,tipo,titulo,criado_por,modo,referencia,pai_id) VALUES($1,'contagem',$2,$3,'rota',$4,$5) RETURNING id::text",
    [cli, pai.titulo + ' · ' + nome, limpo(user.username, 80), nome, paiId]);
  await carregarEsperado(pool, cli, s.rows[0].id, await esperadoDaRota(pool, cli, paiId, nome));
  return { id: s.rows[0].id, nova: true };
}
// quadro das rotas na conferência do galpão: o que o SSW tem em cada rota e como está a contagem
async function quadroRotas(db, cli, paiId) {
  const pai = await sessao(db, cli, paiId);
  const rs = await rotas(db, cli);
  const esp = (await db.query('SELECT volumes,cidade FROM conf_esperado WHERE sessao_id=$1', [paiId])).rows;
  const filhas = (await db.query('SELECT id::text,referencia,status,criado_por FROM conf_sessoes WHERE pai_id=$1 ORDER BY id', [paiId])).rows;
  const nomes = rs.map(r => r.nome).concat([SEM_ROTA]);
  const out = [];
  for (const nome of nomes) {
    const meus = esp.filter(e => rotaDaCidade(rs, e.cidade) === nome);
    const fs = filhas.filter(f => f.referencia === nome);
    const f = fs.find(x => x.status === 'aberta') || fs[fs.length - 1];
    let r = null;
    if (f) { const x = await resumo(db, cli, f.id); r = { ...x.totais, nao_reconhecidos: x.nao_reconhecidos, rota_errada: x.rota_errada }; }
    if (!meus.length && !f && nome === SEM_ROTA) continue;
    out.push({ rota: nome, cidades: nome === SEM_ROTA ? [...new Set(meus.map(e => semAcento(e.cidade)).filter(Boolean))] : rs.find(x => x.nome === nome).cidades,
      ctes: meus.length, volumes: meus.reduce((a, e) => a + e.volumes, 0), sessao: f ? { id: f.id, status: f.status, criado_por: f.criado_por } : null, contagem: r });
  }
  return { pai: { id: String(pai.id), titulo: pai.titulo, status: pai.status }, rotas: out };
}

// ------------------------------------------------------------------ janela da descarga
// data = dia da descarga (Brasília). Padrão: 19:00 da véspera até 04:00 do dia.
function janelaDescarga(data, horaIni = '19:00', horaFim = '04:00') {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? data : hojeSp();
  const vesp = new Date(new Date(d + 'T12:00:00-03:00').getTime() - 86400000).toISOString().slice(0, 10);
  return { inicio: new Date(vesp + 'T' + horaIni + ':00-03:00'), fim: new Date(d + 'T' + horaFim + ':00-03:00'), data: d };
}
function hojeSp(d = new Date()) { return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }

// ------------------------------------------------------------------ sessões
async function carregarEsperado(pool, cli, sessaoId, rows, { acrescentar = false } = {}) {
  const fs = compilar(await formatos(pool, cli));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (!acrescentar) await db.query('DELETE FROM conf_esperado WHERE sessao_id=$1', [sessaoId]);
    for (const r of rows || []) {
      const ctrc = limpo(r.ctrc, 20).toUpperCase();
      if (!ctrc) continue;
      const cp = [r.chave_parceiro, ...(Array.isArray(r.ctes_parceiro) ? r.ctes_parceiro : [])].map(c => String(c || '').replace(/\D/g, '')).filter(c => c.length === 44);
      await db.query(`INSERT INTO conf_esperado(sessao_id,ctrc,nf,volumes,chave,destinatario,cidade,parceiro,nomes,emitido_em,chave_parceiro)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (sessao_id,ctrc) DO UPDATE SET chave_parceiro=CASE WHEN conf_esperado.chave_parceiro='' THEN EXCLUDED.chave_parceiro ELSE conf_esperado.chave_parceiro END`,
        [sessaoId, ctrc, limpo(r.nf, 20), Math.max(0, Math.round(Number(r.volumes) || 0)), String(r.chave || '').replace(/\D/g, '').slice(0, 44),
          limpo(r.destinatario, 80), limpo(r.cidade, 60), parceiroDoCte(fs, r.nomes), (r.nomes || []).map(x => limpo(x, 80)).join(' | ').slice(0, 600), r.emitido_em || null, cp[0] || '']);
    }
    await db.query('UPDATE conf_sessoes SET carregado_em=NOW() WHERE id=$1', [sessaoId]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}

// lerSsw(rota, corpo): rotas /api/conferencia/<rota> do painel (ssw-esperado, ssw-romaneio, ssw-ctes, ssw-romaneios)
async function criarSessao(pool, cli, user, b, lerSsw) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'descarga';
  const teste = Array.isArray(b.rows) && b.testMode;   // testes: carga esperada informada
  const semSsw = () => erro(503, 'A leitura do SSW não está disponível neste servidor.');
  let rows = [], fontes = [], titulo, ini = null, fim = null, modo = '', referencia = '';
  let dia = null;
  if (tipo === 'contagem') {
    dia = b.testMode && /^\d{4}-\d{2}-\d{2}$/.test(String(b.dia || '')) ? b.dia : hojeSp();
    const ja = await contagemDoDia(pool, cli, dia);
    if (ja) return { id: ja, fontes: [], existente: true };
    titulo = 'Galpão ' + dia.split('-').reverse().slice(0, 2).join('/') + ' · ' + new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    if (teste) rows = b.rows;
    else { if (!lerSsw) throw semSsw(); const r = await lerSsw('ssw-galpao', {}); rows = r.rows || []; fontes = r.fontes || []; }
  } else if (tipo === 'descarga') {
    const j = janelaDescarga(b.data, /^\d{2}:\d{2}$/.test(b.hora_inicio || '') ? b.hora_inicio : '19:00', /^\d{2}:\d{2}$/.test(b.hora_fim || '') ? b.hora_fim : '04:00');
    ini = j.inicio; fim = j.fim; titulo = 'Descarga ' + j.data.split('-').reverse().join('/');
    if (teste) rows = b.rows;
    else { if (!lerSsw) throw semSsw(); const r = await lerSsw('ssw-esperado', { inicio: ini.toISOString(), fim: fim.toISOString() }); rows = r.rows || []; fontes = r.fontes || []; }
  } else {
    modo = b.modo === 'ctes' ? 'ctes' : 'romaneio';
    const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (modo === 'romaneio') {
      referencia = limpo(b.romaneio, 20).toUpperCase();
      if (!/^[A-Z]{3}\d+-\d$/.test(referencia)) throw erro(400, 'Escolha o romaneio (ex.: AMR001186-0).');
      let placa = limpo(b.placa, 10).toUpperCase(), motorista = limpo(b.motorista, 60);
      if (teste) rows = b.rows;
      else { if (!lerSsw) throw semSsw(); const r = await lerSsw('ssw-romaneio', { romaneio: referencia, ctes: Number(b.ctes) || 0 }); rows = r.rows || []; fontes = r.fontes || []; placa = placa || limpo(r.placa, 10); }
      if (!rows.length) throw erro(404, 'O SSW não devolveu nenhum CT-e para o romaneio ' + referencia + '.');
      titulo = 'Carregamento ' + referencia + (placa ? ' · ' + placa : '') + (motorista ? ' · ' + motorista.split(' ')[0] : '');
    } else {
      referencia = limpo(b.placa, 10).toUpperCase();
      titulo = 'Carregamento ' + (referencia ? referencia + ' · ' : '') + quando;
      if (teste) rows = b.rows;
    }
  }
  let id;
  if (tipo === 'contagem') {   // a leitura do SSW leva até 2 min: dois conferentes ao mesmo tempo não criam duas contagens
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['conf-galpao-' + (cli || '') + '-' + dia]);
      const ja = await contagemDoDia(db, cli, dia);
      if (ja) { await db.query('COMMIT'); return { id: ja, fontes, existente: true }; }
      id = (await db.query("INSERT INTO conf_sessoes(client_id,tipo,titulo,criado_por,dia) VALUES($1,'contagem',$2,$3,$4) RETURNING id::text", [cli, titulo, limpo(user.username, 80), dia])).rows[0].id;
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
  } else {
    id = (await pool.query('INSERT INTO conf_sessoes(client_id,tipo,titulo,janela_ini,janela_fim,criado_por,modo,referencia) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text',
      [cli, tipo, titulo, ini, fim, limpo(user.username, 80), modo, referencia])).rows[0].id;
  }
  await carregarEsperado(pool, cli, id, rows);
  return { id, fontes };
}
// coluna DATE: o pg devolve meia-noite no fuso do servidor
const diaDe = s => { const d = s.dia; if (d instanceof Date) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); return d ? String(d).slice(0, 10) : hojeSp(new Date(s.criado_em)); };
// contagem do galpão do dia (as de antes da coluna dia contam pela data de criação)
async function contagemDoDia(db, cli, dia) {
  const q = await db.query(`SELECT id::text FROM conf_sessoes WHERE client_id IS NOT DISTINCT FROM $1 AND tipo='contagem' AND pai_id IS NULL
    AND (dia=$2::date OR (dia IS NULL AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date=$2::date)) ORDER BY (status='aberta') DESC, id DESC LIMIT 1`, [cli, dia]);
  return q.rowCount ? q.rows[0].id : null;
}

async function recarregar(pool, cli, id, lerSsw, b = {}) {
  const s = await sessao(pool, cli, id);
  if (s.status !== 'aberta') throw erro(409, 'Conferência já fechada.');
  let rows;
  if (s.pai_id) {   // rota do galpão: atualiza o galpão inteiro e separa a rota de novo
    const pai = await sessao(pool, cli, s.pai_id);
    if (pai.status === 'aberta') await recarregar(pool, cli, String(pai.id), lerSsw, b);
    rows = await esperadoDaRota(pool, cli, String(pai.id), s.referencia);
  } else if (Array.isArray(b.rows) && b.testMode) rows = b.rows;
  else if (!lerSsw) throw erro(503, 'A leitura do SSW não está disponível neste servidor.');
  else if (s.tipo === 'contagem') rows = (await lerSsw('ssw-galpao', {})).rows || [];
  else if (s.tipo === 'descarga') rows = (await lerSsw('ssw-esperado', { inicio: new Date(s.janela_ini).toISOString(), fim: new Date(s.janela_fim).toISOString() })).rows || [];
  else if (s.modo === 'romaneio') rows = (await lerSsw('ssw-romaneio', { romaneio: s.referencia })).rows || [];
  else {
    const chaves = (await pool.query("SELECT CASE WHEN chave<>'' THEN chave ELSE chave_parceiro END AS chave FROM conf_esperado WHERE sessao_id=$1 AND (chave<>'' OR chave_parceiro<>'')", [id])).rows.map(r => r.chave);
    rows = chaves.length ? (await lerSsw('ssw-ctes', { chaves })).rows || [] : [];
  }
  // guarda os DACTEs já lidos
  const lidos = (await pool.query('SELECT ctrc,dacte_lido_em FROM conf_esperado WHERE sessao_id=$1 AND dacte_lido_em IS NOT NULL', [id])).rows;
  await carregarEsperado(pool, cli, id, rows);
  for (const l of lidos) await pool.query('UPDATE conf_esperado SET dacte_lido_em=$3 WHERE sessao_id=$1 AND ctrc=$2', [id, l.ctrc, l.dacte_lido_em]);
}

// carregamento montado pelos DACTEs: tira um CT-e bipado por engano
async function tirarCte(pool, cli, id, ctrc) {
  const s = await sessao(pool, cli, id);
  if (s.status !== 'aberta') throw erro(409, 'Conferência já fechada.');
  if (s.tipo !== 'carregamento') throw erro(400, 'Só no carregamento dá para tirar um CT-e da carga.');
  const q = await pool.query('DELETE FROM conf_esperado WHERE sessao_id=$1 AND ctrc=$2', [id, limpo(ctrc, 20).toUpperCase()]);
  if (!q.rowCount) throw erro(404, 'CT-e não está nesta carga.');
}

async function sessao(db, cli, id) {
  if (!/^\d+$/.test(String(id))) throw erro(404, 'Conferência não encontrada.');
  const q = await db.query('SELECT * FROM conf_sessoes WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2', [id, cli]);
  if (!q.rowCount) throw erro(404, 'Conferência não encontrada.');
  return q.rows[0];
}

// Resumo por parceiro: esperado (volumes dos CT-es), lidos, faltam, a mais, repetidos.
async function resumo(db, cli, id) {
  const s = await sessao(db, cli, id);
  const esp = (await db.query('SELECT ctrc,nf,volumes,chave,destinatario,cidade,parceiro,nomes,emitido_em,dacte_lido_em FROM conf_esperado WHERE sessao_id=$1 ORDER BY parceiro,ctrc', [id])).rows;
  const lei = (await db.query(`SELECT parceiro,situacao,COUNT(*)::int AS n FROM conf_leituras WHERE sessao_id=$1 AND desfeita_em IS NULL GROUP BY parceiro,situacao`, [id])).rows;
  const fs = await formatos(db, cli);
  const nomes = [...new Set(fs.filter(f => f.ativo).map(f => f.nome).concat(esp.map(e => e.parceiro).filter(Boolean)).concat(lei.map(l => l.parceiro).filter(Boolean)))];
  const conta = (p, sit) => lei.filter(l => l.parceiro === p && (!sit || sit.includes(l.situacao))).reduce((a, l) => a + l.n, 0);
  const parceiros = nomes.map(p => {
    const ctes = esp.filter(e => e.parceiro === p), esperado = ctes.reduce((a, e) => a + e.volumes, 0);
    const lidos = conta(p, ['ok']), excesso = conta(p, ['excesso', 'sobra', 'nf_fora', 'rota_errada']), repetidos = conta(p, ['duplicado']);
    return { parceiro: p, ctes: ctes.length, esperado, lidos, faltam: Math.max(0, esperado - lidos), excesso, repetidos, completo: esperado > 0 && lidos >= esperado };
  }).filter(p => p.ctes || p.lidos || p.excesso || p.repetidos);
  const outros = esp.filter(e => !e.parceiro);
  const t = k => parceiros.reduce((a, p) => a + p[k], 0);
  return {
    sessao: { id: String(s.id), pai_id: s.pai_id ? String(s.pai_id) : null, tipo: s.tipo, modo: s.modo || '', referencia: s.referencia || '', titulo: s.titulo, status: s.status, janela_ini: s.janela_ini, janela_fim: s.janela_fim, criado_por: s.criado_por, criado_em: s.criado_em, carregado_em: s.carregado_em, fechada_em: s.fechada_em, fechada_por: s.fechada_por, observacao: s.observacao || '', motorista_link_em: s.motorista_link_em || null, motorista_terminou_em: s.motorista_terminou_em || null },
    parceiros,
    outros: { ctes: outros.length, volumes: outros.reduce((a, e) => a + e.volumes, 0) },
    nao_reconhecidos: conta('', ['nao_reconhecido']),
    rota_errada: lei.filter(l => l.situacao === 'rota_errada').reduce((a, l) => a + l.n, 0),
    totais: { esperado: t('esperado'), lidos: t('lidos'), faltam: t('faltam'), excesso: t('excesso'), repetidos: t('repetidos') },
    esperado: esp,
  };
}

// Uma leitura. Uma de cada vez por conferência (vários coletores na mesma carga não estouram a contagem).
async function ler(pool, cli, user, id, b, lerSsw) {
  // carregamento: DACTE que ainda não está na carga é lido no SSW antes (fora da trava, pode levar alguns segundos)
  let novoCte = null;
  {
    const s0 = await sessao(pool, cli, id);
    const bruto = String(b.codigo || '').replace(/[\s\r\n\t]+/g, '');
    if (!b.motorista && s0.tipo === 'carregamento' && s0.status === 'aberta' && /^\d{44}$/.test(bruto) && bruto.slice(20, 22) === '57') {
      const tem = (await pool.query('SELECT 1 FROM conf_esperado WHERE sessao_id=$1 AND (chave=$2 OR chave_parceiro=$2)', [id, bruto])).rowCount;
      if (!tem) {
        if (b.testMode && b.cte_teste) novoCte = b.cte_teste.chave ? { ...b.cte_teste, chave_parceiro: bruto } : { ...b.cte_teste, chave: bruto };
        else if (lerSsw) { const r = await lerSsw('ssw-ctes', { chaves: [bruto] }); novoCte = (r.rows || [])[0] || null; }
        if (novoCte) {
          const ja = (await pool.query('SELECT 1 FROM conf_esperado WHERE sessao_id=$1 AND ctrc=$2', [id, limpo(novoCte.ctrc, 20).toUpperCase()])).rowCount;
          if (!ja) await carregarEsperado(pool, cli, id, [novoCte], { acrescentar: true });
          else if (novoCte.chave_parceiro) await pool.query("UPDATE conf_esperado SET chave_parceiro=$3 WHERE sessao_id=$1 AND ctrc=$2", [id, limpo(novoCte.ctrc, 20).toUpperCase(), bruto]);
          else await pool.query("UPDATE conf_esperado SET chave=$3 WHERE sessao_id=$1 AND ctrc=$2 AND chave=''", [id, limpo(novoCte.ctrc, 20).toUpperCase(), bruto]);
        }
      }
    }
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['conf-' + id]);
    const s = await sessao(db, cli, id);
    if (s.status !== 'aberta') throw erro(409, 'Esta conferência já foi fechada.', 'FECHADA');
    const uuid = b.uuid ? limpo(b.uuid, 60) : null;
    if (uuid) {
      const ja = await db.query('SELECT situacao,parceiro,ctrc,codigo FROM conf_leituras WHERE sessao_id=$1 AND uuid=$2', [id, uuid]);
      if (ja.rowCount) { await db.query('COMMIT'); return { ...ja.rows[0], repetida_envio: true, ...(await mensagem(db, cli, id, { ...ja.rows[0], tipo: s.tipo })) }; }
    }
    const fs = compilar(await formatos(db, cli));
    const c = classificar(fs, b.codigo);
    if (c.tipo === 'vazio') throw erro(400, 'Código vazio.');
    let situacao = 'nao_reconhecido', parceiro = '', ctrc = '';
    if (c.tipo === 'dacte') {
      const e = (await db.query('SELECT ctrc,parceiro FROM conf_esperado WHERE sessao_id=$1 AND (chave=$2 OR chave_parceiro=$2) ORDER BY (chave=$2) DESC LIMIT 1', [id, c.codigo])).rows[0];
      if (e) { situacao = novoCte ? 'cte_adicionado' : 'dacte'; ctrc = e.ctrc; parceiro = e.parceiro; await db.query('UPDATE conf_esperado SET dacte_lido_em=COALESCE(dacte_lido_em,NOW()) WHERE sessao_id=$1 AND ctrc=$2', [id, e.ctrc]); }
      else situacao = b.motorista ? 'dacte_fora' : s.tipo === 'carregamento' ? 'cte_nao_achado' : 'dacte_parceiro';   // descarga: DACTE de outra transportadora (ex.: Transbarbosa) fica registrado
    } else if (c.tipo === 'danfe') {
      const e = (await db.query("SELECT ctrc,parceiro FROM conf_esperado WHERE sessao_id=$1 AND ltrim(nf,'0')=$2 LIMIT 1", [id, c.nf])).rows[0];
      situacao = e ? 'danfe' : 'danfe_fora'; if (e) { ctrc = e.ctrc; parceiro = e.parceiro; }
    }
    // rota do galpão: DACTE, DANFE ou etiqueta com NF de um CT-e que o galpão tem em outra rota
    let outraRota = '';
    if (s.pai_id && ['dacte_parceiro', 'danfe_fora'].includes(situacao) || s.pai_id && c.tipo === 'volume' && c.nf) {
      const ja = c.tipo === 'volume' && (await db.query("SELECT 1 FROM conf_esperado WHERE sessao_id=$1 AND ltrim(nf,'0')=$2", [id, c.nf])).rowCount;
      if (!ja) {
        const e = (await db.query("SELECT ctrc,parceiro,cidade FROM conf_esperado WHERE sessao_id=$1 AND (chave=$2 OR chave_parceiro=$2 OR ltrim(nf,'0')=$3) LIMIT 1", [s.pai_id, c.codigo, c.nf || '-'])).rows[0];
        if (e) { outraRota = rotaDaCidade(await rotas(db, cli), e.cidade); situacao = 'rota_errada'; ctrc = e.ctrc; parceiro = c.parceiro || e.parceiro; }
      }
    }
    if (situacao === 'rota_errada') { /* já resolvido */ }
    else if (c.tipo === 'volume' && c.nf && (s.tipo === 'carregamento' || s.pai_id) && !(await db.query("SELECT 1 FROM conf_esperado WHERE sessao_id=$1 AND ltrim(nf,'0')=$2", [id, c.nf])).rowCount) {
      parceiro = c.parceiro; situacao = 'nf_fora';   // etiqueta com NF de nota que não está nesta carga/rota
    } else if (c.tipo === 'volume') {
      parceiro = c.parceiro;
      const esperado = Number((await db.query('SELECT COALESCE(SUM(volumes),0)::int AS v FROM conf_esperado WHERE sessao_id=$1 AND parceiro=$2', [id, parceiro])).rows[0].v);
      const lidos = Number((await db.query("SELECT COUNT(*)::int AS n FROM conf_leituras WHERE sessao_id=$1 AND parceiro=$2 AND situacao='ok' AND desfeita_em IS NULL", [id, parceiro])).rows[0].n);
      const repetido = c.por_volume && (await db.query("SELECT 1 FROM conf_leituras WHERE sessao_id=$1 AND codigo=$2 AND situacao IN ('ok','excesso','sobra') AND desfeita_em IS NULL LIMIT 1", [id, c.codigo])).rowCount;
      if (repetido) situacao = 'duplicado';
      else if (!esperado) situacao = 'sobra';          // parceiro sem nenhum CT-e nesta carga
      else if (lidos >= esperado) situacao = 'excesso'; // mais volumes do que os CT-es dizem
      else situacao = 'ok';
    }
    const ins = await db.query('INSERT INTO conf_leituras(sessao_id,uuid,codigo,tipo,parceiro,ctrc,situacao,usuario) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text',
      [id, uuid, c.codigo, c.tipo, parceiro, ctrc, situacao, limpo(user.username, 80)]);
    const out = { id: ins.rows[0].id, codigo: c.codigo, tipo: c.tipo, parceiro, ctrc, situacao, ...(outraRota ? { rota_certa: outraRota } : {}), ...(await mensagem(db, cli, id, { situacao, parceiro, ctrc, codigo: c.codigo, tipo: s.tipo, outraRota, nf: c.nf, pai: !!s.pai_id })) };
    await db.query('COMMIT');
    return out;
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}
async function mensagem(db, cli, id, l) {
  const r = l.parceiro ? (await resumo(db, cli, id)).parceiros.find(p => p.parceiro === l.parceiro) : null;
  const prog = r ? r.lidos + ' de ' + r.esperado : '';
  const carg = l.tipo === 'carregamento', onde = l.pai ? 'nesta rota' : l.tipo === 'contagem' ? 'no galpão (SSW)' : 'nesta carga';
  const cte = l.ctrc ? (await db.query('SELECT volumes,parceiro,cidade FROM conf_esperado WHERE sessao_id=$1 AND ctrc=$2', [id, l.ctrc])).rows[0]
    || (l.situacao === 'rota_errada' ? (await db.query('SELECT e.volumes,e.parceiro,e.cidade FROM conf_esperado e JOIN conf_sessoes s ON s.pai_id=e.sessao_id WHERE s.id=$1 AND e.ctrc=$2', [id, l.ctrc])).rows[0] : null) : null;
  const M = {
    cte_adicionado: ['info', 'CT-e ' + l.ctrc + ' na carga' + (cte ? ' · ' + cte.volumes + ' volume(s)' + (cte.parceiro ? ' · ' + cte.parceiro : ' · sem etiqueta reconhecida') : '')],
    cte_nao_achado: ['erro', 'CT-e deste DACTE não encontrado no SSW'],
    dacte_fora: ['erro', 'NÃO CARREGAR · este DACTE não é desta carga'],
    ok: [r && r.completo ? 'ok_completo' : 'ok', l.parceiro + ': ' + prog + (r && r.completo ? ' ✓ completo' : '')],
    duplicado: ['alerta', 'Volume já bipado (' + l.parceiro + ')'],
    excesso: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + 'A mais: ' + l.parceiro + ' já tem ' + prog + ' volumes'],
    sobra: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + l.parceiro + ' não tem CT-e ' + onde + (carg ? '' : ' · veja "CT-es sem etiqueta reconhecida"')],
    rota_errada: ['erro', 'ROTA ERRADA · ' + (l.parceiro ? l.parceiro + ' ' : '') + (/^setor\b/i.test(l.outraRota || '') ? 'é do ' + l.outraRota : /^rota\b/i.test(l.outraRota || '') ? 'é da ' + l.outraRota : 'é da rota ' + (l.outraRota || '?')) + (cte && cte.cidade ? ' (' + cte.cidade + ')' : '')],
    nf_fora: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + 'NF ' + (l.nf || '') + ' (' + l.parceiro + ') não está ' + onde],
    nao_reconhecido: ['erro', (carg ? 'NÃO CARREGAR · ' : '') + 'Etiqueta não reconhecida'],
    dacte: ['info', 'DACTE ' + l.ctrc + ' conferido'],
    dacte_parceiro: ['info', 'DACTE de outra transportadora registrado'],
    danfe: ['info', 'DANFE do CT-e ' + l.ctrc],
    danfe_fora: ['alerta', 'DANFE de nota que não está ' + onde],
  }[l.situacao] || ['info', l.situacao];
  return { sinal: M[0], mensagem: M[1], progresso: r || null };
}

async function desfazer(pool, cli, user, id, leituraId) {
  const s = await sessao(pool, cli, id);
  if (s.status !== 'aberta') throw erro(409, 'Esta conferência já foi fechada.');
  const q = await pool.query('UPDATE conf_leituras SET desfeita_em=NOW() WHERE id=$1 AND sessao_id=$2 AND desfeita_em IS NULL RETURNING id', [leituraId, id]);
  if (!q.rowCount) throw erro(404, 'Leitura não encontrada.');
}

async function leituras(db, cli, id, limite = 60) {
  await sessao(db, cli, id);
  return (await db.query(`SELECT id::text,codigo,tipo,parceiro,ctrc,situacao,usuario,criado_em FROM conf_leituras WHERE sessao_id=$1 AND desfeita_em IS NULL ORDER BY id DESC LIMIT $2`, [id, limite])).rows;
}

async function fechar(pool, cli, user, id, obs) {
  const q = await pool.query("UPDATE conf_sessoes SET status='fechada',fechada_em=NOW(),fechada_por=$3,observacao=$4 WHERE id=$1 AND client_id IS NOT DISTINCT FROM $2 AND status='aberta' RETURNING id",
    [id, cli, limpo(user.username, 80), limpo(obs, 1000) || null]);
  if (!q.rowCount) throw erro(409, 'Conferência não encontrada ou já fechada.');
}

async function listar(db, cli, tipo) {
  return (await db.query(`SELECT s.id::text,s.tipo,s.modo,s.referencia,s.titulo,s.status,s.criado_por,s.criado_em,s.fechada_em,s.dia::text AS dia,
      (SELECT COALESCE(SUM(volumes),0)::int FROM conf_esperado e WHERE e.sessao_id=s.id) AS esperado,
      (SELECT COUNT(*)::int FROM conf_leituras l WHERE l.sessao_id=s.id AND l.situacao='ok' AND l.desfeita_em IS NULL) AS lidos
    FROM conf_sessoes s WHERE s.client_id IS NOT DISTINCT FROM $1 AND s.pai_id IS NULL AND ($2::text IS NULL OR s.tipo=$2) ORDER BY s.id DESC LIMIT 60`, [cli, TIPOS.includes(tipo) ? tipo : null])).rows;
}

// ------------------------------------------------------------------ relatório do galpão
// Por rota: o que o SSW tem, o que foi bipado, o que falta e o que sobra. CT-e só aparece quando foi achado em rota errada.
async function relatorioGalpao(db, cli, id) {
  let pai = await sessao(db, cli, id);
  if (pai.pai_id) pai = await sessao(db, cli, pai.pai_id);
  if (pai.tipo !== 'contagem') throw erro(400, 'O relatório é da conferência do galpão.');
  const paiId = String(pai.id);
  const q = await quadroRotas(db, cli, paiId);
  const filhas = (await db.query('SELECT id::text,referencia FROM conf_sessoes WHERE pai_id=$1', [paiId])).rows;
  const ids = filhas.map(f => f.id);
  const quem = ids.length ? (await db.query(`SELECT s.referencia, string_agg(DISTINCT l.usuario, ', ') AS u FROM conf_leituras l JOIN conf_sessoes s ON s.id=l.sessao_id
    WHERE l.sessao_id = ANY($1::bigint[]) AND l.desfeita_em IS NULL GROUP BY s.referencia`, [ids])).rows : [];
  const rotasR = q.rotas.map(r => {
    const c = r.contagem || {};
    return { rota: r.rota, ctes: r.ctes, volumes_ssw: r.volumes, situacao: !r.sessao ? 'nao_conferida' : r.sessao.status === 'aberta' ? 'em_andamento' : 'fechada',
      bipados: c.lidos || 0, faltam: r.sessao ? (c.faltam || 0) : r.volumes, a_mais: c.excesso || 0, rota_errada: c.rota_errada || 0,
      nao_reconhecidos: c.nao_reconhecidos || 0, conferentes: ((quem.find(x => x.referencia === r.rota) || {}).u) || '' };
  });
  const erradas = ids.length ? (await db.query(`SELECT l.ctrc, s.referencia AS achada_em, COUNT(*)::int AS volumes, MIN(l.criado_em) AS quando,
      string_agg(DISTINCT l.usuario, ', ') AS usuario, MAX(l.parceiro) AS parceiro
    FROM conf_leituras l JOIN conf_sessoes s ON s.id=l.sessao_id
    WHERE l.sessao_id = ANY($1::bigint[]) AND l.situacao='rota_errada' AND l.desfeita_em IS NULL AND l.ctrc<>''
    GROUP BY l.ctrc, s.referencia ORDER BY s.referencia, l.ctrc`, [ids])).rows : [];
  const rs = await rotas(db, cli);
  const esp = new Map((await db.query('SELECT ctrc,nf,volumes,destinatario,cidade,parceiro FROM conf_esperado WHERE sessao_id=$1', [paiId])).rows.map(e => [e.ctrc, e]));
  const rotaErrada = erradas.map(x => { const e = esp.get(x.ctrc) || {};
    return { ctrc: x.ctrc, nf: e.nf || '', parceiro: x.parceiro || e.parceiro || '', destinatario: e.destinatario || '', cidade: e.cidade || '',
      volumes_cte: e.volumes || 0, achada_em: x.achada_em, rota_certa: rotaDaCidade(rs, e.cidade || ''), volumes: x.volumes, quando: x.quando, usuario: x.usuario || '' }; });
  const t = k => rotasR.reduce((a, r) => a + (r[k] || 0), 0);
  return { galpao: { id: paiId, titulo: pai.titulo, dia: diaDe(pai), status: pai.status, criado_por: pai.criado_por, criado_em: pai.criado_em, fechada_em: pai.fechada_em, carregado_em: pai.carregado_em },
    totais: { ctes: t('ctes'), volumes_ssw: t('volumes_ssw'), bipados: t('bipados'), faltam: t('faltam'), a_mais: t('a_mais'), rota_errada: t('rota_errada'), nao_reconhecidos: t('nao_reconhecidos'),
      rotas: rotasR.length, conferidas: rotasR.filter(r => r.situacao !== 'nao_conferida').length },
    rotas: rotasR, rota_errada: rotaErrada };
}

// Consulta de nota: na última contagem do galpão (até 7 dias) em que a NF estava, alguma caixa dela foi achada em outra rota?
async function alertasNf(db, cli, nfBruta) {
  const nf = String(nfBruta || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!nf) throw erro(400, 'Informe o número da nota.');
  const re = '(^|[^0-9])0*' + nf + '([^0-9]|$)';
  const g = (await db.query(`SELECT s.id::text, s.titulo, s.dia, s.criado_em, e.ctrc, e.nf, e.cidade, e.parceiro, e.destinatario, e.volumes
    FROM conf_esperado e JOIN conf_sessoes s ON s.id=e.sessao_id
    WHERE s.client_id IS NOT DISTINCT FROM $1 AND s.tipo='contagem' AND s.pai_id IS NULL AND s.criado_em > NOW() - INTERVAL '7 days' AND e.nf ~ $2
    ORDER BY s.id DESC`, [cli, re])).rows;
  if (!g.length) return { nf, galpao: null, alertas: [] };
  const ultimo = g[0].id, ctes = g.filter(x => x.id === ultimo);
  const rs = await rotas(db, cli);
  const lei = (await db.query(`SELECT l.ctrc, s.referencia AS achada_em, COUNT(*)::int AS volumes, MAX(l.criado_em) AS quando, string_agg(DISTINCT l.usuario, ', ') AS usuario
    FROM conf_leituras l JOIN conf_sessoes s ON s.id=l.sessao_id
    WHERE s.pai_id=$1 AND l.situacao='rota_errada' AND l.desfeita_em IS NULL AND l.ctrc = ANY($2::text[]) GROUP BY l.ctrc, s.referencia`, [ultimo, ctes.map(c => c.ctrc)])).rows;
  const alertas = lei.map(l => { const e = ctes.find(c => c.ctrc === l.ctrc) || {}; const certa = rotaDaCidade(rs, e.cidade || '');
    return { nf, ctrc: l.ctrc, parceiro: e.parceiro || '', destinatario: e.destinatario || '', cidade: e.cidade || '', rota_certa: certa, achada_em: l.achada_em,
      volumes: l.volumes, volumes_cte: e.volumes || 0, quando: l.quando, usuario: l.usuario || '',
      mensagem: 'Mercadoria fora da rota: ' + l.volumes + ' volume(s) da NF ' + nf + ' (CT-e ' + l.ctrc + ') foram achados em ' + l.achada_em + ', mas a nota é de ' + certa + (e.cidade ? ' (' + e.cidade + ')' : '') + '.' }; });
  return { nf, galpao: { id: ultimo, titulo: g[0].titulo, dia: diaDe(g[0]) }, alertas };
}

// ------------------------------------------------------------------ link do motorista
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
async function gerarLinkMotorista(pool, cli, id, base) {
  const s = await sessao(pool, cli, id);
  if (s.tipo !== 'carregamento') throw erro(400, 'O link do motorista é só para carregamento.');
  if (s.status !== 'aberta') throw erro(409, 'Conferência já fechada.');
  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query('UPDATE conf_sessoes SET motorista_token_hash=$2,motorista_link_em=NOW(),motorista_terminou_em=NULL WHERE id=$1', [id, hashToken(token)]);
  const link = String(base || '').replace(/\/+$/, '') + '/conferencia/m/' + token;
  const texto = 'Conferência do carregamento ' + (s.referencia || '') + '\n' + s.titulo + '\n\nAbra o link e bipe cada caixa que for colocar no caminhão:\n' + link;
  return { link, whatsapp: 'https://wa.me/?text=' + encodeURIComponent(texto) };
}
async function revogarLinkMotorista(pool, cli, id) {
  await sessao(pool, cli, id);
  await pool.query('UPDATE conf_sessoes SET motorista_token_hash=NULL WHERE id=$1', [id]);
}
// token -> conferência (aberta, link com menos de 24 h)
async function sessaoDoMotorista(pool, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) throw erro(404, 'Link inválido.');
  const q = await pool.query('SELECT * FROM conf_sessoes WHERE motorista_token_hash=$1', [hashToken(token)]);
  if (!q.rowCount) throw erro(404, 'Link inválido ou trocado. Peça um novo link ao conferente.');
  const s = q.rows[0];
  if (s.status !== 'aberta') throw erro(410, 'Esta conferência já foi encerrada.');
  if (s.motorista_link_em && Date.now() - new Date(s.motorista_link_em).getTime() > 24 * 3600 * 1000) throw erro(410, 'Link vencido. Peça um novo link ao conferente.');
  return s;
}
// o que o motorista vê: progresso por parceiro e as próprias leituras (sem dados de outras cargas)
async function resumoMotorista(pool, s) {
  const cli = s.client_id === null ? null : String(s.client_id);
  const r = await resumo(pool, cli, String(s.id));
  const lei = (await pool.query("SELECT codigo,parceiro,situacao,criado_em FROM conf_leituras WHERE sessao_id=$1 AND desfeita_em IS NULL ORDER BY id DESC LIMIT 15", [s.id])).rows;
  return { sessao: { titulo: r.sessao.titulo, referencia: r.sessao.referencia, status: r.sessao.status, terminou_em: s.motorista_terminou_em || null },
    parceiros: r.parceiros, totais: r.totais, nao_reconhecidos: r.nao_reconhecidos, ctes: r.esperado.length, leituras: lei };
}
const LIMITE_MOT = new Map();
function motoristaPermitido(token) {
  const now = Date.now(), k = String(token).slice(0, 16), row = LIMITE_MOT.get(k) || { at: now, n: 0 };
  if (now - row.at > 60000) { row.at = now; row.n = 0; }
  row.n++; LIMITE_MOT.set(k, row); if (LIMITE_MOT.size > 5000) LIMITE_MOT.clear();
  return row.n <= 240;
}
// rotas sem login: página /conferencia/m/<token> e /api/conferencia-motorista/<token>[/leituras|/terminei]
async function handleMotorista(req, res, u, deps) {
  const { pool, sendJson, readJsonBodyLimited, sendHtml, paginaMotorista } = deps;
  let m = u.pathname.match(/^\/conferencia\/m\/([A-Za-z0-9_-]{20,64})\/?$/);
  if (m && req.method === 'GET') return sendHtml(res, paginaMotorista), true;
  m = u.pathname.match(/^\/api\/conferencia-motorista\/([A-Za-z0-9_-]{20,64})(\/leituras|\/terminei)?$/);
  if (!m) return false;
  try {
    if (!motoristaPermitido(m[1])) return sendJson(res, 429, { ok: false, error: 'Muitas leituras em pouco tempo. Aguarde um instante.' }), true;
    const s = await sessaoDoMotorista(pool, m[1]);
    const cli = s.client_id === null ? null : String(s.client_id);
    const quem = { username: 'Motorista' + (s.referencia ? ' ' + s.referencia : '') };
    if (!m[2] && req.method === 'GET') return sendJson(res, 200, { ok: true, ...(await resumoMotorista(pool, s)) }), true;
    if (m[2] === '/leituras' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 4 * 1024);
      const r = await ler(pool, cli, quem, String(s.id), { codigo: b.codigo, uuid: b.uuid, motorista: true }, null);
      return sendJson(res, 200, { ok: true, situacao: r.situacao, parceiro: r.parceiro, sinal: r.sinal, mensagem: r.mensagem, progresso: r.progresso, repetida_envio: !!r.repetida_envio }), true;
    }
    if (m[2] === '/terminei' && req.method === 'POST') {
      await pool.query('UPDATE conf_sessoes SET motorista_terminou_em=NOW() WHERE id=$1', [s.id]);
      return sendJson(res, 200, { ok: true }), true;
    }
    return sendJson(res, 405, { ok: false, error: 'Operação não permitida.' }), true;
  } catch (e) {
    if (!e.status) console.log('CONFERENCIA MOTORISTA ERRO: ' + (e.stack || e.message || e));
    return sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Falha na conferência.' }), true;
  }
}

// ------------------------------------------------------------------ rotas /api/painel/conferencia*
async function handle(req, res, u, deps) {
  if (u.pathname.startsWith('/conferencia/m/') || u.pathname.startsWith('/api/conferencia-motorista/')) return handleMotorista(req, res, u, deps);
  if (u.pathname !== '/api/painel/conferencia' && !u.pathname.startsWith('/api/painel/conferencia/')) return false;
  const { pool, sendJson, readJsonBodyLimited, dashboardSession, dashboardHas, lerSswDoUsuario, testMode } = deps;
  const p = u.pathname.slice('/api/painel/conferencia'.length) || '/';
  try {
    const user = await dashboardSession(req, false);
    if (!(user.is_admin || dashboardHas(user, 'conferencia') || dashboardHas(user, 'dashboard') || dashboardHas(user, 'agendamentos')))
      return sendJson(res, 403, { ok: false, error: 'Seu usuário não tem acesso à Conferência de carga. Peça a liberação a um administrador.' }), true;
    const cli = user.client_id ? String(user.client_id) : null;
    const lerSsw = lerSswDoUsuario ? lerSswDoUsuario(user) : null;
    let m;
    if (p === '/formatos' && req.method === 'GET') return sendJson(res, 200, { ok: true, formatos: await formatos(pool, cli), pode_editar: !!user.is_admin }), true;
    if (p === '/formatos' && req.method === 'PUT') {
      if (!user.is_admin) return sendJson(res, 403, { ok: false, error: 'Só o administrador muda os formatos de etiqueta.' }), true;
      const b = await readJsonBodyLimited(req, 64 * 1024);
      await salvarFormatos(pool, cli, b.formatos);
      return sendJson(res, 200, { ok: true, formatos: await formatos(pool, cli) }), true;
    }
    if (p === '/formatos/sugerir' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      const inf = inferirPadrao(b.exemplos, b.por_volume !== false);
      const fs = compilar(await formatos(pool, cli));
      return sendJson(res, 200, { ok: true, padrao: inf.padrao, atual: inf.exemplos.map(e => { const c = classificar(fs, e); return { codigo: e, tipo: c.tipo, parceiro: c.parceiro || '' }; }) }), true;
    }
    if (p === '/formatos/ligar' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 4 * 1024);
      return sendJson(res, 200, { ok: true, ...(await ligarNome(pool, cli, b)) }), true;
    }
    if (p === '/formatos/ensinar' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      const r = await ensinar(pool, cli, b);
      return sendJson(res, 201, { ok: true, ...r, formatos: await formatos(pool, cli) }), true;
    }
    if (p === '/rotas' && req.method === 'GET') return sendJson(res, 200, { ok: true, rotas: await rotas(pool, cli) }), true;
    if (p === '/rotas' && req.method === 'PUT') {
      const b = await readJsonBodyLimited(req, 128 * 1024);
      await salvarRotas(pool, cli, b.rotas);
      return sendJson(res, 200, { ok: true, rotas: await rotas(pool, cli) }), true;
    }
    if (p === '/rotas/importar-404' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 512 * 1024);
      const r = rotasDa404(b.texto);
      if (!r.rotas.length) return sendJson(res, 400, { ok: false, error: 'Não achei setores no texto. Cole o relatório da opção 404 (SETORES CADASTRADOS).' }), true;
      await salvarRotas(pool, cli, r.rotas);
      return sendJson(res, 200, { ok: true, avisos: r.avisos, rotas: await rotas(pool, cli) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/relatorio$/)) && req.method === 'GET') return sendJson(res, 200, { ok: true, ...(await relatorioGalpao(pool, cli, m[1])) }), true;
    if ((m = p.match(/^\/nf\/(\d{1,12})$/)) && req.method === 'GET') return sendJson(res, 200, { ok: true, ...(await alertasNf(pool, cli, m[1])) }), true;
    if ((m = p.match(/^\/sessoes\/(\d+)\/rotas$/)) && req.method === 'GET') return sendJson(res, 200, { ok: true, ...(await quadroRotas(pool, cli, m[1])) }), true;
    if ((m = p.match(/^\/sessoes\/(\d+)\/rotas$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 4 * 1024);
      return sendJson(res, 201, { ok: true, ...(await abrirRota(pool, cli, user, m[1], b.rota)) }), true;
    }
    if (p === '/romaneios' && req.method === 'GET') {
      if (!lerSsw) return sendJson(res, 200, { ok: true, rows: [] }), true;
      return sendJson(res, 200, { ok: true, rows: (await lerSsw('ssw-romaneios', {})).rows || [] }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/link-motorista$/)) && req.method === 'POST')
      return sendJson(res, 200, { ok: true, ...(await gerarLinkMotorista(pool, cli, m[1], deps.publicBase)) }), true;
    if ((m = p.match(/^\/sessoes\/(\d+)\/link-motorista$/)) && req.method === 'DELETE') {
      await revogarLinkMotorista(pool, cli, m[1]);
      return sendJson(res, 200, { ok: true }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/ctes\/([A-Za-z0-9-]+)$/)) && req.method === 'DELETE') {
      await tirarCte(pool, cli, m[1], m[2]);
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    if (p === '/sessoes' && req.method === 'GET') return sendJson(res, 200, { ok: true, rows: await listar(pool, cli, u.searchParams.get('tipo')), hoje: hojeSp() }), true;
    if (p === '/sessoes' && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 2 * 1024 * 1024);
      const r = await criarSessao(pool, cli, user, { ...b, testMode: !!testMode }, lerSsw);
      return sendJson(res, r.existente ? 200 : 201, { ok: true, id: r.id, fontes: r.fontes, existente: !!r.existente, ...(await resumo(pool, cli, r.id)) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)$/)) && req.method === 'GET')
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])), leituras: await leituras(pool, cli, m[1]) }), true;
    if ((m = p.match(/^\/sessoes\/(\d+)\/leituras$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 8 * 1024);
      return sendJson(res, 200, { ok: true, ...(await ler(pool, cli, user, m[1], { ...b, testMode: !!testMode }, lerSsw)) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/leituras\/(\d+)$/)) && req.method === 'DELETE') {
      await desfazer(pool, cli, user, m[1], m[2]);
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/recarregar$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 2 * 1024 * 1024);
      await recarregar(pool, cli, m[1], lerSsw, { ...b, testMode: !!testMode });
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    if ((m = p.match(/^\/sessoes\/(\d+)\/fechar$/)) && req.method === 'POST') {
      const b = await readJsonBodyLimited(req, 16 * 1024);
      await fechar(pool, cli, user, m[1], b.observacao);
      return sendJson(res, 200, { ok: true, ...(await resumo(pool, cli, m[1])) }), true;
    }
    return sendJson(res, 404, { ok: false, error: 'Rota não encontrada.' }), true;
  } catch (e) {
    if (!e.status) console.log('CONFERENCIA ERRO: ' + (e.stack || e.message || e));
    return sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Falha na conferência: ' + (e.message || e), code: e.code }), true;
  }
}

module.exports = { ensureSchema, handle, classificar, variantesCode39, relatorioGalpao, alertasNf, compilar, parceiroDoCte, inferirPadrao, rotasDa404, janelaDescarga, FORMATOS_PADRAO, formatos, criarSessao, ler, resumo };
