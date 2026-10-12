// Testes automatizados do motor. Rodar: node test.js
const fs = require('fs');
const RE = require('./engine.js');
global.RE = RE;
const DEMO = require('./demo.js');
RE.loadMunicipios(fs.readFileSync(__dirname + '/mun.txt', 'utf8'));
let falhas = 0, total = 0;
const ok = (c, msg) => { total++; if (!c) { falhas++; console.log('FALHOU:', msg); } };
const eq = (a, b, msg) => ok(a === b, msg + ' (esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a) + ')');

// números e datas
eq(RE.num('1.500'), 1500, 'milhar sem centavos');
eq(RE.num('R$ 1.234,56'), 1234.56, 'reais');
eq(RE.num('(1.234,56)'), -1234.56, 'negativo entre parênteses');
eq(RE.num('12.5'), 12.5, 'ponto decimal');
eq(RE.parseDateBR('5/10/26'), '2026-10-05', 'data curta');
eq(RE.parseDateBR('31/02/2026'), null, 'data impossível');
eq(RE.weekday('2026-10-12'), 1, 'segunda-feira');

// chave
const xmlsTodos = DEMO.notasXML('2026-10-12');
const xmls = xmlsTodos.slice(0, 18);
const p0 = RE.parseNFeXML(xmls[0].xml);
eq(p0.tipo, 'nfe', 'xml lido');
ok(RE.parseChave(p0.nota.chave).valida, 'dígito verificador da chave');
eq(p0.nota.endereco.cidade, 'Campinas', 'cidade do destinatário');
eq(p0.nota.itens.length, 2, 'itens');
ok(p0.nota.pesoB > 0, 'peso bruto');
eq(RE.parseNFeXML('<procEventoNFe><evento><infEvento><tpEvento>110111</tpEvento><chNFe>' + p0.nota.chave + '</chNFe></infEvento></evento></procEventoNFe>').tipo, 'cancelamento', 'evento de cancelamento');

// descrição de tubos
let d = RE.dimsDaDescricao('TUBO PVC ESGOTO DN 100 X 6M');
eq(d.de, 100, 'DN'); eq(d.compr, 6, 'comprimento 6M');
d = RE.dimsDaDescricao('TUBO PEAD 315MM SDR 17 BARRA 12 METROS');
eq(d.de, 315, 'mm'); eq(d.compr, 12, 'metros'); eq(d.esp, 18.5, 'SDR -> espessura');
d = RE.dimsDaDescricao('TUBO GALV 2" 6,00 M');
eq(d.de, undefined, 'polegada não vira mm sem confirmação'); eq(d.dePol, '2', 'polegada reconhecida');
eq(RE.classificar('JOELHO 90 ESGOTO 100MM'), 'conexao', 'conexão');
eq(RE.classificar('CAIXA D AGUA 1000L'), 'caixa_agua', 'caixa');

// encaixe de tubos: geometria
const tubos = [];
for (let i = 0; i < 2; i++) tubos.push({ de: 315, di: 277.6, compr: 6, kg: 103, material: 'PEAD', ordem: 0 });
for (let i = 0; i < 4; i++) tubos.push({ de: 200, di: 190.2, compr: 6, kg: 25, material: 'PVC', ordem: 0 });
for (let i = 0; i < 10; i++) tubos.push({ de: 100, di: 96.4, compr: 6, kg: 4.8, material: 'PVC', ordem: 0 });
for (let i = 0; i < 20; i++) tubos.push({ de: 50, di: 45.2, compr: 6, kg: 3.2, material: 'PVC', ordem: 0 });
const enc = RE.encaixarTubos(tubos, { secaoW: 1000, secaoH: 1000, comprUtil: 6, folga: 5, folgaEncaixe: 10, niveis: 3, cargaInternaKgM: 25 });
ok(enc.ok, 'tubos cabem na seção 1x1');
ok(enc.encaixados > 0, 'houve encaixe: ' + enc.encaixados);
const contar = (c) => c.pecas.length + c.filhos.reduce((s, f) => s + contar(f), 0);
eq(enc.colunas.reduce((s, c) => s + contar(c), 0), tubos.length, 'todos os tubos contabilizados uma vez');
// verificação geométrica independente: nenhum filho fora do hospedeiro, nenhuma sobreposição
const verificar = (lista, cont, folga) => {
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (cont.tipo === 'ret') ok(a.x - a.de / 2 >= folga - 1e-6 && a.x + a.de / 2 <= cont.w - folga + 1e-6 && a.y - a.de / 2 >= folga - 1e-6 && a.y + a.de / 2 <= cont.h - folga + 1e-6, 'coluna dentro da seção');
    else ok(Math.hypot(a.x, a.y) + a.de / 2 <= cont.r - folga + 1e-6, 'tubo encaixado dentro do hospedeiro (folga ' + folga + ' mm)');
    for (let j = i + 1; j < lista.length; j++) { const b = lista[j]; ok(Math.hypot(a.x - b.x, a.y - b.y) >= (a.de + b.de) / 2 + folga - 1e-6, 'sem sobreposição'); }
    if (a.filhos.length) { ok(a.di, 'hospedeiro tem diâmetro interno'); verificar(a.filhos, { tipo: 'circ', r: a.di / 2 }, 10); }
    for (const f of a.filhos) ok(f.de <= a.di - 20 + 1e-6, 'folga radial do encaixe');
  }
};
verificar(enc.colunas, { tipo: 'ret', w: 1000, h: 1000 }, 5);
// três níveis: 50 dentro de 100 dentro de 200 dentro de 315
const prof = (c) => 1 + Math.max(0, ...c.filhos.map(prof));
ok(Math.max(...enc.colunas.map(prof)) >= 3, 'encaixe em vários níveis');
// tubo maior que o comprimento útil
const longo = RE.encaixarTubos([{ de: 100, di: 96, compr: 6, kg: 5, ordem: 0 }], { secaoW: 1300, secaoH: 1200, comprUtil: 1.9 });
ok(!longo.ok, 'tubo de 6 m não cabe na Fiorino');
// tubos curtos em sequência
const curtos = RE.encaixarTubos(Array.from({ length: 4 }, () => ({ de: 100, di: 96, compr: 3, kg: 2, ordem: 0 })), { secaoW: 1000, secaoH: 1000, comprUtil: 6, folga: 5 });
eq(curtos.colunas.length, 2, 'barras de 3 m em sequência num rack de 6 m');
// sem diâmetro interno não recebe nada
const semDi = RE.encaixarTubos([{ de: 300, compr: 6, kg: 50, ordem: 0 }, { de: 50, di: 45, compr: 6, kg: 3, ordem: 0 }], { secaoW: 1000, secaoH: 1000, comprUtil: 6 });
eq(semDi.encaixados, 0, 'sem DI não há encaixe');
// ordem de entrega: tubo de dentro não pode ser entregue depois do hospedeiro
const ord = RE.encaixarTubos([{ de: 300, di: 280, compr: 6, kg: 50, ordem: 0 }, { de: 100, di: 96, compr: 6, kg: 5, ordem: 1 }], { secaoW: 1000, secaoH: 1000, comprUtil: 6, ordemImporta: true });
eq(ord.encaixados, 0, 'tubo de entrega posterior não vai dentro de tubo entregue antes');
const ord2 = RE.encaixarTubos([{ de: 300, di: 280, compr: 6, kg: 50, ordem: 1 }, { de: 100, di: 96, compr: 6, kg: 5, ordem: 0 }], { secaoW: 1000, secaoH: 1000, comprUtil: 6, ordemImporta: true });
eq(ord2.encaixados, 1, 'tubo entregue antes pode ir dentro do hospedeiro');
// limite de carga interna por metro
const pesado = RE.encaixarTubos([{ de: 300, di: 280, compr: 6, kg: 50, ordem: 0 }, { de: 100, di: 90, compr: 6, kg: 200, ordem: 0 }], { secaoW: 1000, secaoH: 1000, comprUtil: 6, cargaInternaKgM: 25 });
eq(pesado.encaixados, 0, 'conteúdo pesado demais não é encaixado');

// fluxo completo
const cfg = Object.assign({}, RE.CFG_PADRAO, { minEntregas: 0 });
const cidades = Object.fromEntries(DEMO.CIDADES.map((c) => { const m = RE.findMun(c.id); return [c.id, Object.assign({}, c, { lat: m.lat, lon: m.lon })]; }));
const ctx = { cfg, cidades, motoristas: {}, clientes: {}, produtos: DEMO.PRODUTOS, base: cfg.base,
  veiculos: [
    Object.assign({}, RE.VEICULOS_PADRAO[0]), Object.assign({}, RE.VEICULOS_PADRAO[0], { id: 'fiorino-2', nome: 'Fiorino 2' }),
    Object.assign({}, RE.VEICULOS_PADRAO[1]), Object.assign({}, RE.VEICULOS_PADRAO[2]), Object.assign({}, RE.VEICULOS_PADRAO[2], { id: 'tubos-2', nome: 'Van Tubos 2' }),
  ] };
const notas = xmls.map((x, i) => { const n = RE.parseNFeXML(x.xml).nota; n.id = n.chave; n.status = 'pronta'; n.prazo = RE.addDays('2026-10-12', 3 + (i % 4)); return RE.enriquecer(n, ctx); });
const bloqueadas = notas.filter((n) => n.bloqueada);
eq(bloqueadas.length, 1, 'uma nota com pendência (sem peso)');
ok(bloqueadas[0].pendencias.some((p) => p.cod === 'peso') && bloqueadas[0].pendencias.some((p) => p.cod === 'tubo_diametro'), 'pendências de peso e diâmetro em polegadas');
const n3 = notas.find((n) => n.tubos.length > 2);
ok(n3 && n3.qtdTubos > 0, 'tubos reconhecidos pelo cadastro');

const t0 = Date.now();
const plano = RE.planejar(notas, '2026-10-12', ctx, {});
console.log('planejamento em', Date.now() - t0, 'ms; veículos', plano.totais.veiculos, '; entregas', plano.totais.entregas, '; fora', plano.naoRoteirizadas.length, '; lucro', plano.totais.lucro);
const wd = RE.weekday('2026-10-12');
for (const r of plano.rotas) {
  ok(r.ok, 'rota viável ' + r.veiculoNome + ' ' + r.motivos.join(';'));
  ok(r.kg <= ctx.veiculos.find((v) => v.id === r.veiculoId).capKg, 'peso dentro da capacidade');
  for (const p of r.paradas) ok(cidades[p.cidadeId].dias.includes(wd), 'entrega em dia permitido: ' + p.cidadeNome);
  eq(Math.round((r.receita - r.custo.total) * 100) / 100, r.lucro, 'lucro = receita - custo');
  if (r.receita > 0) eq(r.margem, Math.round(r.lucro / r.receita * 1000) / 10, 'margem');
}
ok(!plano.rotas.some((r) => r.paradas.some((p) => p.cidadeNome.startsWith('Piracicaba'))), 'Piracicaba não sai na segunda');
const ids = plano.rotas.flatMap((r) => r.paradas.flatMap((p) => p.notas));
eq(new Set(ids).size, ids.length, 'nenhuma nota em duas rotas');
// a busca deve encontrar soluções viáveis com no máximo a frota disponível
ok(plano.totais.veiculos <= 5, 'frota respeitada');

// terça: Piracicaba, Rio Claro e Hortolândia liberadas
const planoTer = RE.planejar(notas, '2026-10-13', ctx, {});
ok(planoTer.rotas.some((r) => r.paradas.some((p) => p.cidadeNome.startsWith('Piracicaba'))), 'Piracicaba sai na terça');
ok(!planoTer.rotas.some((r) => r.paradas.some((p) => p.cidadeNome.startsWith('Limeira'))), 'Limeira não sai na terça');

// cenários
const cen = RE.cenarios(notas, '2026-10-12', ctx, {});
ok(cen.length >= 4, 'cenários gerados: ' + cen.length);
ok(cen[0].melhor && cen[0].porque, 'melhor cenário explicado');
console.log(cen.map((c) => c.nome + ': ' + c.veiculos + ' veic, ' + c.entregas + ' ent, fora ' + c.foraTotal + ', lucro ' + c.lucro).join('\n'));

// edição manual: mover parada recalcula e detecta excesso
if (plano.rotas.length >= 2) {
  const p2 = JSON.parse(JSON.stringify(plano));
  const fio = p2.rotas.find((r) => r.veiculoTipo === 'fiorino');
  const outra = p2.rotas.find((r) => r !== fio);
  if (fio && outra) {
    fio.paradas.push(...outra.paradas); outra.paradas = [];
    const rec = RE.recalcularPlano(p2, notas, ctx);
    const f2 = rec.rotas.find((r) => r.veiculoId === fio.veiculoId);
    ok(!f2.ok, 'mover tudo para a Fiorino é recusado pelo recálculo: ' + f2.motivos[0]);
  }
}
// dia de rota respeitado e alerta de prazo
const al = RE.alertasPrazo(notas.map((n) => Object.assign({}, n, { prazoEfetivo: n.cidadeNome.startsWith('Piracicaba') ? '2026-10-12' : n.prazoEfetivo })), '2026-10-12', ctx);
ok(al.some((a) => a.tipo === 'sem_dia'), 'alerta de nota sem dia de rota até o prazo');

// mínimo de entregas por veículo
{
  const cfgM = Object.assign({}, RE.CFG_PADRAO, { minEntregas: 20 });
  const ctxM = Object.assign({}, ctx, { cfg: cfgM });
  const todas = xmlsTodos.map((x, i) => { const n = RE.parseNFeXML(x.xml).nota; n.id = n.chave; n.status = 'pronta'; n.prazo = RE.addDays('2026-10-12', 6); return RE.enriquecer(n, ctxM); });
  const pm = RE.planejar(todas, '2026-10-12', ctxM, { tempoMs: 4000 });
  console.log('mínimo 20 (sem prazo):', pm.rotas.map((r) => r.veiculoNome + '=' + r.paradas.length).join(', '), '; fora', pm.naoRoteirizadas.length);
  ok(pm.rotas.length > 0, 'com volume suficiente algum veículo sai');
  for (const r of pm.rotas) ok(r.paradas.length >= 20, 'veículo com pelo menos 20 entregas: ' + r.veiculoNome + ' ' + r.paradas.length);
  ok(pm.naoRoteirizadas.every((u) => /mínimo|aguardar|Sem veículo|capacidade/i.test(u.motivo)), 'motivo das que ficaram');
  // poucas entregas e nenhuma no limite do prazo: ninguém sai
  const poucas = todas.slice(0, 10);
  const p2 = RE.planejar(poucas, '2026-10-12', ctxM, {});
  eq(p2.rotas.length, 0, 'abaixo do mínimo e sem prazo: nenhum veículo sai');
  ok(p2.naoRoteirizadas.some((u) => /mínimo/.test(u.motivo)), 'motivo cita o mínimo');
  // com entrega vencendo hoje, o veículo sai abaixo do mínimo (exceção ligada)
  const urg = poucas.map((n, i) => (i === 0 ? Object.assign({}, n, { prazoEfetivo: '2026-10-12' }) : n));
  const p3 = RE.planejar(urg, '2026-10-12', ctxM, {});
  ok(p3.rotas.length >= 1 && p3.rotas.some((r) => r.paradas.some((p) => p.obrigatoria)), 'entrega no limite do prazo faz o veículo sair');
  ok(p3.decisoes.some((d) => /abaixo do mínimo/.test(d)), 'decisão registrada');
  // exceção desligada: não sai
  const p4 = RE.planejar(urg, '2026-10-12', Object.assign({}, ctxM, { cfg: Object.assign({}, cfgM, { minExcecaoPrazo: false }) }), {});
  eq(p4.rotas.length, 0, 'exceção desligada: mínimo vale sempre');
}

// prioridade (nota que ficou): entra obrigatoriamente e segura o veículo abaixo do mínimo
{
  const cfgM = Object.assign({}, RE.CFG_PADRAO, { minEntregas: 20 });
  const ctxM = Object.assign({}, ctx, { cfg: cfgM });
  const base = notas.filter((n) => !n.bloqueada).slice(0, 6).map((n) => Object.assign({}, n, { prazoEfetivo: RE.addDays('2026-10-12', 10) }));
  const semPri = RE.planejar(base, '2026-10-12', ctxM, {});
  eq(semPri.rotas.length, 0, 'sem prioridade e abaixo do mínimo: não sai');
  const comPri = base.map((n, i) => (i === 0 ? Object.assign({}, n, { prioridade: true }) : n));
  const pp = RE.planejar(comPri, '2026-10-12', ctxM, {});
  ok(pp.rotas.some((r) => r.paradas.some((s) => s.prioridade)), 'nota prioritária sai no dia');
  const futura = base.map((n, i) => (i === 0 ? Object.assign({}, n, { prioridade: true, dataMinima: '2026-10-14' }) : n));
  const pf = RE.planejar(futura, '2026-10-12', ctxM, {});
  ok(!pf.rotas.some((r) => r.paradas.some((s) => s.prioridade)), 'respeita “não entregar antes de”');
  // veículo desmarcado no dia não entra
  const ctxD = Object.assign({}, ctx, { veiculos: ctx.veiculos.map((v) => (v.tipo === 'tubos' ? Object.assign({}, v, { indispDia: true }) : v)) });
  const pd = RE.planejar(notas, '2026-10-12', ctxD, {});
  ok(!pd.rotas.some((r) => r.veiculoTipo === 'tubos'), 'veículo desmarcado no Painel fica fora');
}

// CSV
const csv = 'Chave;Cliente;Cidade;UF;Peso;Volume;Frete;Prazo\n;Cliente X;Campinas;SP;120,5;0,8;150,00;15/10/2026\n';
const nc = RE.rowsToNotas(RE.parseCSV(csv));
eq(nc.length, 1, 'linha de planilha'); eq(nc[0].pesoB, 120.5, 'peso da planilha'); eq(nc[0].prazo, '2026-10-15', 'prazo da planilha');
const ncE = RE.enriquecer(Object.assign(nc[0], { id: 'x' }), ctx);
eq(ncE.bloqueada, false, 'nota de planilha completa'); eq(ncE.freteValor, 150, 'frete da planilha');

// desempenho: 400 notas
const muitas = [];
for (let k = 0; k < 400; k++) { const n = Object.assign({}, notas[k % 17]); n.id = 'n' + k; n.chave = 'n' + k; n.destDoc = String(k); muitas.push(n); }
const big = Object.assign({}, ctx, { veiculos: Array.from({ length: 30 }, (_, i) => Object.assign({}, RE.VEICULOS_PADRAO[i % 3], { id: 'v' + i, nome: 'V' + i })) });
const t1 = Date.now();
const pb = RE.planejar(muitas, '2026-10-12', big, { tempoMs: 4000 });
console.log('400 notas:', Date.now() - t1, 'ms; veículos', pb.totais.veiculos, '; fora', pb.naoRoteirizadas.length);
ok(Date.now() - t1 < 15000, 'desempenho com 400 notas');
for (const r of pb.rotas) ok(r.ok, 'rota viável (grande) ' + r.motivos.join(';'));

console.log('\n' + (total - falhas) + '/' + total + ' verificações passaram');
process.exit(falhas ? 1 : 0);
