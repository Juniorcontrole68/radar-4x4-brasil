'use strict';
// Cadastro de clientes da Lotação: nome, endereço completo, ponto de referência e observações.
// Na tela de Coletas, "Cliente cadastrado" preenche o remetente, o endereço da coleta, a referência
// e as observações de uma vez (coleta 1 e também os outros remetentes da lotação).
// Na primeira subida o cadastro já nasce com os remetentes usados nas coletas e as bases de cliente
// do rastreio de lotação; as coletas existentes não são alteradas. Testado em tests/lotacao-clientes.js.

const UFS=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
// Endereço fixo que as coletas antigas recebiam: não serve de endereço do cliente na importação.
const ENDERECO_FIXO_ANTIGO='Estrada do Pinheirinho, 3107 - Itaquaquecetuba - SP';
const CAMPOS=[['nome',160],['endereco',200],['bairro',100],['cidade',80],['uf',2],['cep',9],['referencia',300],['observacoes',1000]];

const limpo=(v,max=200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const chave=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

function lerCorpo(b){
  b=b&&typeof b==='object'?b:{};
  const c={};
  CAMPOS.forEach(([k,max])=>{c[k]=k==='observacoes'?String(b[k]??'').replace(/\r/g,'').trim().slice(0,max):limpo(b[k],max)});
  c.uf=c.uf.toUpperCase();
  if(c.uf&&!UFS.includes(c.uf)){const e=new Error('UF inválida.');e.status=400;throw e}
  const cep=c.cep.replace(/\D/g,'');
  c.cep=cep.length===8?cep.slice(0,5)+'-'+cep.slice(5):c.cep;
  if(!c.nome){const e=new Error('Informe o nome do cliente.');e.status=400;throw e}
  return c
}

// "Rua X, 100 - Centro - Campinas - SP - CEP 13000-000": o mesmo formato que o rastreio de lotação lê.
function enderecoCompleto(c){
  c=c||{};
  const cidadeUf=[limpo(c.cidade,80),limpo(c.uf,2).toUpperCase()].filter(Boolean).join(' - ');
  return [limpo(c.endereco),limpo(c.bairro,100),cidadeUf,c.cep?'CEP '+limpo(c.cep,9):''].filter(Boolean).join(' - ')
}

function linha(r){
  return{id:String(r.id),nome:r.nome,endereco:r.endereco,bairro:r.bairro,cidade:r.cidade,uf:r.uf,cep:r.cep,
    referencia:r.referencia,observacoes:r.observacoes,endereco_completo:enderecoCompleto(r),updated_at:r.updated_at}
}

async function ensureSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS lotacao_clientes (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    nome TEXT NOT NULL,
    nome_key TEXT NOT NULL,
    endereco TEXT NOT NULL DEFAULT '', bairro TEXT NOT NULL DEFAULT '', cidade TEXT NOT NULL DEFAULT '', uf TEXT NOT NULL DEFAULT '', cep TEXT NOT NULL DEFAULT '',
    referencia TEXT NOT NULL DEFAULT '',
    observacoes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_lotacao_clientes_nome ON lotacao_clientes(COALESCE(client_id,0),nome_key)");
  // Referência e observações da coleta 1 (o remetente principal), vindas do cliente cadastrado.
  await pool.query("ALTER TABLE coletas ADD COLUMN IF NOT EXISTS coleta_principal JSONB NOT NULL DEFAULT '{}'::jsonb");
  // Importa uma vez só os clientes que já existiam; depois disso quem manda é o cadastro
  // (um cliente apagado não volta sozinho).
  await pool.query("CREATE TABLE IF NOT EXISTS lotacao_clientes_importacao (feito_em TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const feito=await pool.query('SELECT 1 FROM lotacao_clientes_importacao LIMIT 1');
  if(!feito.rowCount){
    const n=await importarExistentes(pool,undefined);
    await pool.query('INSERT INTO lotacao_clientes_importacao DEFAULT VALUES');
    if(n)console.log('Lotação: '+n+' cliente(s) já usados importados para o cadastro de clientes.');
  }
}

// Remetentes das coletas (principal e outros remetentes) e bases de cliente do rastreio.
// clientId undefined = todas as empresas; senão só a empresa do usuário. Nunca sobrescreve um cadastro.
async function importarExistentes(pool,clientId){
  const achados=new Map();
  const add=(cid,c)=>{
    const nome=limpo(c.nome,160),k=chave(nome);if(!k)return;
    const id=cid===null||cid===undefined||cid===''?null:String(cid);
    const key=(id||'0')+'|'+k;
    const atual=achados.get(key);
    // fica o registro com mais dados de endereço
    const peso=x=>(x.endereco?2:0)+(x.cidade?1:0)+(x.uf?1:0);
    if(!atual||peso(c)>peso(atual))achados.set(key,{...c,nome,client_id:id})
  };
  const filtro=clientId===undefined?'TRUE':(clientId?"to_jsonb(c)->>'client_id'=$1":"to_jsonb(c)->>'client_id' IS NULL");
  const params=clientId?[String(clientId)]:[];
  const col=await pool.query(`SELECT to_jsonb(c)->>'client_id' AS client_id,c.cliente,c.endereco_coleta,
      COALESCE(to_jsonb(c)->'remetentes_extras','[]'::jsonb) AS extras
    FROM coletas c WHERE ${filtro} ORDER BY c.id DESC LIMIT 20000`,params).catch(()=>({rows:[]}));
  for(const r of col.rows){
    const end=limpo(r.endereco_coleta,300);
    add(r.client_id,{nome:r.cliente,endereco:end===ENDERECO_FIXO_ANTIGO?'':end});
    (Array.isArray(r.extras)?r.extras:[]).forEach(e=>add(r.client_id,{nome:e?.remetente,endereco:limpo(e?.endereco_coleta,200),
      cidade:limpo(e?.cidade,80),uf:UFS.includes(limpo(e?.uf,2).toUpperCase())?limpo(e?.uf,2).toUpperCase():'',observacoes:''}))
  }
  const bases=await pool.query(`SELECT client_id::text AS client_id,cliente,endereco,cidade,uf FROM lotacao_clientes_base c WHERE ${filtro}`,params).catch(()=>({rows:[]}));
  for(const b of bases.rows)add(b.client_id,{nome:b.cliente,endereco:limpo(b.endereco,200),cidade:limpo(b.cidade,80),uf:UFS.includes(limpo(b.uf,2).toUpperCase())?limpo(b.uf,2).toUpperCase():''});
  let n=0;
  for(const c of achados.values()){
    const q=await pool.query(`INSERT INTO lotacao_clientes(client_id,nome,nome_key,endereco,cidade,uf) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (COALESCE(client_id,0),nome_key) DO NOTHING`,[c.client_id,c.nome,chave(c.nome),c.endereco||'',c.cidade||'',c.uf||'']);
    n+=q.rowCount
  }
  return n
}

async function podeUsar(deps,req){
  const user=await deps.dashboardSession(req,false);
  if(!(user.is_admin||deps.dashboardHas(user,'lotacao')||deps.dashboardHas(user,'coletas'))){
    const e=new Error('Acesso não autorizado.');e.status=403;throw e
  }
  return user
}

async function handle(req,res,u,deps){
  const {pool,sendJson,readJsonBodyLimited}=deps;
  const p=u.pathname;
  if(!p.startsWith('/api/painel/lotacao-clientes'))return false;
  try{
    const user=await podeUsar(deps,req);
    const cid=user.client_id?String(user.client_id):null;
    const dono='COALESCE(client_id,0)=COALESCE($1::bigint,0)';
    if(p==='/api/painel/lotacao-clientes'&&req.method==='GET'){
      const q=await pool.query(`SELECT * FROM lotacao_clientes WHERE ${dono} ORDER BY nome_key LIMIT 5000`,[cid]);
      sendJson(res,200,{ok:true,rows:q.rows.map(linha)});return true
    }
    if(p==='/api/painel/lotacao-clientes/importar'&&req.method==='POST'){
      const n=await importarExistentes(pool,cid);
      sendJson(res,200,{ok:true,importados:n});return true
    }
    if(p==='/api/painel/lotacao-clientes'&&req.method==='POST'){
      const c=lerCorpo(await readJsonBodyLimited(req,64*1024));
      const q=await pool.query(`INSERT INTO lotacao_clientes(client_id,nome,nome_key,endereco,bairro,cidade,uf,cep,referencia,observacoes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (COALESCE(client_id,0),nome_key) DO NOTHING RETURNING *`,
        [cid,c.nome,chave(c.nome),c.endereco,c.bairro,c.cidade,c.uf,c.cep,c.referencia,c.observacoes]);
      if(!q.rowCount){sendJson(res,409,{ok:false,error:'Já existe um cliente com esse nome.'});return true}
      sendJson(res,201,{ok:true,row:linha(q.rows[0])});return true
    }
    const m=p.match(/^\/api\/painel\/lotacao-clientes\/(\d{1,18})$/);
    if(m&&req.method==='PUT'){
      const c=lerCorpo(await readJsonBodyLimited(req,64*1024));
      const dup=await pool.query(`SELECT 1 FROM lotacao_clientes WHERE ${dono} AND nome_key=$2 AND id<>$3`,[cid,chave(c.nome),m[1]]);
      if(dup.rowCount){sendJson(res,409,{ok:false,error:'Já existe um cliente com esse nome.'});return true}
      const q=await pool.query(`UPDATE lotacao_clientes SET nome=$3,nome_key=$4,endereco=$5,bairro=$6,cidade=$7,uf=$8,cep=$9,referencia=$10,observacoes=$11,updated_at=NOW()
        WHERE ${dono} AND id=$2 RETURNING *`,[cid,m[1],c.nome,chave(c.nome),c.endereco,c.bairro,c.cidade,c.uf,c.cep,c.referencia,c.observacoes]);
      if(!q.rowCount){sendJson(res,404,{ok:false,error:'Cliente não encontrado.'});return true}
      sendJson(res,200,{ok:true,row:linha(q.rows[0])});return true
    }
    if(m&&req.method==='DELETE'){
      const q=await pool.query(`DELETE FROM lotacao_clientes WHERE ${dono} AND id=$2`,[cid,m[1]]);
      if(!q.rowCount){sendJson(res,404,{ok:false,error:'Cliente não encontrado.'});return true}
      sendJson(res,200,{ok:true});return true
    }
    sendJson(res,404,{ok:false,error:'Rota não encontrada.'});return true
  }catch(e){
    sendJson(res,e.status||500,{ok:false,error:e.status?e.message:'Falha no cadastro de clientes.'});
    if(!e.status)console.log('LOTACAO clientes: '+String(e.message||e));
    return true
  }
}

module.exports={ensureSchema,handle,importarExistentes,enderecoCompleto,lerCorpo,ENDERECO_FIXO_ANTIGO};
