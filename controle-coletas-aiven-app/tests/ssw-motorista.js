'use strict';
// Leitura do cadastro de motoristas do SSW (dashboard/ssw-motorista.js): campos da pesquisa e
// endereço da casa. Roda sem rede e sem banco:  node tests/ssw-motorista.js
const path=require('path');
const m=require(path.join(__dirname,'..','dashboard','ssw-motorista.js'));
let ok=0,bad=0;
function check(name,cond,extra){
  if(cond){ok++;console.log('  ok   '+name)}
  else{bad++;console.log('  FALHA '+name+(extra!==undefined?'  -> '+JSON.stringify(extra):''));if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+name)}
}

console.log('Tela de pesquisa');
const form='<form><input type=hidden name=act value=""><table><tr><td>CPF do motorista:</td><td><input type=text name=f2 maxlength=11></td></tr>'+
  '<tr><td>Nome:</td><td><input type=text name=f3 maxlength=45></td></tr></table><a onclick="ajaxEnvia(\'PES\',1)">Pesquisar</a></form>';
let c=m.camposBusca(form);
check('acha o campo do CPF pelo rótulo',c.cpf==='f2',c);
check('acha o campo do nome pelo rótulo',c.nome==='f3',c);
check('ação do botão de pesquisa',m.acaoBusca(form)==='PES');
c=m.camposBusca('<form><input name=x1 maxlength=11 value=""></form>');
check('sem rótulo: o campo de 11 dígitos é o do CPF',c.cpf==='x1'&&c.nome==='',c);
check('sem ajaxEnvia: ação P1',m.acaoBusca('<form></form>')==='P1');

console.log('Cadastro');
const cad='<table><tr><td>CPF:</td><td><input name=a value="11122233344"></td><td>Nome:</td><td><input name=b value="MOTORISTA BIPAGEM"></td></tr>'+
  '<tr><td>Endere&ccedil;o:</td><td><input name=c value="RUA CONCEICAO TRAVAGLIA BLANCO"></td><td>N&uacute;mero:</td><td><input name=d value="80"></td></tr>'+
  '<tr><td>Bairro:</td><td><input name=e value="JARDIM SANTA CRUZ"></td><td>CEP:</td><td><input name=f value="13840-000"></td></tr>'+
  '<tr><td>Cidade:</td><td><input name=g value="MOGI GUACU"></td><td>UF:</td><td><input name=h value="SP"></td></tr><tr><td>Fone:</td><td><input name=i value="19999990000"></td></tr></table>';
let e=m.parseCadastro(cad);
check('rua, número, bairro, CEP, cidade e UF',e&&e.endereco==='RUA CONCEICAO TRAVAGLIA BLANCO'&&e.numero==='80'&&e.bairro==='JARDIM SANTA CRUZ'&&e.cep==='13840000'&&e.cidade==='MOGI GUACU'&&e.uf==='SP',e);
check('nome do cadastro (para conferir que é o motorista certo)',e&&e.nome==='MOTORISTA BIPAGEM',e);
e=m.parseCadastro('<div>Endereço: RUA DAS FLORES, 120 Bairro: CENTRO Município: AMERICANA/SP CEP: 13465-000</div>');
check('texto corrido: número junto da rua e "Cidade/UF"',e&&e.endereco==='RUA DAS FLORES'&&e.numero==='120'&&e.cidade==='AMERICANA'&&e.uf==='SP'&&e.cep==='13465000',e);
check('tela sem endereço: null',m.parseCadastro('<html><body>Motorista não cadastrado.</body></html>')===null);

console.log('Lista e nome');
const lista=m.parseLista('<table><tr><td>222.333.444-55</td><td>JOSE DA SILVA</td></tr><tr><td>333.444.555-66</td><td>JOSE DA SILVA</td></tr></table>');
check('lista de homônimos com o CPF de cada um',lista.length===2&&lista[0].cpf==='22233344455'&&lista[1].nome==='JOSE DA SILVA',lista);
check('mesmo nome sem acento e caixa',m.mesmoNome('José da Silva','JOSE DA SILVA'));
check('nome digitado sem o último sobrenome',m.mesmoNome('Motorista Bipagem','MOTORISTA BIPAGEM JUNIOR'));
check('nomes diferentes',!m.mesmoNome('JOAO','JOSE DA SILVA'));

console.log('\n'+ok+' ok, '+bad+' falha(s)');
process.exit(bad?1:0);
