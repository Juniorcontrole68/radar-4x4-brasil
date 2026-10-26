'use strict';
// Números fictícios da empresa de exemplo da demonstração (quem abriu o link de teste sem o login
// do SSW). Grava no esquema da própria empresa (esquemas-demo.js) uma operação de transportadora
// já em andamento: Lotação (coletas e clientes), Contas a Pagar, Frota e Despesas (DRE). As telas
// que leem o SSW usam o SSW de exemplo (ssw-exemplo.js). Testado em tests/movit-demo.js.

const crypto = require('crypto');
const { CTES } = require('./ssw-exemplo.js');

const dia = n => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };
const mes = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 8) + '01'; };
const chave = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const VEICULOS = [
  ['EXA1B23', 'Volvo', 'FH 540', 'Carreta', 412300, 'CARLOS ALBERTO SOUZA'], ['EXB2C34', 'Scania', 'R 450', 'Carreta', 389150, 'MARCOS VINICIUS LIMA'],
  ['EXC3D45', 'Mercedes-Benz', 'Atego 2430', 'Truck', 233400, 'JOSE ROBERTO ALVES'], ['EXD4E56', 'Volkswagen', 'Delivery 11.180', 'Toco', 158900, 'ANDRE LUIS PEREIRA'],
  ['EXE5F67', 'Iveco', 'Daily 35-150', 'Van', 98700, 'PAULO HENRIQUE COSTA'], ['EXF6G78', 'Mercedes-Benz', 'Accelo 1016', '3/4', 121500, 'RAFAEL GOMES SILVA'],
  ['EXG7H89', 'Volvo', 'VM 270', 'Truck', 276800, 'EDSON MARTINS ROCHA']
];
const LOTACOES = [
  // remetente, coleta, entrega, destinatário, caminhão, implemento, frete cobrado, frete pago, pedágio, dias (carregamento), status, veículo
  ['INDUSTRIA ALFA LTDA', 'Rodovia Anhanguera, km 100 - Campinas - SP', 'Av. Brasil, 2100 - Americana - SP', 'ATACADO NOVA ERA', 'Carreta', 'Baú', 4800, 3300, 180, -6, 'Entregue', 0],
  ['FABRICA BETA S/A', 'Rua Industrial, 55 - Sumaré - SP', 'Av. Jundiaí, 1500 - Jundiaí - SP', 'SUPERMERCADO ALIANCA', 'Truck', 'Sider', 2900, 2000, 96, -4, 'Entregue', 2],
  ['DISTRIBUIDORA GAMA', 'Av. das Indústrias, 900 - Hortolândia - SP', 'Rua Boa Morte, 355 - Limeira - SP', 'DISTRIBUIDORA SOL', 'Carreta', 'Graneleiro', 5200, 3700, 210, -3, 'Entregue', 1],
  ['COMERCIAL DELTA', 'Rua do Comércio, 12 - Valinhos - SP', 'Rua Gov. Pedro de Toledo, 640 - Piracicaba - SP', 'LOJA CASA BONITA', 'Toco', 'Baú', 1850, 1250, 64, -2, 'Coletada', 3],
  ['INDUSTRIA ALFA LTDA', 'Rodovia Anhanguera, km 100 - Campinas - SP', 'Av. Saudade, 516 - Mogi Mirim - SP', 'ELETRO CENTRO', 'Truck', 'Baú', 2600, 1800, 72, -1, 'Em trânsito', 6],
  ['FABRICA BETA S/A', 'Rua Industrial, 55 - Sumaré - SP', 'Rua Barão de Jaguara, 1200 - Campinas - SP', 'MERCADO BOM PRECO', 'Van', 'Baú', 950, 620, 0, 0, 'Em trânsito', 4],
  ['DISTRIBUIDORA GAMA', 'Av. das Indústrias, 900 - Hortolândia - SP', 'Rua Candelária, 72 - Indaiatuba - SP', 'MATERIAIS PRIMAVERA', '3/4', 'Baú', 1400, 950, 38, 1, 'Programada', 5],
  ['COMERCIAL DELTA', 'Rua do Comércio, 12 - Valinhos - SP', 'Av. José Paulino, 980 - Paulínia - SP', 'PADARIA ESTRELA', 'Carreta', 'Sider', 4300, 3000, 150, 2, 'Programada', 0]
];
const CONTAS = [
  // descrição, fornecedor, área, categoria, valor, vencimento (dias), paga
  ['Diesel S10 - frota', 'Posto Rodovia Ltda', 'Empresa', 'Combustível', 18450.9, -8, true], ['Manutenção freios EXC3D45', 'Oficina Diesel Forte', 'Empresa', 'Manutenção', 2380, -3, true],
  ['Seguro da frota (parcela 4/12)', 'Seguradora Estrada Segura', 'Empresa', 'Seguros', 3920, 2, false], ['Pneus 295/80 (4 unidades)', 'Pneus Campinas', 'Empresa', 'Pneus', 7600, 5, false],
  ['Aluguel do galpão', 'Imobiliária Centro', 'Empresa', 'Aluguel', 12500, 6, false], ['Sistema de rastreamento', 'Rastreia Bem Ltda', 'Empresa', 'Sistemas', 690, 9, false],
  ['Energia elétrica', 'Companhia de Energia', 'Empresa', 'Utilidades', 1840.37, 12, false], ['Contabilidade', 'Escritório Contábil Exato', 'Empresa', 'Serviços', 1500, 15, false]
];
const DRE = [['combustivel', 'Diesel do mês', 52300], ['manutencao', 'Manutenções e peças', 8900], ['pneus', 'Pneus', 7600], ['pedagio', 'Pedágios', 6100],
  ['salarios', 'Folha de pagamento', 38000], ['encargos', 'Encargos da folha', 11400], ['aluguel', 'Aluguel do galpão', 12500], ['sistemas', 'Sistemas', 1890], ['seguros', 'Seguro da frota', 3920]];

// Preenche uma vez; a pool já roda no esquema da empresa (chamar dentro de esquemasDemo.rodar).
async function preencher(pool, clientId) {
  if ((await pool.query('SELECT 1 FROM coletas LIMIT 1')).rowCount) return false;
  for (const [i, l] of LOTACOES.entries()) {
    const [rem, col, ent, dest, cam, impl, cobrado, pago, ped, d, status, vi] = l, v = VEICULOS[vi];
    await pool.query(`INSERT INTO coletas(client_id,cliente,endereco_coleta,endereco_entrega,destinatario,tipo_caminhao,implemento,frete_cobrado,frete_pago,pedagio,lucro,
        data_carregamento,data_descarga,previsao_entrega,status,motorista,placa,os_numero,peso_total,quantidade_paletes,recebido,data_recebimento,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW())`,
    [clientId, rem, col, ent, dest, cam, impl, cobrado, pago, ped, cobrado - pago - ped, dia(d), status === 'Entregue' ? dia(d + 1) : null, dia(d + 1), status, v[5], v[0],
      'OS-' + (2400 + i), 4000 + i * 1750, 8 + i * 2, status === 'Entregue' && i < 2, status === 'Entregue' && i < 2 ? dia(d + 3) : null]);
  }
  for (const c of Object.values(CTES).slice(0, 12)) {
    await pool.query(`INSERT INTO lotacao_clientes(client_id,nome,nome_key,endereco,bairro,cidade,uf,cep) VALUES($1,$2,$3,$4,$5,$6,'SP',$7) ON CONFLICT DO NOTHING`,
      [clientId, c.nome, chave(c.nome), c.lgr + ', ' + c.num, c.bairro, c.cid, c.cep]);
  }
  for (const [desc, forn, area, cat, valor, d, paga] of CONTAS) {
    await pool.query(`INSERT INTO bills(id,description,supplier,area,category,amount,due_date,original_due_date,status,payment_date,client_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10)`,
      [crypto.randomUUID(), desc, forn, area, cat, valor, dia(d), paga ? 'paid' : 'pending', paga ? dia(d) : null, clientId]);
  }
  const fuel = [], maintenance = [];
  VEICULOS.forEach(([plate, , , , km, driver], i) => {
    for (let k = 0; k < 3; k++) {
      const liters = 180 + ((i * 37 + k * 53) % 220), price = 6.09 + (k % 2) * 0.1;
      fuel.push({ id: 'ex-f' + i + k, date: dia(-2 - k * 4 - i % 3), plate, driver, liters, price, total: Math.round(liters * price * 100) / 100, km: km - k * 1400 });
    }
    if (i % 2 === 0) maintenance.push({ id: 'ex-m' + i, date: dia(-10 - i), plate, service: ['Troca de óleo e filtros', 'Revisão de freios', 'Alinhamento e balanceamento', 'Troca de embreagem'][i % 4], km: km - 5000, workshop: 'Oficina Diesel Forte', nextKm: km + 15000, cost: 850 + i * 310, status: 'Concluída' });
  });
  const data = {
    vehicles: VEICULOS.map(([plate, brand, model, type, km, driver], i) => ({ id: 'ex-v' + i, plate, brand, model, type, km, driver, status: 'Ativo' })),
    fuel, maintenance, tires: [], documents: [], checklists: [],
    people: VEICULOS.map(([, , , , , name], i) => ({ id: 'ex-p' + i, name, role: 'Motorista', cnh: String(40000000000 + i * 7919), cnhExpiry: dia(200 + i * 45), phone: '(19) 9' + String(8100 + i) + '-' + String(1000 + i * 111).slice(0, 4), status: 'Ativo' }))
  };
  await pool.query("INSERT INTO fleet_state(id,data,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()", [JSON.stringify(data)]);
  for (const m of [-2, -1, 0]) for (const [conta, desc, valor] of DRE) {
    await pool.query('INSERT INTO dre_lancamentos(client_id,competencia,conta,descricao,valor,origem,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [clientId, mes(m), conta, desc, Math.round(valor * (1 + m * 0.04) * 100) / 100, 'manual', 'exemplo']);
  }
  return true;
}

module.exports = { preencher };
