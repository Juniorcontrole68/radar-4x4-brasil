// Testa os leitores de valor e de data do app.js (extraídos do arquivo real).
const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','dashboard','public','app.js'),'utf8');
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<0)throw new Error('trecho não encontrado: '+a);return src.slice(i,j)};
const {pd,num}=new Function(cut('const pd=s=>{','const iso=d=>')+'\n'+cut('const num=v=>{','\nconst brl=')+'\nreturn {pd,num};')();
const f=d=>d?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'):null;
let ok=0,fail=0;const t=(name,got,exp)=>{if(Object.is(got,exp)||got===exp){ok++}else{fail++;console.log('  FALHA',name,'->',got,'(esperado',exp+')');if(process.env.GITHUB_ACTIONS)console.log('::error title=Teste falhou::'+name+' -> '+got+' (esperado '+exp+')')}};
const N=[['R$ 1.234,56',1234.56],['1.500',1500],['R$ 1.500',1500],['1500',1500],['1.234.567',1234567],['(1.234,56)',-1234.56],['-1.234,56',-1234.56],['1.234,56-',-1234.56],['1,5',1.5],['12,50',12.5],['0,125',0.125],['12.50',12.5],['0.125',0.125],['1500.75',1500.75],['',0],[null,0],[42,42],['R$ 0,00',0],['abc',0],['10-20',0],['-',0],['  2.000,00 ',2000],['35',35],['1.5',1.5],['R$ -350,00',-350]];
for(const [v,e] of N)t('num('+JSON.stringify(v)+')',num(v),e);
const D=[['05/10/2026','2026-10-05'],['5/10/26','2026-10-05'],['05.10.2026','2026-10-05'],['05-10-2026','2026-10-05'],['2026-10-05','2026-10-05'],['2026-10-05T14:30:00Z','2026-10-05'],['05/10/2026 14:30','2026-10-05'],['45935','2025-10-05'],[45935,'2025-10-05'],['05/10',null],['31/02/2026',null],['13/13/2026',null],['',null],[null,null],['texto',null],['10/13/2026',null],['1/1/2026','2026-01-01'],['29/02/2024','2024-02-29']];
for(const [v,e] of D)t('pd('+JSON.stringify(v)+')',f(pd(v)),e);
console.log('leitores de valor e data:',ok,'OK,',fail,'falha(s)');process.exit(fail?1:0);
