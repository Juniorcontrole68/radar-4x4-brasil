const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {pool,getBills}=require('./db');
const {titleCase,today}=require('./utils');
const {handleColetas}=require('./coletas');
const PUBLIC=path.join(__dirname,'..','public');
function sendFile(res,file,type){res.writeHead(200,{'Content-Type':type,'Cache-Control':file==='index.html'?'no-store':'public, max-age=300'});res.end(fs.readFileSync(path.join(PUBLIC,file)));}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function readJson(req,maxBytes=1_000_000){return new Promise((resolve,reject)=>{let d='',done=false;req.on('data',chunk=>{if(done)return;d+=chunk;if(Buffer.byteLength(d,'utf8')>maxBytes){done=true;reject(new Error('Requisicao muito grande'));}});req.on('end',()=>{if(done)return;try{resolve(d?JSON.parse(d):{});}catch{reject(new Error('JSON invalido'));}});req.on('error',reject);});}
function docPayload(body){
 const kind=String(body.kind||'').toLowerCase();
 const name=String(body.fileName||'arquivo').replace(/[\r\n"]/g,'').slice(0,180)||'arquivo';
 const mime=String(body.mimeType||'application/octet-stream').toLowerCase();
 if(!['boleto','comprovante'].includes(kind))throw new Error('Tipo de documento invalido');
 if(!/^application\/pdf$|^image\/(jpeg|jpg|png|webp)$/i.test(mime))throw new Error('Envie PDF, JPG, PNG ou WEBP');
 const m=String(body.dataUrl||'').match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
 if(!m)throw new Error('Arquivo invalido');
 const data=Buffer.from(m[2].replace(/\s+/g,''),'base64');
 if(!data.length||data.length>7*1024*1024)throw new Error('O arquivo deve ter no maximo 7 MB');
 return{kind,name,mime,data}
}
async function handler(req,res){
 try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/coletas')) { const handled=await handleColetas(req,res,u); if(handled)return; }
  if(req.method==='GET'&&u.pathname==='/') return sendFile(res,'index.html','text/html; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/styles.css') return sendFile(res,'styles.css','text/css; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/app.js') return sendFile(res,'app.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/health'){await pool.query('SELECT 1');return json(res,200,{ok:true,database:'connected'});}
  if(req.method==='GET'&&u.pathname==='/api/bills') return json(res,200,await getBills());
  if(req.method==='GET'&&u.pathname==='/api/export.csv'){const bills=await getBills(),csvEsc=v=>'"'+String(v??'').replace(/"/g,'""')+'"',lines=[['ID','Descrição','Fornecedor','Área','Categoria','Valor','Vencimento','Vencimento Original','Status','Data Pagamento','Tipo PIX','Chave PIX','Boleto','Comprovante','Qtd Prorrogações','Criado Em'].map(csvEsc).join(';'),...bills.map(x=>[x.id,x.description,x.supplier,x.area,x.category,Number(x.amount).toFixed(2),String(x.due_date).slice(0,10),x.original_due_date?String(x.original_due_date).slice(0,10):'',x.status,x.payment_date?String(x.payment_date).slice(0,10):'',x.pix_type||'',x.pix_key||'',x.has_boleto?'Sim':'Não',x.has_comprovante?'Sim':'Não',x.postponed_count,x.created_at?new Date(x.created_at).toISOString():''].map(csvEsc).join(';'))];res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="backup-contas-a-pagar.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+lines.join('\r\n'));}
  if(req.method==='POST'&&u.pathname==='/api/bills'){const b=await readJson(req),amount=Number(b.amount);if(!b.description||!/^d{4}-d{2}-d{2}$/.test(String(b.dueDate||''))||!Number.isFinite(amount)||amount<0)return json(res,400,{error:'Dados invalidos'});const extra=Array.isArray(b.recurrenceDates)?b.recurrenceDates:[],dates=[...new Set([b.dueDate,...extra].map(String).filter(d=>/^d{4}-d{2}-d{2}$/.test(d)))].sort(),group=dates.length>1?crypto.randomUUID():null,client=await pool.connect(),ids=[];try{await client.query('BEGIN');for(const d of dates){const id=crypto.randomUUID();ids.push(id);await client.query(`INSERT INTO bills(id,recurrence_group,description,supplier,area,category,amount,due_date,status,pix_type,pix_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,[id,group,titleCase(b.description),titleCase(b.supplier||''),titleCase(b.area||'Pessoal'),titleCase(b.category||'Outros'),amount,d,String(b.pixType||''),String(b.pixKey||'').trim()])}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return json(res,201,{ok:true,count:dates.length,ids});}
  let m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)\/document\/(boleto|comprovante)$/i);
  if(req.method==='POST'&&m){
    const b=await readJson(req,10*1024*1024),doc=docPayload({...b,kind:m[2]});
    const exists=await pool.query('SELECT 1 FROM bills WHERE id=$1 LIMIT 1',[m[1]]);
    if(!exists.rowCount)return json(res,404,{error:'Conta nao encontrada'});
    await pool.query(`INSERT INTO bill_documents(id,bill_id,kind,file_name,mime_type,file_data,uploaded_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT (bill_id,kind) DO UPDATE SET file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,file_data=EXCLUDED.file_data,uploaded_at=NOW()`,
      [crypto.randomUUID(),m[1],doc.kind,doc.name,doc.mime,doc.data]);
    return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&m){
    const q=await pool.query('SELECT file_name,mime_type,file_data FROM bill_documents WHERE bill_id=$1 AND kind=$2 LIMIT 1',[m[1],m[2]]);
    if(!q.rowCount)return json(res,404,{error:'Documento nao encontrado'});
    const row=q.rows[0],filename=String(row.file_name||'arquivo').replace(/[\r\n"]/g,'');
    res.writeHead(200,{'Content-Type':row.mime_type||'application/octet-stream','Content-Disposition':'inline; filename="'+filename+'"','Cache-Control':'private, no-store'});
    return res.end(row.file_data);
  }
  m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)\/pix$/i);
  if(req.method==='POST'&&m){
    const b=await readJson(req);
    const q=await pool.query('UPDATE bills SET pix_type=$2,pix_key=$3,updated_at=NOW() WHERE id=$1 RETURNING id',[m[1],String(b.pixType||''),String(b.pixKey||'').trim()]);
    if(!q.rowCount)return json(res,404,{error:'Conta nao encontrada'});
    return json(res,200,{ok:true});
  }
  m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)\/pay$/i);if(req.method==='POST'&&m){await pool.query(`UPDATE bills SET status='paid',payment_date=$2,updated_at=NOW() WHERE id=$1`,[m[1],today()]);return json(res,200,{ok:true});}
  m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)\/postpone$/i);if(req.method==='POST'&&m){const b=await readJson(req);if(!/^\d{4}-\d{2}-\d{2}$/.test(String(b.newDueDate||'')))return json(res,400,{error:'Nova data invalida'});await pool.query(`UPDATE bills SET original_due_date=COALESCE(original_due_date,due_date),due_date=$2,postponed_count=postponed_count+1,updated_at=NOW() WHERE id=$1 AND status='pending'`,[m[1],b.newDueDate]);return json(res,200,{ok:true});}
  m=u.pathname.match(/^\/api\/bills\/([0-9a-f-]+)$/i);if(req.method==='DELETE'&&m){await pool.query('DELETE FROM bills WHERE id=$1',[m[1]]);return json(res,200,{ok:true});}
  json(res,404,{error:'Nao encontrado'});
 }catch(e){console.error(e);json(res,500,{error:'Erro interno. Verifique a configuracao do banco de dados.'});}
}
module.exports={handler};
