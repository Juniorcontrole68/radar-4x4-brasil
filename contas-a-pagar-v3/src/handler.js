const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {pool,getBills}=require('./db');
const {titleCase,today}=require('./utils');
const PUBLIC=path.join(__dirname,'..','public');
function sendFile(res,file,type){res.writeHead(200,{'Content-Type':type,'Cache-Control':file==='index.html'?'no-store':'public, max-age=300'});res.end(fs.readFileSync(path.join(PUBLIC,file)));}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function readJson(req){return new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1_000_000)reject(new Error('Requisicao muito grande'));});req.on('end',()=>{try{resolve(d?JSON.parse(d):{});}catch{reject(new Error('JSON invalido'));}});req.on('error',reject);});}
async function handler(req,res){
 try{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/') return sendFile(res,'index.html','text/html; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/styles.css') return sendFile(res,'styles.css','text/css; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/app.js') return sendFile(res,'app.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/health'){await pool.query('SELECT 1');return json(res,200,{ok:true,database:'connected'});}
  if(req.method==='GET'&&u.pathname==='/api/bills') return json(res,200,await getBills());
  if(req.method==='GET'&&u.pathname==='/api/export.csv'){const bills=await getBills(),csvEsc=v=>'"'+String(v??'').replace(/"/g,'""')+'"',lines=[['ID','Descrição','Fornecedor','Área','Categoria','Valor','Vencimento','Vencimento Original','Status','Data Pagamento','Qtd Prorrogações','Criado Em'].map(csvEsc).join(';'),...bills.map(x=>[x.id,x.description,x.supplier,x.area,x.category,Number(x.amount).toFixed(2),String(x.due_date).slice(0,10),x.original_due_date?String(x.original_due_date).slice(0,10):'',x.status,x.payment_date?String(x.payment_date).slice(0,10):'',x.postponed_count,x.created_at?new Date(x.created_at).toISOString():''].map(csvEsc).join(';'))];res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="backup-contas-a-pagar.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+lines.join('\r\n'));}
  if(req.method==='POST'&&u.pathname==='/api/bills'){const b=await readJson(req),amount=Number(b.amount);if(!b.description||!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate||''))||!Number.isFinite(amount)||amount<0)return json(res,400,{error:'Dados invalidos'});const extra=Array.isArray(b.recurrenceDates)?b.recurrenceDates:[],dates=[...new Set([b.dueDate,...extra].map(String).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(),group=dates.length>1?crypto.randomUUID():null,client=await pool.connect();try{await client.query('BEGIN');for(const d of dates)await client.query(`INSERT INTO bills(id,recurrence_group,description,supplier,area,category,amount,due_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,[crypto.randomUUID(),group,titleCase(b.description),titleCase(b.supplier||''),titleCase(b.area||'Pessoal'),titleCase(b.category||'Outros'),amount,d]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return json(res,201,{ok:true,count:dates.length});}
  let m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)\/pay$/i);if(req.method==='POST'&&m){await pool.query(`UPDATE bills SET status='paid',payment_date=$2,updated_at=NOW() WHERE id=$1`,[m[1],today()]);return json(res,200,{ok:true});}
  m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)\/postpone$/i);if(req.method==='POST'&&m){const b=await readJson(req);if(!/^\d{4}-\d{2}-\d{2}$/.test(String(b.newDueDate||'')))return json(res,400,{error:'Nova data invalida'});await pool.query(`UPDATE bills SET original_due_date=COALESCE(original_due_date,due_date),due_date=$2,postponed_count=postponed_count+1,updated_at=NOW() WHERE id=$1 AND status='pending'`,[m[1],b.newDueDate]);return json(res,200,{ok:true});}
  m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)$/i);if(req.method==='DELETE'&&m){await pool.query('DELETE FROM bills WHERE id=$1',[m[1]]);return json(res,200,{ok:true});}
  json(res,404,{error:'Nao encontrado'});
 }catch(e){console.error(e);json(res,500,{error:'Erro interno. Verifique a configuracao do banco de dados.'});}
}
module.exports={handler};
