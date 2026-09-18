const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');

if (process.env.DATABASE_URL) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    if (u.searchParams.get('sslmode') === 'require' && !u.searchParams.has('uselibpqcompat')) {
      u.searchParams.set('uselibpqcompat', 'true');
      process.env.DATABASE_URL = u.toString();
    }
  } catch (e) {
    console.error('DATABASE_URL invalida:', e.message);
  }
}

process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module.Module._initPaths();

const { initDb, pool } = require('../contas-a-pagar-v3/src/db');
const { initColetasDb } = require('../contas-a-pagar-v3/src/coletas');
const { handler } = require('../contas-a-pagar-v3/src/handler');

const PORT = process.env.PORT || 10000;
const PANEL = path.join(__dirname, 'painel.html');
const ACCOUNTS_INDEX = path.join(__dirname, '..', 'contas-a-pagar-v3', 'public', 'index.html');

function sendHtml(res, file) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(fs.readFileSync(file));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const DELETE_COLETA_UI = `
<style>
#deleteColetaFab{position:fixed;right:18px;bottom:18px;z-index:99997;border:0;border-radius:12px;background:#b91c1c;color:#fff;padding:12px 16px;font-weight:700;box-shadow:0 6px 20px #0003;cursor:pointer}
#deleteColetaFab:hover{background:#991b1b}
#deleteColetaModal{display:none;position:fixed;inset:0;z-index:99998;background:#0f172acc;align-items:center;justify-content:center;padding:18px}
#deleteColetaBox{width:min(560px,100%);background:#fff;border-radius:14px;padding:20px;box-shadow:0 18px 60px #0005;font-family:Arial,Helvetica,sans-serif}
#deleteColetaBox h3{margin:0 0 8px;color:#991b1b}
#deleteColetaBox p{color:#475569;margin:0 0 14px;line-height:1.4}
#deleteColetaSelect{width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;margin-bottom:14px}
.deleteColetaActions{display:flex;gap:10px;justify-content:flex-end}
.deleteColetaActions button{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}
#deleteColetaCancel{background:#e2e8f0;color:#0f172a}
#deleteColetaConfirm{background:#b91c1c;color:#fff}
#deleteColetaConfirm:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:700px){#deleteColetaFab{right:10px;bottom:10px;padding:11px 13px}}
</style>
<button id="deleteColetaFab" type="button">🗑 Excluir coleta</button>
<div id="deleteColetaModal" role="dialog" aria-modal="true" aria-label="Excluir coleta">
  <div id="deleteColetaBox">
    <h3>Excluir coleta</h3>
    <p>Selecione a coleta que deseja apagar. Esta ação remove o registro definitivamente do banco Aiven.</p>
    <select id="deleteColetaSelect"><option value="">Carregando coletas...</option></select>
    <div class="deleteColetaActions">
      <button id="deleteColetaCancel" type="button">Cancelar</button>
      <button id="deleteColetaConfirm" type="button" disabled>Excluir definitivamente</button>
    </div>
  </div>
</div>
<script>
(function(){
  const fab=document.getElementById('deleteColetaFab');
  const modal=document.getElementById('deleteColetaModal');
  const select=document.getElementById('deleteColetaSelect');
  const cancel=document.getElementById('deleteColetaCancel');
  const confirmBtn=document.getElementById('deleteColetaConfirm');

  function pick(o,keys){
    for(const k of keys){
      if(o && o[k]!==undefined && o[k]!==null && String(o[k]).trim()!=='') return String(o[k]);
    }
    return '';
  }
  function label(c){
    const os=pick(c,['numero_os','numero_coleta','ordem_servico','os','coleta','collection_number']);
    const cliente=pick(c,['cliente','client','nome_cliente','customer']);
    const destino=pick(c,['cidade_entrega','destino','endereco_entrega','delivery_address','cidade_destino']);
    const placa=pick(c,['placa','plate']);
    const parts=[];
    if(os) parts.push('OS/Coleta '+os);
    if(cliente) parts.push(cliente);
    if(destino) parts.push(destino);
    if(placa) parts.push('Placa '+placa);
    if(!parts.length) parts.push('ID '+String(c.id||'').slice(0,12));
    return parts.join(' • ');
  }
  async function load(){
    select.innerHTML='<option value="">Carregando coletas...</option>';
    confirmBtn.disabled=true;
    try{
      const r=await fetch('/coletas/api/coletas',{cache:'no-store'});
      if(!r.ok) throw new Error('Falha ao carregar');
      const j=await r.json();
      const list=Array.isArray(j)?j:(Array.isArray(j.coletas)?j.coletas:(Array.isArray(j.items)?j.items:[]));
      select.innerHTML='<option value="">Selecione uma coleta</option>';
      for(const c of list){
        if(!c || !c.id) continue;
        const opt=document.createElement('option');
        opt.value=c.id;
        opt.textContent=label(c);
        select.appendChild(opt);
      }
      if(select.options.length===1){
        select.innerHTML='<option value="">Nenhuma coleta cadastrada</option>';
      }
    }catch(e){
      select.innerHTML='<option value="">Não foi possível carregar as coletas</option>';
    }
  }
  fab.addEventListener('click',async()=>{modal.style.display='flex';await load();});
  cancel.addEventListener('click',()=>{modal.style.display='none';});
  modal.addEventListener('click',e=>{if(e.target===modal) modal.style.display='none';});
  select.addEventListener('change',()=>{confirmBtn.disabled=!select.value;});
  confirmBtn.addEventListener('click',async()=>{
    const id=select.value;
    if(!id) return;
    const text=select.options[select.selectedIndex]?.textContent||'esta coleta';
    if(!window.confirm('Tem certeza que deseja excluir definitivamente?\n\n'+text+'\n\nEsta ação não poderá ser desfeita.')) return;
    confirmBtn.disabled=true;
    confirmBtn.textContent='Excluindo...';
    try{
      const r=await fetch('/coletas/api/coletas/'+encodeURIComponent(id),{method:'DELETE'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(j.error||'Erro ao excluir');
      alert('Coleta excluída com sucesso.');
      modal.style.display='none';
      location.reload();
    }catch(e){
      alert(e.message||'Não foi possível excluir a coleta.');
      confirmBtn.disabled=false;
      confirmBtn.textContent='Excluir definitivamente';
    }
  });
})();
</script>
`;

function handlerWithDeleteButton(req, res) {
  const originalEnd = res.end.bind(res);
  res.end = function(chunk, encoding, callback) {
    try {
      if (chunk) {
        let html = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (html.includes('</body>') && !html.includes('deleteColetaFab')) {
          html = html.replace('</body>', DELETE_COLETA_UI + '</body>');
          if (res.hasHeader && res.hasHeader('content-length')) res.removeHeader('content-length');
          return originalEnd(html, encoding, callback);
        }
      }
    } catch (e) {
      console.error('Falha ao injetar botao Excluir coleta:', e.message);
    }
    return originalEnd(chunk, encoding, callback);
  };
  return handler(req, res);
}

async function migrateLegacyBillsIfNeeded() {
  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM bills');
    const current = countResult.rows[0]?.total || 0;
    if (current > 0) {
      console.log('Contas a Pagar no Aiven: ' + current + ' registro(s). Migracao automatica dispensada.');
      return;
    }

    const response = await fetch('https://contas-jr.onrender.com/api/bills', {
      headers: { 'User-Agent': 'PainelTransportadora-Migracao/1.0' },
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bills = await response.json();
    if (!Array.isArray(bills) || bills.length === 0) {
      console.log('Sistema antigo sem contas para migrar.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const b of bills) {
        await client.query(
          `INSERT INTO bills
          (id, recurrence_group, description, supplier, area, category, amount, due_date, original_due_date, status, payment_date, postponed_count, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO NOTHING`,
          [
            b.id,
            b.recurrence_group || null,
            b.description || '',
            b.supplier || '',
            b.area || 'Pessoal',
            b.category || 'Outros',
            Number(b.amount || 0),
            String(b.due_date || '').slice(0, 10),
            b.original_due_date ? String(b.original_due_date).slice(0, 10) : null,
            b.status === 'paid' ? 'paid' : 'pending',
            b.payment_date ? String(b.payment_date).slice(0, 10) : null,
            Number(b.postponed_count || 0),
            b.created_at || new Date().toISOString(),
            b.updated_at || b.created_at || new Date().toISOString()
          ]
        );
      }
      await client.query('COMMIT');
      console.log('Migracao Contas a Pagar concluida: ' + bills.length + ' registro(s) copiados para o Aiven.');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Migracao automatica do Contas a Pagar nao concluida:', e.message);
  }
}

async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao configurada');
  await Promise.all([initDb(), initColetasDb()]);
  await migrateLegacyBillsIfNeeded();

  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/painel')) {
        return sendHtml(res, PANEL);
      }

      if (req.method === 'GET' && (u.pathname === '/contas' || u.pathname === '/contas/')) {
        return sendHtml(res, ACCOUNTS_INDEX);
      }

      const del = u.pathname.match(/^\/coletas\/api\/coletas\/([0-9a-f-]+)$/i);
      if (req.method === 'DELETE' && del) {
        const result = await pool.query('DELETE FROM coletas WHERE id=$1 RETURNING id', [del[1]]);
        if (!result.rowCount) return sendJson(res, 404, { error: 'Coleta não encontrada.' });
        return sendJson(res, 200, { ok: true, id: result.rows[0].id });
      }

      if (req.method === 'GET' && (u.pathname === '/coletas' || u.pathname === '/coletas/')) {
        return handlerWithDeleteButton(req, res);
      }

      return handler(req, res);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno');
    }
  }).listen(PORT, '0.0.0.0', () => {
    console.log('Painel da Transportadora ativo na porta ' + PORT + ' com PostgreSQL Aiven');
  });
}

start().catch(err => {
  console.error('Falha ao iniciar Painel da Transportadora:', err);
  process.exit(1);
});
