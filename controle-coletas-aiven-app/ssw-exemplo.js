'use strict';
// SSW de exemplo da versão de demonstração (MOVIT_DEMO=1).
// A transportadora que recebe o link de teste e entra SEM o login do SSW cai numa empresa com
// números fictícios. O processo de leitura dessa empresa (o mesmo dashboard/server.js) fala com
// este servidor local em vez do SSW real: as chamadas a sistema.ssw.inf.br e ssw.inf.br são
// desviadas por ssw-exemplo-desvio.js, carregado só nesse processo.
// Formatos das telas iguais aos do SSW real (os mesmos do SSW de mentira dos testes,
// tests/apoio/ssw-falso.js). Nada aqui grava: toda consulta só lê os dados fictícios abaixo.
// Testado em tests/movit-demo.js.

const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

const UNIDADES = ['MTZ', 'FIL'];
const hoje = (ano = 2) => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: ano === 4 ? 'numeric' : '2-digit' });
const MOTORISTAS = [
  ['CARLOS ALBERTO SOUZA', 'EXA1B23'], ['MARCOS VINICIUS LIMA', 'EXB2C34'], ['JOSE ROBERTO ALVES', 'EXC3D45'],
  ['ANDRE LUIS PEREIRA', 'EXD4E56'], ['PAULO HENRIQUE COSTA', 'EXE5F67'], ['RAFAEL GOMES SILVA', 'EXF6G78'],
  ['EDSON MARTINS ROCHA', 'EXG7H89']
];
const CLIENTES = [
  ['MERCADO BOM PRECO', 'CAMPINAS', 'RUA BARAO DE JAGUARA', '1200', 'CENTRO', '13015001', '-22,9056', '-47,0608'],
  ['LOJA DO CONSTRUTOR', 'SUMARE', 'AVENIDA REBOUCAS', '455', 'JARDIM DALL ORTO', '13170023', '-22,8219', '-47,2669'],
  ['DEPOSITO SAO JORGE', 'HORTOLANDIA', 'RUA JOSE CAMARGO', '88', 'JARDIM AMANDA', '13188000', '-22,8584', '-47,2200'],
  ['FARMACIA VIDA', 'VALINHOS', 'AVENIDA DOS ESPORTES', '310', 'VILA SANTANA', '13270000', '-22,9707', '-46,9958'],
  ['SUPERMERCADO ALIANCA', 'JUNDIAI', 'AVENIDA JUNDIAI', '1500', 'ANHANGABAU', '13208051', '-23,1857', '-46,8978'],
  ['MATERIAIS PRIMAVERA', 'INDAIATUBA', 'RUA CANDELARIA', '72', 'CENTRO', '13330000', '-23,0903', '-47,2181'],
  ['PADARIA ESTRELA', 'PAULINIA', 'AVENIDA JOSE PAULINO', '980', 'CENTRO', '13140000', '-22,7611', '-47,1542'],
  ['ATACADO NOVA ERA', 'AMERICANA', 'AVENIDA BRASIL', '2100', 'JARDIM GLORIA', '13465000', '-22,7374', '-47,3331'],
  ['LOJA CASA BONITA', 'PIRACICABA', 'RUA GOVERNADOR PEDRO DE TOLEDO', '640', 'CENTRO', '13400000', '-22,7253', '-47,6492'],
  ['DISTRIBUIDORA SOL', 'LIMEIRA', 'RUA BOA MORTE', '355', 'CENTRO', '13480000', '-22,5641', '-47,4017'],
  ['ELETRO CENTRO', 'MOGI MIRIM', 'AVENIDA SAUDADE', '516', 'CENTRO', '13800000', '-22,4318', '-46,9578'],
  ['CERAMICA PEDREIRA', 'PEDREIRA', 'RUA DAS PORCELANAS', '100', 'CENTRO', '13920000', '', '']
];
const REMETENTES = ['INDUSTRIA ALFA LTDA', 'FABRICA BETA S/A', 'DISTRIBUIDORA GAMA', 'COMERCIAL DELTA'];
// CT-es fictícios: um por cliente em cada unidade (24 no total), com NF, volumes, peso, frete e situação.
const CTES = {};
let n = 0;
for (const un of UNIDADES) {
  CLIENTES.forEach((c, i) => {
    n++;
    const nro = (un === 'MTZ' ? 50100 : 60100) + i, dvv = nro % 9;
    CTES[un + nro] = {
      un, nro, dv: dvv, ctrc: un + String(nro).padStart(6, '0') + '-' + dvv, nct: 20000 + n, nf: 81000 + n,
      nome: c[0], cid: c[1], lgr: c[2], num: c[3], bairro: c[4], cep: c[5], lat: c[6], lon: c[7], uf: 'SP',
      doc: String(10000000000100 + n * 7919).slice(0, 14), rem: REMETENTES[n % REMETENTES.length],
      vol: 1 + (n * 3) % 14, peso: (35 + (n * 47) % 900).toFixed(3).replace('.', ','), frete: (60 + (n * 13) % 240).toFixed(2).replace('.', ','),
      valor: (900 + (n * 271) % 9000).toFixed(2).replace('.', ','), atraso: n % 5 === 0 ? 1 + n % 3 : 0
    };
  });
}
const LISTA = Object.values(CTES);
// Romaneios de hoje: cada motorista leva de 3 a 4 CT-es; o último fica sem romaneio (disponível).
const ROMANEIOS = [];
MOTORISTAS.forEach(([mot, placa], i) => {
  const un = UNIDADES[i % 2], seqr = 7100 + i, rom = un + String(1200 + i).padStart(6, '0') + '-' + (i % 9);
  const ctes = LISTA.filter(c => c.un === un).slice(Math.floor(i / 2) * 3, Math.floor(i / 2) * 3 + 3);
  const entregues = Math.min(ctes.length, i % 4);
  ROMANEIOS.push({ un, seq: seqr, rom, placa, mot, ctes, falta: ctes.length - entregues, entregues });
});
const NO_ROMANEIO = new Set(ROMANEIOS.flatMap(r => r.ctes.map(c => c.ctrc)));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const loginPage = '<html><body><form action="ssw0422"><input name="f1"><input name="f2"><input name="f3"><input type="password" name="f4"></form></body></html>';
const page38 = rows => '<html><body><form><input name="act" value=""><input name="dummy" value="1"></form><table><tr><th>Romaneio</th><th>Veículo</th><th>Inclusão</th><th>Motorista</th><th>Qtde CTRCs</th><th>Falta Ocorr.</th><th></th></tr>' +
  rows.map(r => '<tr><td>' + r.rom + '</td><td>' + r.placa + '</td><td>' + hoje() + '</td><td>' + r.mot + '</td><td>' + r.ctes.length + '</td><td>' + r.falta + '</td><td><a href=# class=sra onclick="ajaxEnvia(\'\',1,\'ssw0198?act=ENV_ROM_COMPROV&seq_romaneio=' + r.seq + '\');return(false)"><u>Imagens</u></a></td></tr>').join('') + '</table></body></html>';
// Entregas em aberto (opção 38, act=PEN). Colunas: f0 CTRC, f1 NF, f2 remetente, f3 destinatário, f4 cidade, f6 volumes, f7 peso, f8 previsão, f9 dias de atraso, f10 situação.
const pendXml = un => '<xml><rs>' + LISTA.filter(c => c.un === un && !NO_ROMANEIO.has(c.ctrc)).map(c =>
  '<r><f0>' + c.ctrc + '</f0><f1>' + c.nf + '</f1><f2>' + esc(c.rem) + '</f2><f3>' + esc(c.nome) + '</f3><f4>' + c.cid + '</f4><f6>' + c.vol + '</f6><f7>' + c.peso + '</f7><f8>' + hoje() + '</f8><f9>' + c.atraso + '</f9><f10>DISPONIVEL</f10></r>').join('') + '</rs></xml>';
const telaComprov = seqr => {
  const r = ROMANEIOS.find(x => x.seq === seqr);
  if (!r) return '<html><body>Nenhum comprovante.</body></html>';
  const dm = hoje().slice(0, 5);
  return '<html><head><title>038 - Baixa de Entregas &gt; Comprovantes</title></head><body><div>Ve&iacute;culo: ' + r.placa + ' Motorista: ' + r.mot + ' Data: ' + hoje() + '</div><xml id="xmlsr"><rs>' +
    r.ctes.map((c, i) => '<r><f0>&lt;a href=# class=sra onclick=ajaxEnvia(\'\',1,\'ssw0053\');return(false);&gt;&lt;u&gt;' + c.ctrc + '&lt;/u&gt;&lt;/a&gt;</f0><f1>' + esc(c.rem) + '</f1><f2>' + esc(c.rem) + '</f2><f3>' + esc(c.nome) + '</f3><f4>' + esc(c.lgr) + ',' + c.num + '</f4><f5>SP ' + c.cid + '</f5><f6>' +
      (i < r.entregues ? dm + '-1-MERCADORIA ENTREGUE EM ' + dm + '/' + hoje(4).slice(-2) + ' ' + String(9 + i).padStart(2, '0') + ':' + String(10 + i * 7).padStart(2, '0') : '') + '</f6><f7></f7><f8></f8></r>').join('') + '</rs></xml></body></html>';
};
// Opção 101 (situação do CT-e) e o XML do CT-e.
const dv = (c, t) => '<div class=' + c + ' style="left:1px;top:1px;">' + t + '</div> ';
const campo = (rotulo, nome, max, act) => '<div class=texto>' + rotulo + ':</div><input type="text" name="' + nome + '" id="' + nome + '" value="" maxlength=' + max + '><a href="#" onclick="ajaxEnvia(\'' + act + '\', 1);return false;">&#9658;</a><a href="#" onclick="btnClose();return false;">&times;</a>';
const FORM101 = '<html><body><form><input type="hidden" name="act" value="">' +
  '<div class=texto>CTRC (sigla opc, n&uacute;mero sem DV):</div><input type="text" name="t_ser_ctrc" value="" maxlength=3><input type="text" name="t_nro_ctrc" id="t_nro_ctrc" value="" maxlength=6><a href="#" onclick="ajaxEnvia(\'P1\', 1);return false;">&#9658;</a>' +
  campo('Nota Fiscal', 't_nro_nf', 10, 'P2') + campo('Cod vol cliente/shipment', 't_cod_cli', 50, 'P8') + campo('CT-e/NFS-e', 't_nro_cte', 10, 'P4') + campo('N&deg; Pedido', 't_nro_pedido', 50, 'P6') + campo('C&oacute;digo de barras', 't_cod_barras', 50, 'BAR') +
  '<input type="hidden" name="seq_ctrc" value=""><input type="hidden" name="FAMILIA" value="EXE"><input type="hidden" name="web_sess" value="exemplo"></form></body></html>';
const semCte = '<html><body><form><input type="hidden" name="act" value=""></form><div class=texto>CTRC n&atilde;o encontrado.</div></body></html>';
const nenhum = '<html><body>Nenhum CTRC selecionado para dados e per&iacute;odo informados</body></html>';
const situacao = c => NO_ROMANEIO.has(c.ctrc) ? hoje() + ' 06:45 85-SAIDA PARA ENTREGA' : hoje() + ' 05:30 82-CHEGADA NA UNIDADE';
const tela101 = c => {
  const mapa = id => '<A id="' + id + '" class="baselnk" href="#" onclick="showmapa(\'end=' + c.lgr + ',' + c.num + '&nome=' + encodeURIComponent(c.nome) + (c.lat ? '&olat=' + c.lat + '&olng=' + c.lon : '') + '&cid=' + c.cid + '&uf=SP\');return false;">mapa</A> ';
  return '<html><head><title>101 - Situa&ccedil;&atilde;o do CTRC</title></head><body><form><input type="hidden" name="act" value=""><input type="hidden" name="g_ctrc_ser_ctrc" value="' + c.un + '"><input type="hidden" name="g_ctrc_nro_ctrc" value="' + c.nro + '"><input type="hidden" name="seq_ctrc" value="' + (30000 + c.nct) + '"><input type="hidden" name="FAMILIA" value="EXE"><input type="hidden" name="web_sess" value="exemplo"></form>' +
    dv('texto', 'CTRC&nbsp;/Subc./RPS:') + dv('data', '<b>' + c.ctrc + '</b>') + '<A id="link_imp_xml" class=baselnk href="#" onclick="ajaxEnvia(\'XML\', 0);return false;">XML</A>' +
    dv('texto', 'CT-e:') + dv('data', '001 ' + String(c.nct).padStart(9, '0')) + dv('texto', 'Previs&atilde;o de entrega:') + dv('data', hoje()) + dv('texto', 'N&deg; da Nota Fiscal:') + dv('data', '1/' + String(c.nf).padStart(9, '0')) +
    dv('texto', 'Qtde. de vol./pares:') + dv('data', c.vol + '/0') + dv('texto', 'Peso real /Peso real orig (Kg):') + dv('data', c.peso) + dv('texto', 'Valor da Nota Fiscal:') + dv('data', c.valor) + dv('texto', 'Valor frete (R$):') + dv('data', c.frete) +
    dv('texto', 'Remetente:') + dv('texto', 'Destinat&aacute;rio:') + dv('texto', 'Nome:') + dv('data', esc(c.rem)) + dv('texto', 'Nome:') + dv('data', esc(c.nome)) + dv('texto', 'CNPJ:') + dv('data', '11222333000181') + dv('texto', 'CNPJ:') + dv('data', c.doc) + mapa('link_mapa_setor_cli_dest') +
    dv('texto', 'Expedidor:') + dv('texto', 'Entrega:') + dv('texto', 'Nome:') + dv('data', esc(c.rem)) + dv('texto', 'Nome:') + dv('data', esc(c.nome)) + dv('texto', 'CNPJ:') + dv('data', '11222333000181') + dv('texto', 'CNPJ:') + dv('data', c.doc) + mapa('link_mapa_setor_cli_ent') +
    dv('texto', 'Endere&ccedil;o:') + dv('data', 'RODOVIA ANHANGUERA KM 100') + dv('texto', 'Endere&ccedil;o:') + dv('data', esc(c.lgr) + ',' + c.num) + dv('texto', 'Complemento:') + dv('texto', 'Complemento:') + dv('data', '') +
    dv('texto', 'Bairro:') + dv('data', 'DISTRITO INDUSTRIAL') + dv('texto', 'Bairro:') + dv('data', c.bairro) + dv('texto', 'CEP:') + dv('data', '13054-000 CAMPINAS/SP') + dv('texto', 'CEP:') + dv('data', c.cep.slice(0, 5) + '-' + c.cep.slice(5) + ' ' + c.cid + '/SP') + dv('texto', 'Telefone:') + dv('texto', 'Pagador:') +
    dv('texto', 'Situa&ccedil;&atilde;o Atual:') + dv('data', 'EXE ' + c.un + ' ' + situacao(c)) + '<A id="link_ocor" href="#" onclick="ajaxEnvia(\'O\', 1);return false;"><u>O</u>corr&ecirc;ncias</A></body></html>';
};
const chaveDe = c => '35' + '2610' + '11222333000181' + '57' + '001' + String(c.nct).padStart(9, '0') + '1' + String(c.nct).padStart(8, '0') + '4';
const xmlDe = c => '<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe' + chaveDe(c) + '" versao="4.00"><ide><serie>1</serie><nCT>' + c.nct + '</nCT><xMunFim>' + c.cid + '</xMunFim><UFFim>SP</UFFim></ide>' +
  '<rem><CNPJ>11222333000181</CNPJ><xNome>' + esc(c.rem) + '</xNome><enderReme><xLgr>RODOVIA ANHANGUERA</xLgr><nro>100</nro><xMun>CAMPINAS</xMun><CEP>13054000</CEP><UF>SP</UF></enderReme></rem>' +
  '<dest><CNPJ>' + c.doc + '</CNPJ><xNome>' + esc(c.nome) + '</xNome><enderDest><xLgr>' + esc(c.lgr) + '</xLgr><nro>' + c.num + '</nro><xBairro>' + c.bairro + '</xBairro><xMun>' + c.cid + '</xMun><CEP>' + c.cep + '</CEP><UF>SP</UF></enderDest></dest>' +
  '<infCTeNorm><infDoc><infNFe><chave>35261011222333000181550010000' + String(c.nf).padStart(5, '0') + '1000000017</chave></infNFe></infDoc></infCTeNorm></infCte></CTe></cteProc>';
function zipDe(nome, texto) {
  const name = Buffer.from(nome), raw = Buffer.from(texto), data = zlib.deflateRawSync(raw);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([lh, name, data, ch, name, end]);
}
// Opção 475 (programação de despesas): só a listagem.
const DESPESAS = [
  ['204512', 'MTZ', '0420 - COMBUSTIVEL', 'POSTO RODOVIA LTDA', '1.850,40', 'LIQUIDADA'],
  ['204513', 'MTZ', '0420 - COMBUSTIVEL', 'POSTO RODOVIA LTDA', '1.420,00', 'A VENCER'],
  ['204520', 'MTZ', '0310 - PEDAGIO', 'SEM PARAR INSTITUICAO DE PAGAMENTO', '612,75', 'LIQUIDADA'],
  ['204530', 'MTZ', '0101 - SALARIOS', 'FOLHA DE PAGAMENTO', '38.000,00', 'LIQUIDADA'],
  ['204541', 'FIL', '0510 - MANUTENCAO DE VEICULOS', 'OFICINA DIESEL FORTE', '2.380,00', 'A VENCER'],
  ['204550', 'FIL', '0777 - MATERIAL DE ESCRITORIO', 'PAPELARIA CENTRAL', '189,90', 'LIQUIDADA']
];
const lista475 = () => '<html><body><table><tr><th>Lan&ccedil;amento</th><th>Unid</th><th>Evento</th><th>Fornecedor</th><th>Inclus&atilde;o</th><th>Pagamento</th><th>Valor</th><th>Situa&ccedil;&atilde;o</th></tr>' +
  DESPESAS.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + hoje() + '</td><td>' + hoje() + '</td><td>' + r[4] + '</td><td>' + r[5] + '</td></tr>').join('') + '</table></body></html>';
const FORM475 = '<html><head><title>475 - Programa&ccedil;&atilde;o de Despesas</title></head><body><form><input type="hidden" name="act" value=""><input type="hidden" name="web_sess" value="exemplo">' +
  ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'f13'].map(f => '<input type="text" name="' + f + '" id="' + f + '" value="">').join('') + '</form></body></html>';
// WebAPI do BI2: CT-es em atraso (13), CT-es do período (174) e relatórios vazios nos demais códigos.
const bi2Csv = (cod, titulos, linhas) => ['0;EXEMPLO;TRANSPORTADORA EXEMPLO;' + cod + ';' + hoje(4) + ';08:00', '1;' + titulos.join(';'), ...linhas.map(l => '2;' + l.join(';'))].join('\r\n') + '\r\n';
const BI2 = {
  13: () => bi2Csv(13, ['FILIAL', 'CTRC', 'NF', 'REMETENTE', 'PAGADOR', 'DESTINATARIO', 'UF DESTINO', 'CIDADE DESTINO', 'PREVISAO ENTREGA', 'DIAS ATRASO', 'VAL MERC', 'FRETE', 'QTD VOLUMES', 'PESO', 'M3'],
    LISTA.filter(c => c.atraso).map(c => [c.un, c.ctrc, c.nf, c.rem, c.rem, c.nome, 'SP', c.cid, hoje(4), c.atraso, c.valor, c.frete, c.vol, c.peso, '0,4'])),
  174: () => bi2Csv(174, ['numero_ctrc', 'numero_nf', 'data_emissao', 'situacao', 'remetente_nome', 'destinatario_nome', 'cidade_destino', 'uf_destino', 'valor_frete', 'valor_n_fiscal', 'qtd_volumes', 'peso_real', 'm3', 'prev_ent'],
    LISTA.map(c => [c.ctrc, c.nf, hoje(4), NO_ROMANEIO.has(c.ctrc) ? 'EM ENTREGA' : 'EM TRANSITO', c.rem, c.nome, c.cid, 'SP', c.frete, c.valor, c.vol, c.peso, '0,4', hoje(4)])),
  16: () => bi2Csv(16, ['CTRC'], []), 17: () => bi2Csv(17, ['CTRC'], []), 83: () => bi2Csv(83, ['CTRC'], []), 245: () => bi2Csv(245, ['CIDADE'], [])
};

const tokens = new Map();
async function atender(req, res) {
  const u = new URL(req.url, 'http://x');
  let body = ''; for await (const c of req) body += c;
  const send = (code, txt, h = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...h }); res.end(txt); };
  if (u.pathname.startsWith('/api/bi2/')) {
    const rel = BI2[u.searchParams.get('codigo')];
    return rel ? send(200, rel(), { 'Content-Type': 'text/csv; charset=utf-8' }) : send(404, '');
  }
  if (u.pathname === '/bin/ssw0422' && req.method === 'GET') return send(200, loginPage, { 'Set-Cookie': 'sid=ex' + crypto.randomBytes(4).toString('hex') + '; Path=/' });
  if (u.pathname === '/bin/ssw0422' && req.method === 'POST') {
    const t = 'EX' + crypto.randomBytes(12).toString('hex');
    tokens.set(t, { unit: UNIDADES[0] });
    if (tokens.size > 500) tokens.delete(tokens.keys().next().value);
    return send(200, '<html>ok</html>', { 'Set-Cookie': 'token=' + t + '; Path=/' });
  }
  const tok = (String(req.headers.cookie || '').match(/(?:^|;\s*)token=([^;]+)/) || [])[1] || '';
  const st = tokens.get(tok);
  if (!st) return send(200, loginPage);
  if (u.pathname === '/bin/menu01' && u.searchParams.get('f3') === '101') return send(200, '<script>location="ssw0053"</script>');
  if (u.pathname === '/bin/ssw0053' && req.method === 'GET') return send(200, FORM101);
  if (u.pathname === '/bin/ssw0053' && req.method === 'POST') {
    const p = new URLSearchParams(body), act = p.get('act') || '';
    const porNro = nro => LISTA.find(c => c.nro === Number(nro));
    if (act === 'P1') { const c = porNro(p.get('t_nro_ctrc')); return send(200, c ? tela101(c) : semCte); }
    if (act === 'P2') { const c = LISTA.find(x => String(x.nf) === String(Number(p.get('t_nro_nf')))); return send(200, c ? tela101(c) : nenhum); }
    if (act === 'BAR') { const c = LISTA.find(x => chaveDe(x) === p.get('t_cod_barras')); return send(200, c ? tela101(c) : nenhum); }
    const c = porNro(p.get('g_ctrc_nro_ctrc'));
    if (act === 'XML' && c) return send(200, '<html><form><input type=hidden name=web_body value="' + encodeURIComponent('abrir("CTe_66480000' + c.nro + '.zip", "CTe_66480000' + c.nro + '.zip", 1, 1, "binary", 3)') + '"></form></html>');
    if (act === 'A') return send(200, '<html><body>Nenhuma DANFE dispon&iacute;vel.</body></html>');
    if (act === 'ARQ') return send(200, '<html><body>Nenhum arquivo EDI para este CTRC.</body></html>');
    return send(200, act ? nenhum : semCte);
  }
  if (u.pathname === '/bin/ssw0424') {
    const nro = Number((String(u.searchParams.get('filename') || '').match(/66480000(\d+)\.zip$/) || [])[1]), c = LISTA.find(x => x.nro === nro);
    if (!c) return send(404, '');
    res.writeHead(200, { 'Content-Type': 'application/ssw' }); return res.end(zipDe(chaveDe(c) + '-cte.xml', xmlDe(c)));
  }
  if (u.pathname === '/bin/menu01' && u.searchParams.get('f3') === '475') return send(200, '<script>location="ssw0094"</script>');
  if (u.pathname === '/bin/ssw0094' && req.method === 'GET') return send(200, FORM475);
  if (u.pathname === '/bin/ssw0094' && req.method === 'POST') {
    const p = new URLSearchParams(body);
    return send(200, p.get('act') === 'P3' ? lista475() : '<html><body>A&ccedil;&atilde;o n&atilde;o dispon&iacute;vel na demonstra&ccedil;&atilde;o.</body></html>');
  }
  if (u.pathname === '/bin/menu01') { st.unit = String(u.searchParams.get('f2') || UNIDADES[0]).toUpperCase(); return send(200, '<script>location="ssw0198"</script>'); }
  if (u.pathname === '/bin/ssw0198' && u.searchParams.get('act') === 'ENV_ROM_COMPROV') return send(200, telaComprov(Number(u.searchParams.get('seq_romaneio'))));
  if (u.pathname === '/bin/ssw0198' && req.method === 'GET') return send(200, page38(ROMANEIOS.filter(r => r.un === st.unit)));
  if (u.pathname === '/bin/ssw0198' && req.method === 'POST') { const p = new URLSearchParams(body); return send(200, p.get('act') === 'PEN' ? pendXml(st.unit) : '<xml></xml>'); }
  return send(200, '<html><body>Tela n&atilde;o dispon&iacute;vel na demonstra&ccedil;&atilde;o.</body></html>');
}

let servidor = null, endereco = null;
// Sobe o servidor só uma vez, em 127.0.0.1 numa porta livre. Devolve a URL base.
function iniciar() {
  if (endereco) return endereco;
  endereco = new Promise((ok, falha) => {
    servidor = http.createServer((req, res) => atender(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }));
    servidor.on('error', e => { endereco = null; falha(e); });
    servidor.listen(Number(process.env.MOVIT_EXEMPLO_SSW_PORTA || 0), '127.0.0.1', () => ok('http://127.0.0.1:' + servidor.address().port));
    servidor.unref();
  });
  return endereco;
}

module.exports = { iniciar, UNIDADES, CTES, ROMANEIOS };
