/* Dados de demonstração: notas fictícias marcadas como DEMO, produtos e cidades de exemplo. */
(function (G) {
  'use strict';
  const RE = G.RE || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const D = {};
  D.PRODUTOS = [
    { id: 'p-pvc100', codigo: 'TES100', padrao: 'TUBO ESGOTO 100MM', tipo: 'tubo', diamExtMm: 100, espMm: 1.8, comprM: 6, pesoUnitKg: 4.8, material: 'PVC', encaixavel: true },
    { id: 'p-pvc150', codigo: 'TES150', padrao: 'TUBO ESGOTO 150MM', tipo: 'tubo', diamExtMm: 150, espMm: 3.6, comprM: 6, pesoUnitKg: 14.1, material: 'PVC', encaixavel: true },
    { id: 'p-pvc200', codigo: 'TES200', padrao: 'TUBO ESGOTO 200MM', tipo: 'tubo', diamExtMm: 200, espMm: 4.9, comprM: 6, pesoUnitKg: 25.5, material: 'PVC', encaixavel: true },
    { id: 'p-pead300', codigo: 'PEAD300', padrao: 'TUBO PEAD 300MM', tipo: 'tubo', diamExtMm: 315, espMm: 18.7, comprM: 6, pesoUnitKg: 103, material: 'PEAD', encaixavel: true },
    { id: 'p-sold25', codigo: 'TSO25', padrao: 'TUBO SOLDAVEL 25MM', tipo: 'tubo', diamExtMm: 25, espMm: 1.7, comprM: 6, pesoUnitKg: 1.1, material: 'PVC', encaixavel: true },
    { id: 'p-sold50', codigo: 'TSO50', padrao: 'TUBO SOLDAVEL 50MM', tipo: 'tubo', diamExtMm: 50, espMm: 2.4, comprM: 6, pesoUnitKg: 3.2, material: 'PVC', encaixavel: true },
    { id: 'p-sold75', codigo: 'TSO75', padrao: 'TUBO SOLDAVEL 75MM', tipo: 'tubo', diamExtMm: 75, espMm: 3.6, comprM: 6, pesoUnitKg: 7.2, material: 'PVC', encaixavel: true },
    { id: 'p-cx1000', codigo: 'CX1000', padrao: 'CAIXA D AGUA 1000L', tipo: 'caixa_agua', volUnitM3: 1.45, pesoUnitKg: 21 },
    { id: 'p-cx500', codigo: 'CX500', padrao: 'CAIXA D AGUA 500L', tipo: 'caixa_agua', volUnitM3: 0.78, pesoUnitKg: 12 },
    { id: 'p-joe100', codigo: 'JOE100', padrao: 'JOELHO 90 ESGOTO 100MM', tipo: 'conexao', volUnitM3: 0.0021, pesoUnitKg: 0.19 },
    { id: 'p-luva50', codigo: 'LUV50', padrao: 'LUVA SOLDAVEL 50MM', tipo: 'conexao', volUnitM3: 0.0004, pesoUnitKg: 0.05 },
    { id: 'p-cim', codigo: 'CIM50', padrao: 'CIMENTO CP II 50KG', tipo: 'outro', volUnitM3: 0.036, pesoUnitKg: 50 },
    { id: 'p-cola', codigo: 'COL850', padrao: 'ADESIVO PVC 850G', tipo: 'outro', volUnitM3: 0.0015, pesoUnitKg: 0.95 },
    { id: 'p-reg', codigo: 'REG25', padrao: 'REGISTRO GAVETA 3/4', tipo: 'conexao', volUnitM3: 0.0009, pesoUnitKg: 0.42 },
  ];
  // cidades: dias 0=dom..6=sáb. Exemplos da especificação; substituir pelo calendário real.
  D.CIDADES = [
    { id: '3509502', nome: 'Campinas', uf: 'SP', dias: [1, 2, 3, 4, 5] },
    { id: '3538709', nome: 'Piracicaba', uf: 'SP', dias: [2, 4] },
    { id: '3526902', nome: 'Limeira', uf: 'SP', dias: [1, 3, 5] },
    { id: '3543907', nome: 'Rio Claro', uf: 'SP', dias: [2, 5] },
    { id: '3520509', nome: 'Indaiatuba', uf: 'SP', dias: [1, 3, 5] },
    { id: '3501608', nome: 'Americana', uf: 'SP', dias: [1, 2, 3, 4, 5] },
    { id: '3552403', nome: 'Sumaré', uf: 'SP', dias: [1, 2, 3, 4, 5] },
    { id: '3545803', nome: "Santa Bárbara d'Oeste", uf: 'SP', dias: [1, 2, 3, 4, 5] },
    { id: '3533403', nome: 'Nova Odessa', uf: 'SP', dias: [1, 3, 5] },
    { id: '3519071', nome: 'Hortolândia', uf: 'SP', dias: [2, 4] },
  ].map((c) => Object.assign({ horaIni: '08:00', horaFim: '17:30', descargaMin: 15, prioridade: 2, tiposPermitidos: ['fiorino', 'van', 'tubos'], pedagio: 0, freteKg: 0, freteMin: 0, fretePct: 0, restricoes: '', obs: 'Dias de exemplo da especificação' }, c));

  const CLIENTES = [
    ['Casa das Construções Ltda', '11222333000181', 'Av. Brasil', '1500', 'Centro', '3509502', 'Campinas', '13013000'],
    ['Hidráulica Paulista ME', '22333444000172', 'Rua Barão de Jaguara', '410', 'Centro', '3509502', 'Campinas', '13015001'],
    ['Depósito Piracicabano', '33444555000163', 'Av. Independência', '2100', 'Alto', '3538709', 'Piracicaba', '13416000'],
    ['Materiais Limeira S/A', '44555666000154', 'Rua Santa Cruz', '88', 'Centro', '3526902', 'Limeira', '13480041'],
    ['Rio Claro Hidráulica', '55666777000145', 'Av. 1', '700', 'Centro', '3543907', 'Rio Claro', '13500000'],
    ['Indaiá Tubos e Conexões', '66777888000136', 'Av. Presidente Vargas', '950', 'Cidade Nova', '3520509', 'Indaiatuba', '13330000'],
    ['Sumaré Construção', '77888999000127', 'Rua Dom Barreto', '320', 'Centro', '3552403', 'Sumaré', '13170000'],
    ['Saneamento Oeste Obras', '88999000000118', "Av. Santa Bárbara", '1200', 'Centro', '3545803', "Santa Bárbara d'Oeste", '13450000'],
    ['Nova Odessa Materiais', '99000111000109', 'Av. Ampélio Gazzetta', '45', 'Centro', '3533403', 'Nova Odessa', '13380000'],
    ['Hortolândia Obras Civis', '10111222000190', 'Rua José Camilo', '77', 'Remanso', '3519071', 'Hortolândia', '13184000'],
    ['Construtora Vale Verde', '12121212000112', 'Rod. Anhanguera km 103', 's/n', 'Distrito Industrial', '3509502', 'Campinas', '13064000'],
    ['Loja do Encanador', '13131313000113', 'Rua XV de Novembro', '901', 'Centro', '3538709', 'Piracicaba', '13400370'],
  ];
  const ITENS = [
    [['TUBO ESGOTO 100MM 6M', 'TES100', 'BR', 10, 32.5], ['JOELHO 90 ESGOTO 100MM', 'JOE100', 'UN', 12, 6.9]],
    [['TUBO ESGOTO 150MM 6M', 'TES150', 'BR', 4, 118], ['TUBO ESGOTO 100MM 6M', 'TES100', 'BR', 6, 32.5], ['TUBO SOLDAVEL 50MM 6M', 'TSO50', 'BR', 8, 41]],
    [['CAIXA D AGUA 1000L POLIETILENO', 'CX1000', 'UN', 2, 489], ['ADESIVO PVC 850G', 'COL850', 'UN', 4, 62]],
    [['TUBO PEAD 300MM PE100 SDR17 6M', 'PEAD300', 'BR', 2, 1650], ['TUBO ESGOTO 200MM 6M', 'TES200', 'BR', 3, 210], ['TUBO SOLDAVEL 75MM 6M', 'TSO75', 'BR', 4, 96]],
    [['CIMENTO CP II 50KG', 'CIM50', 'SC', 12, 36], ['REGISTRO GAVETA 3/4', 'REG25', 'UN', 6, 54]],
    [['TUBO SOLDAVEL 25MM 6M', 'TSO25', 'BR', 30, 17.9], ['LUVA SOLDAVEL 50MM', 'LUV50', 'UN', 40, 1.8]],
    [['CAIXA D AGUA 500L POLIETILENO', 'CX500', 'UN', 1, 299], ['TUBO SOLDAVEL 50MM 6M', 'TSO50', 'BR', 6, 41]],
    [['TUBO ESGOTO 200MM 6M', 'TES200', 'BR', 2, 210], ['TUBO ESGOTO 150MM 6M', 'TES150', 'BR', 2, 118], ['TUBO ESGOTO 100MM 6M', 'TES100', 'BR', 4, 32.5]],
  ];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dv = (c43) => { let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += (+c43[i]) * p; p = p === 9 ? 2 : p + 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  D.notasXML = (dataBase) => {
    const out = [];
    const prods = Object.fromEntries(D.PRODUTOS.map((p) => [p.codigo, p]));
    const CID = [['3509502', 'Campinas', '130'], ['3509502', 'Campinas', '130'], ['3509502', 'Campinas', '130'], ['3552403', 'Sumaré', '131'], ['3519071', 'Hortolândia', '131'], ['3501608', 'Americana', '134'], ['3501608', 'Americana', '134'], ['3545803', "Santa Bárbara d'Oeste", '134'], ['3533403', 'Nova Odessa', '133'], ['3520509', 'Indaiatuba', '133'], ['3526902', 'Limeira', '134'], ['3526902', 'Limeira', '134'], ['3538709', 'Piracicaba', '134'], ['3538709', 'Piracicaba', '134'], ['3543907', 'Rio Claro', '135']];
    const LOJA = ['Depósito', 'Materiais', 'Hidráulica', 'Casa do Construtor', 'Elétrica e Hidráulica', 'Acabamentos', 'Construção', 'Obras', 'Loja de Tintas e Tubos', 'Material de Construção'];
    const SOBR = ['Silva', 'Souza', 'Oliveira', 'Pereira', 'Lima', 'Ferreira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Carvalho', 'Gomes', 'Martins', 'Araújo', 'Ribeiro', 'Barbosa', 'Rocha', 'Dias', 'Teixeira', 'Moreira'];
    const RUAS = ['Rua das Palmeiras', 'Av. Brasil', 'Rua São Paulo', 'Rua Sete de Setembro', 'Av. das Indústrias', 'Rua Tiradentes', 'Rua Rio Branco', 'Av. Independência', 'Rua XV de Novembro', 'Rua Campos Sales'];
    const LEVES = [
      [['TUBO SOLDAVEL 25MM 6M', 'TSO25', 'BR', 6, 17.9], ['LUVA SOLDAVEL 50MM', 'LUV50', 'UN', 10, 1.8]],
      [['TUBO ESGOTO 100MM 6M', 'TES100', 'BR', 3, 32.5], ['JOELHO 90 ESGOTO 100MM', 'JOE100', 'UN', 6, 6.9]],
      [['ADESIVO PVC 850G', 'COL850', 'UN', 3, 62], ['REGISTRO GAVETA 3/4', 'REG25', 'UN', 4, 54]],
      [['TUBO SOLDAVEL 50MM 6M', 'TSO50', 'BR', 4, 41], ['TUBO SOLDAVEL 25MM 6M', 'TSO25', 'BR', 4, 17.9]],
      [['CIMENTO CP II 50KG', 'CIM50', 'SC', 2, 36], ['ADESIVO PVC 850G', 'COL850', 'UN', 2, 62]],
      [['CAIXA D AGUA 500L POLIETILENO', 'CX500', 'UN', 1, 299]],
      [['TUBO ESGOTO 150MM 6M', 'TES150', 'BR', 1, 118], ['TUBO ESGOTO 100MM 6M', 'TES100', 'BR', 2, 32.5]],
      [['JOELHO 90 ESGOTO 100MM', 'JOE100', 'UN', 20, 6.9], ['LUVA SOLDAVEL 50MM', 'LUV50', 'UN', 20, 1.8]],
    ];
    const N = 110;
    for (let k = 0; k < N; k++) {
      let c;
      if (k < 18) c = CLIENTES[k % CLIENTES.length];
      else {
        const j = k - 18, cd = CID[(j * 7) % CID.length];
        c = [LOJA[j % LOJA.length] + ' ' + SOBR[(j * 3) % SOBR.length] + (j >= 40 ? ' ' + (j % 7 + 2) : ''), String(20000000000100 + j * 101), RUAS[(j * 5) % RUAS.length], String(100 + (j * 37) % 1900), 'Centro', cd[0], cd[1], cd[2] + String(10000 + j * 13).slice(-5)];
      }
      const semPeso = k === 16; // uma nota com pendências (sem peso e tubo em polegadas), para a revisão
      const itens = semPeso ? ITENS[(k * 3) % ITENS.length].concat([['TUBO GALVANIZADO 2" 6,00 M', 'GALV2', 'BR', 5, 189]]) : k < 18 ? ITENS[(k * 3) % ITENS.length] : LEVES[(k * 5) % LEVES.length];
      const nNF = 4100 + k;
      const emis = RE.addDays(dataBase, -((k % 3) + 1));
      const c43 = '35' + emis.slice(2, 4) + emis.slice(5, 7) + '98765432000110' + '55' + '001' + String(nNF).padStart(9, '0') + '1' + String(10000000 + k * 7919).slice(-8);
      const chave = c43 + dv(c43);
      let vProd = 0, peso = 0;
      const det = itens.map(([desc, cod, un, q, vu], i) => {
        const v = Math.round(q * vu * 100) / 100; vProd += v;
        peso += ((prods[cod] || {}).pesoUnitKg || 0) * q;
        return '<det nItem="' + (i + 1) + '"><prod><cProd>' + cod + '</cProd><xProd>' + esc(desc) + '</xProd><NCM>39172300</NCM><uCom>' + un + '</uCom><qCom>' + q + '.0000</qCom><vUnCom>' + vu + '</vUnCom><vProd>' + v.toFixed(2) + '</vProd></prod></det>';
      }).join('');
      const frete = Math.round((140 + peso * 0.95) * 100) / 100;
      const xml = '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe' + chave + '" versao="4.00">' +
        '<ide><cUF>35</cUF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>' + nNF + '</nNF><dhEmi>' + emis + 'T09:12:00-03:00</dhEmi><tpNF>1</tpNF></ide>' +
        '<emit><CNPJ>98765432000110</CNPJ><xNome>DEMO Distribuidora Hidráulica Ltda</xNome></emit>' +
        '<dest><CNPJ>' + c[1] + '</CNPJ><xNome>' + esc('DEMO ' + c[0]) + '</xNome><enderDest><xLgr>' + esc(c[2]) + '</xLgr><nro>' + c[3] + '</nro><xBairro>' + c[4] + '</xBairro><cMun>' + c[5] + '</cMun><xMun>' + esc(c[6]) + '</xMun><UF>SP</UF><CEP>' + c[7] + '</CEP><fone>1934000000</fone></enderDest></dest>' +
        det +
        '<total><ICMSTot><vProd>' + vProd.toFixed(2) + '</vProd><vFrete>' + frete.toFixed(2) + '</vFrete><vNF>' + (vProd + frete).toFixed(2) + '</vNF></ICMSTot></total>' +
        '<transp><modFrete>0</modFrete><vol><qVol>' + itens.reduce((s, x) => s + x[3], 0) + '</qVol><esp>VOLUMES</esp>' + (semPeso ? '' : '<pesoL>' + (peso * 0.97).toFixed(3) + '</pesoL><pesoB>' + peso.toFixed(3) + '</pesoB>') + '</vol></transp>' +
        '<infAdic><infCpl>NOTA DE DEMONSTRACAO - ROTEIRIZADOR</infCpl></infAdic></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>' + chave + '</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>';
      out.push({ nome: 'NFe' + chave + '.xml', xml });
    }
    return out;
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = D; else G.DEMO = D;
})(typeof globalThis !== 'undefined' ? globalThis : this);
