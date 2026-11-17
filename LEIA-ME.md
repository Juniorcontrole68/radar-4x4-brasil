# Loterias: Mega-Sena e Quina

App que roda no seu computador: baixa os resultados oficiais da Caixa, mostra estatísticas dos últimos 25, 50 e 100 concursos, gera a quantidade de jogos que você pedir, salva e confere os acertos.

## Como abrir
1. Tenha o Python 3 instalado (Windows: https://www.python.org/downloads/ e marque "Add Python to PATH").
2. Windows: dê dois cliques em **Abrir Loterias (Windows).bat**. Mac/Linux: **Abrir Loterias (Mac-Linux).command** (ou `python3 loterias.py`).
3. O navegador abre sozinho em http://127.0.0.1:8765. Deixe a janela preta aberta enquanto usa.

## Abas
- **Gerar jogos**: quantidade, dezenas por jogo, base (25, 50, 100 ou combinada), estilo e filtros. Dá para fixar ou excluir dezenas.
- **Estatísticas**: mapa de frequência, mais e menos sorteadas, atrasadas e comparativo 25/50/100.
- **Resultados**: concursos anteriores e o próximo concurso com prêmio estimado.
- **Meus jogos e conferência**: jogos salvos, acertos de cada um no concurso para o qual foram feitos, e conferência contra os últimos 25/50/100 concursos. Também aceita jogos feitos na lotérica.

## Como apostar
Clique em **Apostar no site da Caixa**: os jogos são copiados e o Loterias Online da Caixa abre. Marque as dezenas lá (ou no app Loterias CAIXA) e pague no ambiente oficial.

## Onde ficam os dados
Na pasta `dados/` ao lado do app (`jogos_salvos.json` e os resultados baixados). Faça cópia dessa pasta se quiser backup.

## Aviso honesto
Cada sorteio é independente. Estatísticas do passado não aumentam a chance de acerto; servem só como estilo de escolha. Jogue com responsabilidade.
