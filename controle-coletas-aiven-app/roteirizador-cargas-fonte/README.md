# Roteirizador de Cargas — fontes

A página `../roteirizador-cargas.html` é gerada daqui com `python3 build.py`. Não edite a página gerada.

- `engine.js` — motor: leitura de NF-e (XML, PDF, planilha), cadastro de produtos, encaixe de tubos, carga, roteirização com frota mista, mínimo de entregas, prioridades e custos.
- `app.js` — telas (Painel, Notas, Sobras, Rotas, Carga, Relatórios, Cadastros, Ajustes).
- `rc-host.js` — ponte com o CONSTRULOG: grava os documentos em `/api/rc/*` (ver `../roteirizador-cargas.js`), lê os CTRCs disponíveis do SSW (`/api/programacao-entregas/disponiveis`), a Frota e o Rastreio de carga.
- `shell.html` — estilos e casca da página. `mun.txt` — municípios do IBGE com coordenadas. `demo.js` — dados de demonstração (desligados dentro do CONSTRULOG).
- `test.js` — testes do motor: `node test.js`.
