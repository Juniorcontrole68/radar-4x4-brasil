// Leitor da CNH do motorista (tela de Lotação): textos no formato da CNH nova, da antiga e de OCR.
// Uso: node tests/cnh-leitor.js
const L=require('../../contas-a-pagar-v3/src/cnh-leitor.js');
let pass=0,fail=0;
function check(name,cond,extra=''){ if(cond){pass++;console.log('  OK   ',name)}else{fail++;console.log('  FALHA',name,extra);if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+String(name+' '+extra).replace(/\r?\n/g,' ').slice(0,300))} }
const eq=(name,a,b)=>check(name,a===b,'veio '+JSON.stringify(a)+', esperado '+JSON.stringify(b));

// Nº de registro com dígitos válidos que não é um CPF válido.
let REG='';
for(let n=451234567;!REG;n++){for(let a=0;a<100&&!REG;a++){const c=String(n).padStart(9,'0')+String(a).padStart(2,'0');if(L.registroValido(c)&&!L.cpfValido(c))REG=c}}

console.log('A. CNH nova (2022), texto do PDF da CNH digital');
let r=L.ler([
  'REPÚBLICA FEDERATIVA DO BRASIL','CARTEIRA NACIONAL DE HABILITAÇÃO',
  '2 e 1 NOME E SOBRENOME','JOSE CARLOS DA SILVA SANTOS',
  '3 DATA, LOCAL E UF DE NASCIMENTO','15/03/1980, CAMPINAS, SP',
  '4a DATA EMISSÃO 4b VALIDADE','10/01/2023 09/01/2033',
  '4c DOC. IDENTIDADE/ÓRG. EMISSOR/UF','23456789 SSP SP',
  '4d CPF 5 Nº REGISTRO','529.982.247-25 '+REG,
  '9 CAT. HAB.','AE','FILIAÇÃO','ANTONIO DA SILVA SANTOS','MARIA APARECIDA DA SILVA'
].join('\n'));
eq('nome',r.nome,'Jose Carlos da Silva Santos');
eq('CPF',r.cpf,'529.982.247-25');
eq('RG',r.rg,'23456789 SSP/SP');
eq('nº de registro',r.registro,REG);
eq('categoria',r.categoria,'AE');
eq('validade',r.validade,'2033-01-09');
eq('nascimento',r.nascimento,'1980-03-15');

console.log('B. CNH antiga (rótulo só "NOME")');
r=L.ler([
  'NOME','CLEBER CARDOSO DE SA',
  'DOC. IDENTIDADE / ÓRG. EMISSOR / UF','12.345.678-9 SSP SP',
  'CPF DATA NASCIMENTO','123.456.789-09 05/06/1975',
  'FILIAÇÃO','JOAO DE SA','ANA CARDOSO',
  'PERMISSÃO ACC CAT. HAB.','D',
  'Nº REGISTRO VALIDADE 1ª HABILITAÇÃO',REG+' 20/08/2028 12/02/1998'
].join('\n'));
eq('nome',r.nome,'Cleber Cardoso de Sa');
eq('CPF',r.cpf,'123.456.789-09');
eq('RG',r.rg,'12.345.678-9 SSP/SP');
eq('nº de registro',r.registro,REG);
eq('categoria',r.categoria,'D');
eq('validade',r.validade,'2028-08-20');

console.log('C. OCR de foto, tudo numa linha e com ruído');
r=L.ler('CARTEIRA NACIONAL DE HABILITACAO NOME E SOBRENOME MARCOS PAULO OLIVEIRA CPF 529 982 247 25 VALIDADE 01/02/2031 CAT HAB E 1a HABILITACAO 03/04/2005 nasc 07/07/1985');
eq('nome inline',r.nome,'Marcos Paulo Oliveira');
eq('CPF com espaços',r.cpf,'529.982.247-25');
eq('categoria',r.categoria,'E');
eq('validade',r.validade,'2031-02-01');

console.log('D. Não inventa dados');
r=L.ler('NOTA FISCAL ELETRÔNICA 12345678901 EMISSÃO 01/01/2024');
eq('CPF inválido não entra',r.cpf,'');
eq('sem nome',r.nome,'');
eq('uma data só não vira validade',r.validade,'');
r=L.ler('NOME\nFILIAÇÃO\nPAI DA SILVA');
eq('rótulo sem nome não pega filiação',r.nome,'');

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail?1:0);
