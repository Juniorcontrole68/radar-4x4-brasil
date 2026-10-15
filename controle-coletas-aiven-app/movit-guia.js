'use strict';
// Passo a passo da Torre de Controle para as transportadoras clientes da MOVIT (demonstração,
// teste grátis e contratadas). A ordem segue o caminho da operação, do cadastro da equipe até o
// financeiro, para o usuário não se perder. Cada passo pertence a um módulo da plataforma
// (movit_modules) e só aparece quando a empresa tem esse módulo. Quando existe o vídeo
// videos/<modulo>.mp4 e a MOVIT Central deixou o vídeo ligado para a empresa, o passo mostra o botão
// do vídeo. O progresso (passos concluídos) fica guardado por usuário.
// Testado em tests/movit-demo.js.

const fs = require('fs');
const path = require('path');

const VIDEOS_DIR = path.join(__dirname, 'videos');

// tela: data-module da aba em painel.html que o botão "Abrir" abre ('' = sem aba própria)
const PASSOS = [
  { id: 'ssw', modulo: 'ssw', tela: '', titulo: 'Conferir a conexão com o SSW',
    para_que: 'A Torre de Controle lê os dados da sua empresa direto do SSW, com o seu login.',
    passos: ['Veja abaixo se a conexão aparece como conectada.', 'Se aparecer erro, saia e entre de novo com o login do SSW.'] },
  { id: 'usuarios', modulo: 'usuarios', tela: 'usuarios', titulo: 'Cadastrar a sua equipe',
    para_que: 'Cada pessoa entra com o próprio usuário e vê só os módulos liberados para ela.',
    passos: ['Abra Usuários.', 'Crie os grupos de acesso (por exemplo: Operação, Financeiro) e marque os módulos de cada grupo.', 'Cadastre cada pessoa e escolha o grupo dela.'] },
  { id: 'coletas', modulo: 'coletas', tela: 'coletas', titulo: 'Registrar as coletas de lotação',
    para_que: 'Controla cada coleta, do pedido do cliente até a entrega, com frete cobrado, frete pago e lucro.',
    passos: ['Abra Coletas.', 'Clique em nova coleta e preencha cliente, endereços, motorista e valores.', 'Atualize o status conforme a carga anda.'] },
  { id: 'financeiro_lotacao', modulo: 'financeiro_lotacao', tela: 'financeiro-lotacao', titulo: 'Acompanhar o financeiro da lotação',
    para_que: 'Mostra quanto cada coleta deu de lucro e o que falta receber e pagar.',
    passos: ['Abra Financeiro Lotação.', 'Escolha o período.', 'Confira os valores a receber, a pagar e o lucro.'] },
  { id: 'agendamento', modulo: 'agendamento', tela: 'agendamento-teste', titulo: 'Registrar os agendamentos de entrega',
    para_que: 'Busca a nota no SSW e registra se a entrega foi agendada e para quando.',
    passos: ['Abra Agendamento.', 'Digite o número da nota fiscal e clique em Buscar no SSW.', 'Informe se houve agendamento e a data, e salve.'] },
  { id: 'roteirizador', modulo: 'roteirizador', tela: 'roteirizador-cargas', titulo: 'Montar as cargas no Roteirizador',
    para_que: 'Distribui as notas entre os veículos e monta a rota de cada um, respeitando peso e volume.',
    passos: ['Abra o Roteirizador.', 'Cadastre os veículos e os motoristas (uma vez só).', 'Importe as notas do dia.', 'Gere o plano e ajuste o que precisar.'] },
  { id: 'montar_carga', modulo: 'roteirizador', tela: 'carga', titulo: 'Conferir a carga bipando os CT-es',
    para_que: 'Na hora de carregar, bipe cada CT-e para conferir que tudo foi para o caminhão certo.',
    passos: ['Abra Montar carga.', 'Escolha o motorista.', 'Bipe os CT-es com o leitor ou digite o número.', 'Envie a carga para o motorista.'] },
  { id: 'rastreio', modulo: 'rastreio', tela: 'tracking', titulo: 'Acompanhar os motoristas no mapa',
    para_que: 'Mostra onde cada motorista está e quais entregas faltam, em tempo real.',
    passos: ['Instale o aplicativo do motorista no celular dele.', 'Aprove o celular em Rastreio de Carga.', 'Acompanhe as rotas do dia no mapa.'] },
  { id: 'operacao', modulo: 'operacao', tela: 'lancamentos', titulo: 'Fazer os lançamentos do dia',
    para_que: 'Registra quilometragem, entregas realizadas e retorno de cada romaneio.',
    passos: ['Abra Lançamentos.', 'Escolha o romaneio.', 'Preencha os dados do dia e salve.'] },
  { id: 'visao_geral', modulo: 'visao_geral', tela: 'dashboard', titulo: 'Ver a operação em um só lugar',
    para_que: 'Resume entregas, atrasos e desempenho dos motoristas do dia.',
    passos: ['Abra Visão Geral.', 'Escolha a data.', 'Clique em um número para ver os detalhes.'] },
  { id: 'dashboards', modulo: 'dashboards', tela: 'dashboards', titulo: 'Analisar os indicadores',
    para_que: 'Gráficos de entregas, receita, atrasos e clientes ao longo do tempo.',
    passos: ['Abra Dashboards.', 'Escolha o período.', 'Use os gráficos para comparar meses e clientes.'] },
  { id: 'financeiro_operacoes', modulo: 'financeiro_operacoes', tela: 'fin-op', titulo: 'Conferir o financeiro da operação',
    para_que: 'Mostra o resultado financeiro por motorista e por rota.',
    passos: ['Abra Financeiro.', 'Escolha o período.', 'Confira o resultado de cada motorista.'] },
  { id: 'frota', modulo: 'frota', tela: 'frota', titulo: 'Controlar a frota',
    para_que: 'Guarda os veículos, as manutenções e os documentos de cada um.',
    passos: ['Abra Frota.', 'Cadastre os veículos.', 'Registre as manutenções e anexe as notas.'] },
  { id: 'contas_pagar', modulo: 'contas_pagar', tela: 'contas', titulo: 'Organizar as contas a pagar',
    para_que: 'Lista as contas da empresa com vencimento, valor e situação.',
    passos: ['Abra Contas a Pagar.', 'Cadastre as contas (inclusive as que se repetem todo mês).', 'Marque como paga quando pagar.'] },
  { id: 'app_movit', modulo: 'app_movit', tela: '', titulo: 'Usar o aplicativo MOVIT',
    para_que: 'O aplicativo do motorista mostra a rota do dia e envia a posição para a central.',
    passos: ['Peça à MOVIT o link de instalação.', 'Instale no celular do motorista.', 'O motorista entra e já recebe a rota do dia.'] }
];

function videoExiste(modulo) {
  try { return fs.statSync(path.join(VIDEOS_DIR, modulo + '.mp4')).isFile(); } catch { return false; }
}
// Passos da empresa: só os módulos dela, na ordem acima. O passo "ssw" só vale na demonstração.
// videosLigados: módulos com o vídeo ligado na MOVIT Central para esta empresa.
function montar({ modulos, feitos, videosLigados, demo }) {
  const tem = new Set(modulos || []), ok = new Set(feitos || []), vid = new Set(videosLigados || []);
  return PASSOS
    .filter(p => p.modulo === 'ssw' ? !!demo : tem.has(p.modulo))
    .map(p => ({ ...p, feito: ok.has(p.id), video: vid.has(p.modulo) && videoExiste(p.modulo) ? '/videos/' + p.modulo + '.mp4' : '' }));
}
// Caminho do arquivo de vídeo pedido em /videos/<modulo>.mp4 (null se não existir ou nome inválido).
function arquivoVideo(nome) {
  const m = /^([a-z_]{2,40})\.mp4$/.exec(String(nome || ''));
  if (!m || !videoExiste(m[1])) return null;
  return path.join(VIDEOS_DIR, m[1] + '.mp4');
}
const IDS = new Set(PASSOS.map(p => p.id));

module.exports = { PASSOS, IDS, montar, arquivoVideo };
