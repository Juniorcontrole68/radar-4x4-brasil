const zlib=require('zlib');
let src=zlib.gunzipSync(Buffer.from('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','base64')).toString('utf8');

try{
  const fm=src.match(/const FRONTEND_B64='([^']+)'/);
  if(fm){
    let html=zlib.gunzipSync(Buffer.from(fm[1],'base64')).toString('utf8');

    html=html.replace(
      'Cliente *<input id="cliente" required placeholder="Nome do cliente" />',
      'Remetente *<input id="cliente" required placeholder="Nome do remetente" />'
    );
    html=html.replaceAll('Nome do Cliente da Entrega','Remetente');
    html=html.replaceAll('Cliente / Entrega','Remetente / Endereço');
    const mvStart='<div class="section-title">Motorista e veículo</div>\n      <div class="grid three">';
    if(html.includes(mvStart) && !html.includes('id="doc_motorista_file"')){
      const staticDocs=
        '<label>CPF do motorista<input id="motorista_cpf" placeholder="000.000.000-00" inputmode="numeric" maxlength="14" /></label>'+
        '<label class="full doc-field" style="grid-column:1/-1"><span class="doc-title">Importar documento do motorista</span><input id="doc_motorista_file" type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/*" /><span id="doc_motorista_status" class="doc-status">PDF ou foto. O sistema tenta preencher nome e CPF automaticamente.</span></label>'+
        '<label>Capacidade de carga do cavalo<input id="capacidade_carga_cavalo" placeholder="Ex.: 16.000 kg" /></label>'+
        '<label>Eixos do cavalo<input id="eixos_cavalo" type="number" min="0" max="20" /></label>'+
        '<label class="full doc-field" style="grid-column:1/-1"><span class="doc-title">Subir documento do cavalo mecânico</span><input id="doc_cavalo_file" type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/*" /><span id="doc_cavalo_status" class="doc-status">PDF ou foto. O sistema tenta preencher placa, capacidade e eixos.</span></label>'+
        '<label>Placa da carreta<input id="placa_carreta" placeholder="ABC1D23" maxlength="8" /></label>'+
        '<label>Capacidade de carga da carreta<input id="capacidade_carga_carreta" placeholder="Ex.: 28.000 kg" /></label>'+
        '<label>Eixos da carreta<input id="eixos_carreta" type="number" min="0" max="20" /></label>'+
        '<label class="full doc-field" style="grid-column:1/-1"><span class="doc-title">Subir documento da carreta</span><input id="doc_carreta_file" type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/*" /><span id="doc_carreta_status" class="doc-status">PDF ou foto. O sistema tenta preencher placa, capacidade e eixos.</span></label>'+
        '<label class="full doc-refresh-field" style="grid-column:1/-1"><span class="doc-title">Preencher dados pelos documentos anexados</span><button id="doc_refresh_data" type="button" onclick="event.preventDefault();var s=document.getElementById(\'doc_refresh_status\');if(s){s.className=\'doc-status\';s.textContent=\'Botão acionado. Preparando leitura…\'}if(window.__refreshColetaDocumentData){window.__refreshColetaDocumentData()}else if(s){s.className=\'doc-status err\';s.textContent=\'O leitor de documentos ainda não carregou. Feche e abra a coleta novamente.\'}return false;">↻ Atualizar dados dos documentos</button><span id="doc_refresh_status" class="doc-status">Anexe os documentos acima e clique em Atualizar.</span></label>';
      html=html.replace(mvStart,mvStart+staticDocs);
    }

    if(!html.includes('coletas-doc-static-css')){
      html=html.replace('</head>','<style id="coletas-doc-static-css">.doc-field{border:1px dashed #94a3b8;border-radius:12px;padding:12px;background:#fff}.doc-field .doc-title{display:block;font-weight:700;color:#334155;margin-bottom:6px}.doc-field input[type=file]{width:100%;box-sizing:border-box;padding:9px;border:1px solid #dbe4ee;border-radius:9px;background:#f8fafc}.doc-status{display:block;margin-top:7px;font-size:11px;color:#64748b;line-height:1.4}.doc-refresh-field{border:1px solid #99f6e4;border-radius:12px;padding:12px;background:#f0fdfa}.doc-refresh-field .doc-title{display:block;font-weight:700;color:#115e59;margin-bottom:7px}#doc_refresh_data{width:100%;border:0;border-radius:9px;padding:11px 14px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer}</style></head>');
    }



    html=html.replace("<td><div class=\"os\">${esc(c.os_numero||String(c.id))}</div><div class=\"muted\">#${c.id}</div></td>\n    <td><strong>${esc(c.cliente||'-')}</strong><div class=\"muted\">${esc(c.endereco_entrega||'-')}</div></td>","<td><div style=\"display:flex;align-items:center;gap:10px;flex-wrap:wrap\"><div class=\"os\">${esc(c.os_numero||String(c.id))}</div><strong>${esc(c.cliente||'-')}</strong></div><div class=\"muted\">#${c.id}</div></td>\n    <td><div><strong>Coleta:</strong> ${esc(c.endereco_coleta||'-')}</div><div style=\"margin-top:5px\"><strong>Destinatário:</strong> ${esc(c.destinatario||'-')}</div><div class=\"muted\" style=\"margin-top:3px\"><strong>Entrega:</strong> ${esc(c.endereco_entrega||'-')}</div></td>");
    html=html.replace('<th>OS</th><th>Remetente / Endereço</th>','<th>Coleta / Remetente</th><th>Coleta / Destinatário / Entrega</th>');
    html=html.replace(
      "${c.id} ${c.os_numero||''} ${c.cliente||''} ${c.endereco_entrega||''}",
      "${c.id} ${c.os_numero||''} ${c.cliente||''} ${c.destinatario||''} ${c.endereco_coleta||''} ${c.endereco_entrega||''}"
    );

    if(!html.includes('font-light-override')){
      const fontCss=`<style id="font-light-override">
      html,body,button,input,select,textarea,table{font-family:"Segoe UI",Roboto,Arial,sans-serif!important}
      body{font-weight:400!important;letter-spacing:0!important}
      label,.muted,.hint,.toolbar,.finance-toolbar{font-weight:400!important}
      .btn,.tab,.section-title,th{font-weight:500!important}
      h1,h2,h3,strong,.os,.kpi strong{font-weight:600!important}
      input,select,textarea{font-weight:400!important}
      </style>`;
      html=html.replace('</head>',fontCss+'</head>');
    }


    if(!html.includes('financeiro-recebimento-addon')){
      const recebimentoAddon=`<style id="financeiro-recebimento-addon">
      .recebido-cell{text-align:center;white-space:nowrap}
      .recebido-check{width:18px;height:18px;accent-color:#16a34a;vertical-align:middle}
      .recebido-date{min-width:145px}
      .previsao-date{min-width:145px}
      .recebido-inline{display:flex;align-items:center;gap:9px;min-height:42px}
      #modal{width:min(1180px,96vw)!important;max-width:1180px!important}
      #formColeta{max-width:none!important}
      .coleta-form-groups{display:grid;gap:16px;margin:14px 0}
      .coleta-form-card{border:1px solid #dbe4ee;border-radius:14px;background:#f8fafc;padding:16px}
      .coleta-form-card h3{margin:0 0 13px;font-size:15px;color:#0f172a;font-weight:700}
      .coleta-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .coleta-form-grid label{margin:0!important}
      .coleta-form-grid label.form-wide{grid-column:1/-1}
      .coleta-form-grid input,.coleta-form-grid select,.coleta-form-grid textarea{width:100%;box-sizing:border-box}
      @media(max-width:850px){.coleta-form-grid{grid-template-columns:1fr}.coleta-form-grid label.form-wide{grid-column:auto}}
      </style>
      <script id="financeiro-recebimento-script">
      (() => {
        const API_STATUS='/api/painel/coletas-financeiro/';
        const API_PREVISAO='/api/painel/coletas-previsao/';
        const API_DESTINATARIO='/api/painel/coletas-destinatario/';
        const today=()=>new Date().toISOString().slice(0,10);
        const originalFetch=window.fetch.bind(window);
        const escLocal=(v)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        let dadosCache=[];

        async function carregarDados(){
          try{
            const r=await originalFetch('/coletas/api/coletas',{cache:'no-store'});
            if(r.ok) dadosCache=await r.json();
          }catch(e){}
          return dadosCache;
        }

        function acharPorLinha(tr){
          const texto=(tr.cells?.[0]?.textContent||'').trim();
          return dadosCache.find(c=>{
            const os=String(c.os_numero||c.id||'').trim();
            const id=String(c.id||'').trim();
            return (os && texto.includes(os)) || (id && texto.includes('#'+id));
          });
        }

        async function salvarStatus(id, recebido, data){
          const r=await originalFetch(API_STATUS+encodeURIComponent(id),{
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({recebido:!!recebido,data_recebimento:data||null})
          });
          if(!r.ok){
            const e=await r.json().catch(()=>({}));
            throw new Error(e.error||'Não foi possível salvar o recebimento.');
          }
          return r.json();
        }

        async function salvarPrevisao(id, data){
          const r=await originalFetch(API_PREVISAO+encodeURIComponent(id),{
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({previsao_pagamento_fatura:data||null})
          });
          if(!r.ok){
            const e=await r.json().catch(()=>({}));
            throw new Error(e.error||'Não foi possível salvar a previsão de pagamento.');
          }
          return r.json();
        }

        async function salvarDestinatario(id, destinatario){
          const r=await originalFetch(API_DESTINATARIO+encodeURIComponent(id),{
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({destinatario:destinatario||''})
          });
          if(!r.ok){
            const e=await r.json().catch(()=>({}));
            throw new Error(e.error||'Não foi possível salvar o destinatário.');
          }
          return r.json();
        }

        async function decorarOperacional(){
          const tbody=document.getElementById('tbodyOperacional');
          if(!tbody) return;
          await carregarDados();

          const table=tbody.closest('table');
          const headRow=table?.querySelector('thead tr');
          if(headRow && headRow.children.length>=2){
            headRow.children[0].textContent='Coleta / Remetente';
            headRow.children[1].textContent='Coleta / Destinatário / Entrega';
          }

          [...tbody.querySelectorAll('tr')].forEach(tr=>{
            const coleta=acharPorLinha(tr);
            if(!coleta || !tr.cells || tr.cells.length<2) return;
            const signature=[
              coleta.os_numero||coleta.id||'',
              coleta.cliente||'',
              coleta.endereco_coleta||'',
              coleta.destinatario||'',
              coleta.endereco_entrega||''
            ].join('|');
            if(tr.dataset.identificacaoColeta===signature) return;

            tr.cells[0].innerHTML=
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
              '<div class="os">'+escLocal(coleta.os_numero||String(coleta.id))+'</div>'+
              '<strong>'+escLocal(coleta.cliente||'-')+'</strong>'+
              '</div>'+
              '<div class="muted">#'+escLocal(coleta.id)+'</div>';

            tr.cells[1].innerHTML=
              '<div><strong>Coleta:</strong> '+escLocal(coleta.endereco_coleta||'-')+'</div>'+
              '<div style="margin-top:5px"><strong>Destinatário:</strong> '+escLocal(coleta.destinatario||'-')+'</div>'+
              '<div class="muted" style="margin-top:3px"><strong>Entrega:</strong> '+escLocal(coleta.endereco_entrega||'-')+'</div>';

            tr.dataset.identificacaoColeta=signature;
          });
        }

        async function decorarFinanceiro(){
          const tbody=document.getElementById('tbodyFinanceiro');
          if(!tbody) return;
          await carregarDados();

          const table=tbody.closest('table');
          const headRow=table?.querySelector('thead tr');
          if(headRow && !headRow.querySelector('[data-recebido-head]')){
            const th1=document.createElement('th');
            th1.textContent='Recebido';
            th1.dataset.recebidoHead='1';
            const th2=document.createElement('th');
            th2.textContent='Data do recebimento';
            th2.dataset.recebidoHead='1';
            const th3=document.createElement('th');
            th3.textContent='Prev. pagamento da fatura';
            th3.dataset.recebidoHead='1';
            th3.dataset.previsaoHead='1';
            headRow.append(th1,th2,th3);
          }

          [...tbody.querySelectorAll('tr')].forEach(tr=>{
            if(tr.dataset.recebidoDecorado==='1') return;
            const coleta=acharPorLinha(tr);
            if(!coleta) return;
            tr.dataset.recebidoDecorado='1';

            const tdCheck=document.createElement('td');
            tdCheck.className='recebido-cell';
            const check=document.createElement('input');
            check.type='checkbox';
            check.className='recebido-check';
            check.checked=!!coleta.recebido;
            check.title='Marcar frete como recebido';

            const tdData=document.createElement('td');
            tdData.className='recebido-cell';
            const date=document.createElement('input');
            date.type='date';
            date.className='recebido-date';
            date.value=coleta.data_recebimento?String(coleta.data_recebimento).slice(0,10):'';
            date.disabled=!check.checked;

            const tdPrev=document.createElement('td');
            tdPrev.className='recebido-cell';
            const prev=document.createElement('input');
            prev.type='date';
            prev.className='previsao-date';
            prev.value=coleta.previsao_pagamento_fatura?String(coleta.previsao_pagamento_fatura).slice(0,10):'';
            prev.title='Previsão de pagamento da fatura';
            prev.addEventListener('change',async()=>{
              const antigo=coleta.previsao_pagamento_fatura?String(coleta.previsao_pagamento_fatura).slice(0,10):'';
              try{
                await salvarPrevisao(coleta.id,prev.value);
                coleta.previsao_pagamento_fatura=prev.value||null;
              }catch(e){
                prev.value=antigo;
                alert(e.message);
              }
            });

            check.addEventListener('change',async()=>{
              const prev=!check.checked;
              try{
                if(check.checked && !date.value) date.value=today();
                date.disabled=!check.checked;
                await salvarStatus(coleta.id,check.checked,date.value);
                coleta.recebido=check.checked;
                coleta.data_recebimento=check.checked?date.value:null;
              }catch(e){
                check.checked=prev;
                date.disabled=!check.checked;
                alert(e.message);
              }
            });

            date.addEventListener('change',async()=>{
              if(!check.checked) return;
              try{
                await salvarStatus(coleta.id,true,date.value);
                coleta.data_recebimento=date.value;
              }catch(e){ alert(e.message); }
            });

            tdCheck.appendChild(check);
            tdData.appendChild(date);
            tdPrev.appendChild(prev);
            tr.append(tdCheck,tdData,tdPrev);
          });
        }

        function rotuloCampo(id,texto){
          const el=document.getElementById(id);
          const label=el?.closest('label');
          if(!label) return;
          const span=label.querySelector(':scope > span');
          if(span) span.textContent=texto;
          else{
            const nodes=[...label.childNodes];
            const firstText=nodes.find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
            if(firstText) firstText.textContent=texto;
            else label.insertAdjacentText('afterbegin',texto);
          }
        }

        function organizarFormularioColeta(){
          const form=document.getElementById('formColeta');
          if(!form) return;
          let wrap=document.getElementById('coletaFormGroups');
          if(wrap?.dataset?.ready==='1') return;
          if(!wrap){
            wrap=document.createElement('div');
            wrap.id='coletaFormGroups';
            wrap.className='coleta-form-groups';
            const primeiro=form.querySelector('.section-title');
            if(primeiro) form.insertBefore(wrap,primeiro);
            else form.appendChild(wrap);
          }

          const make=(title,ids)=>{
            const card=document.createElement('section');
            card.className='coleta-form-card';
            const h=document.createElement('h3');h.textContent=title;card.appendChild(h);
            const grid=document.createElement('div');grid.className='coleta-form-grid';card.appendChild(grid);
            ids.forEach(id=>{
              const el=document.getElementById(id),label=el?.closest('label');
              if(label){
                label.classList.toggle('form-wide',['endereco_coleta','endereco_entrega','comprovante','observacoes','lucro'].includes(id));
                grid.appendChild(label);
              }
            });
            if(grid.children.length) wrap.appendChild(card);
          };

          rotuloCampo('os_numero','Nº da coleta');
          rotuloCampo('cliente','Remetente *');
          rotuloCampo('endereco_coleta','Endereço da coleta');
          rotuloCampo('data_carregamento','Data da coleta');
          rotuloCampo('hora_carregamento','Hora da coleta');

          rotuloCampo('destinatario','Destinatário *');
          rotuloCampo('endereco_entrega','Endereço da entrega *');
          rotuloCampo('previsao_entrega','Previsão de entrega');
          rotuloCampo('data_descarga','Data da descarga');
          rotuloCampo('status','Status');
          rotuloCampo('comprovante','Comprovante de entrega');

          rotuloCampo('motorista','Nome do motorista');
          rotuloCampo('telefone_motorista','Telefone / WhatsApp');
          rotuloCampo('transportadora_agregado','Transportadora / Agregado');

          rotuloCampo('placa','Placa');
          rotuloCampo('tipo_caminhao','Tipo de caminhão');
          rotuloCampo('implemento','Implemento');
          rotuloCampo('eixos','Quantidade de eixos');

          rotuloCampo('quantidade_paletes','Quantidade de paletes');
          rotuloCampo('peso_total','Peso total (kg)');
          rotuloCampo('observacoes','Observações');

          make('Coleta',['os_numero','cliente','endereco_coleta','data_carregamento','hora_carregamento']);
          make('Entrega',['destinatario','endereco_entrega','previsao_entrega','data_descarga','status','comprovante']);
          make('Dados do Motorista',['motorista','motorista_cpf','telefone_motorista','transportadora_agregado','doc_motorista_file']);
          make('Dados do Caminhão',['placa','tipo_caminhao','implemento','eixos','capacidade_carga_cavalo','eixos_cavalo','doc_cavalo_file','placa_carreta','capacidade_carga_carreta','eixos_carreta','doc_carreta_file','doc_refresh_data']);
          make('Dados da Carga',['quantidade_paletes','peso_total','observacoes']);
          make('Financeiro',['frete_cobrado','frete_pago','percentual_adiantamento','valor_adiantamento','tarifa_rota_por_eixo','pedagio','lucro','recebido_financeiro','data_recebimento_financeiro','previsao_pagamento_fatura']);

          [...form.querySelectorAll(':scope > .section-title')].forEach(x=>x.style.display='none');
          [...form.querySelectorAll(':scope > .grid')].forEach(g=>{if(g.id!=='coletaFormGroups')g.style.display='none'});
          const hint=[...form.querySelectorAll(':scope > .hint')].find(x=>/pedágio|lucro|adiantamento/i.test(x.textContent||''));
          if(hint){
            const fin=[...wrap.querySelectorAll('.coleta-form-card')].find(x=>x.querySelector('h3')?.textContent==='Financeiro');
            if(fin){hint.style.display='block';hint.style.marginTop='10px';fin.appendChild(hint)}
          }
          wrap.dataset.ready='1';
        }

        function garantirCamposFormulario(){
          const cliente=document.getElementById('cliente');
          if(cliente && !document.getElementById('destinatario')){
            const clienteLabel=cliente.closest('label');
            const lblDest=document.createElement('label');
            lblDest.innerHTML='<span>Destinatário *</span><input id="destinatario" type="text" required placeholder="Nome do destinatário">';
            if(clienteLabel?.parentElement) clienteLabel.insertAdjacentElement('afterend',lblDest);
          }

          const frete=document.getElementById('frete_cobrado');
          if(!frete) return;
          const grid=frete.closest('.grid');
          if(!grid) return;

          if(!document.getElementById('recebido_financeiro')){
            const lblCheck=document.createElement('label');
            lblCheck.innerHTML='<span>Recebido</span><span class="recebido-inline"><input id="recebido_financeiro" type="checkbox" class="recebido-check"> <span>Frete recebido do cliente</span></span>';

            const lblData=document.createElement('label');
            lblData.innerHTML='<span>Data do recebimento</span><input id="data_recebimento_financeiro" type="date" disabled>';

            grid.append(lblCheck,lblData);

            const check=document.getElementById('recebido_financeiro');
            const date=document.getElementById('data_recebimento_financeiro');
            check.addEventListener('change',()=>{
              if(check.checked && !date.value) date.value=today();
              date.disabled=!check.checked;
              if(!check.checked) date.value='';
            });
          }

          if(!document.getElementById('previsao_pagamento_fatura')){
            const lblPrev=document.createElement('label');
            lblPrev.innerHTML='<span>Previsão de pagamento da fatura</span><input id="previsao_pagamento_fatura" type="date" class="previsao-date">';
            grid.appendChild(lblPrev);
          }
          organizarFormularioColeta();
        }

        async function carregarCamposFormulario(){
          garantirCamposFormulario();
          const modal=document.getElementById('modal');
          if(!modal?.open) return;
          const id=document.getElementById('id')?.value;
          const check=document.getElementById('recebido_financeiro');
          const date=document.getElementById('data_recebimento_financeiro');
          const prev=document.getElementById('previsao_pagamento_fatura');
          const dest=document.getElementById('destinatario');
          if(!check || !date || !prev || !dest) return;

          if(!id){
            check.checked=false;
            date.value='';
            date.disabled=true;
            prev.value='';
            dest.value='';
            return;
          }
          await carregarDados();
          const coleta=dadosCache.find(c=>String(c.id)===String(id));
          check.checked=!!coleta?.recebido;
          date.value=coleta?.data_recebimento?String(coleta.data_recebimento).slice(0,10):'';
          date.disabled=!check.checked;
          prev.value=coleta?.previsao_pagamento_fatura?String(coleta.previsao_pagamento_fatura).slice(0,10):'';
          dest.value=coleta?.destinatario||'';
        }

        window.fetch=async function(input,init={}){
          const res=await originalFetch(input,init);
          try{
            const url=typeof input==='string'?input:(input?.url||'');
            const method=String(init?.method||'GET').toUpperCase();
            if(res.ok && /^\\/coletas\\/api\\/coletas(?:\\/\\d+)?$/.test(url) && (method==='POST'||method==='PUT')){
              const data=await res.clone().json();
              const check=document.getElementById('recebido_financeiro');
              const date=document.getElementById('data_recebimento_financeiro');
              const prev=document.getElementById('previsao_pagamento_fatura');
              const dest=document.getElementById('destinatario');
              if(data?.id){
                if(check) await salvarStatus(data.id,check.checked,date?.value||'');
                if(prev) await salvarPrevisao(data.id,prev.value||'');
                if(dest) await salvarDestinatario(data.id,dest.value||'');
                setTimeout(decorarFinanceiro,150);
              }
            }
          }catch(e){ console.warn('Recebimento:',e); }
          return res;
        };

        document.addEventListener('DOMContentLoaded',()=>{
          garantirCamposFormulario();
          const tbody=document.getElementById('tbodyFinanceiro');
          if(tbody){
            const obs=new MutationObserver(()=>setTimeout(decorarFinanceiro,30));
            obs.observe(tbody,{childList:true,subtree:true});
          }
          const tbodyOp=document.getElementById('tbodyOperacional');
          if(tbodyOp){
            const obsOp=new MutationObserver(()=>setTimeout(decorarOperacional,30));
            obsOp.observe(tbodyOp,{childList:true,subtree:true});
          }
          const modal=document.getElementById('modal');
          if(modal){
            const obsModal=new MutationObserver(()=>setTimeout(()=>{garantirCamposFormulario();carregarCamposFormulario()},30));
            obsModal.observe(modal,{attributes:true,attributeFilter:['open']});
          }
          setTimeout(decorarFinanceiro,250);setTimeout(decorarOperacional,250);
        });
      })();
      <\/script>`;

      const documentoAddon=String.raw`<style id="documentos-coleta-addon">
      .doc-field{grid-column:1/-1;border:1px dashed #94a3b8;border-radius:12px;padding:12px;background:#fff}
      .doc-field .doc-title{display:block;font-weight:700;color:#334155;margin-bottom:5px}
      .doc-field input[type=file]{width:100%;padding:9px;border:1px solid #dbe4ee;border-radius:9px;background:#f8fafc}
      .doc-status{display:block;margin-top:7px;font-size:11px;color:#64748b;line-height:1.4}
      .doc-status.ok{color:#15803d;font-weight:600}.doc-status.err{color:#b91c1c;font-weight:600}
      .doc-status a{color:#0f766e;font-weight:700;text-decoration:none}
      .doc-refresh-field{grid-column:1/-1;border:1px solid #99f6e4;border-radius:12px;padding:12px;background:#f0fdfa}
      .doc-refresh-field .doc-title{display:block;font-weight:700;color:#115e59;margin-bottom:7px}
      #doc_refresh_data{width:100%;border:0;border-radius:9px;padding:11px 14px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer}
      #doc_refresh_data:disabled{opacity:.55;cursor:wait}
      .doc-reading{display:inline-flex;align-items:center;gap:6px}
      .history-select-wrap{grid-column:1/-1;border:1px solid #cbd5e1;border-radius:11px;padding:11px;background:#fff}
      .history-select-wrap>span{display:block;font-weight:700;color:#334155;margin-bottom:6px}
      .history-select{width:100%;box-sizing:border-box;min-height:42px;border:1px solid #cbd5e1;border-radius:9px;padding:8px 10px;background:#fff}
      .history-hint{display:block;margin-top:5px;font-size:11px;color:#64748b}
      .doc-reading:before{content:"";width:10px;height:10px;border:2px solid #cbd5e1;border-top-color:#0f766e;border-radius:50%;animation:docSpin .8s linear infinite}
      @keyframes docSpin{to{transform:rotate(360deg)}}
      </style>
      <script id="documentos-coleta-script">
      (() => {
        const docBaseFetch=window.fetch.bind(window);
        let pendingDocs={motorista:null,cavalo:null,carreta:null};
        let lastOpenKey='';

        const byId=id=>document.getElementById(id);
        const titleCase=v=>String(v||'').toLocaleLowerCase('pt-BR').replace(/(^|[\s\-'])\p{L}/gu,m=>m.toLocaleUpperCase('pt-BR'));
        const digits=v=>String(v||'').replace(/\D/g,'');
        const formatCpf=v=>{const d=digits(v).slice(0,11);return d.length===11?d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6,9)+'-'+d.slice(9):d};
        const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
        const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        const currentId=()=>String(byId('id')?.value||'').trim();

        function cardByTitle(title){
          return [...document.querySelectorAll('.coleta-form-card')].find(x=>norm(x.querySelector('h3')?.textContent||'')===norm(title));
        }
        function addInput(grid,id,label,type='text',opts={}){
          let el=byId(id);if(el)return el;
          const lbl=document.createElement('label');
          if(opts.wide)lbl.className='form-wide';
          const sp=document.createElement('span');sp.textContent=label;
          el=document.createElement('input');el.id=id;el.type=type;
          if(opts.placeholder)el.placeholder=opts.placeholder;
          if(opts.inputmode)el.inputMode=opts.inputmode;
          if(opts.max)el.max=opts.max;
          if(opts.min)el.min=opts.min;
          if(opts.noTitlecase)el.dataset.noTitlecase='true';
          lbl.append(sp,el);grid.appendChild(lbl);return el
        }

        function addHistorySelect(grid,id,label,placeholder){
          let sel=byId(id);if(sel)return sel;
          const wrap=document.createElement('label');wrap.className='history-select-wrap';
          const sp=document.createElement('span');sp.textContent=label;
          sel=document.createElement('select');sel.id=id;sel.className='history-select';sel.dataset.noTitlecase='true';
          sel.innerHTML='<option value="">'+esc(placeholder)+'</option>';
          const hint=document.createElement('small');hint.className='history-hint';hint.textContent='Os dados abaixo continuam livres para edição manual.';
          wrap.append(sp,sel,hint);
          grid.insertBefore(wrap,grid.firstChild);
          return sel
        }
        function setField(id,value){
          const el=byId(id);if(!el||value===undefined||value===null||String(value).trim()==='')return;
          el.value=String(value);
          try{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}catch{}
        }
        function historyLatest(rows,key){
          const map=new Map();
          (Array.isArray(rows)?rows:[]).forEach(r=>{
            const raw=String(r?.[key]||'').trim();if(!raw)return;
            const k=norm(raw);
            const prev=map.get(k);
            const rid=Number(r.id||0),pid=Number(prev?.id||0);
            if(!prev||rid>=pid)map.set(k,r)
          });
          return [...map.values()].sort((a,b)=>String(a?.[key]||'').localeCompare(String(b?.[key]||''),'pt-BR',{sensitivity:'base'}))
        }
        function fillHistorySelect(sel,rows,key,render){
          if(!sel)return;
          const current=sel.value;
          sel.innerHTML='<option value="">Selecione…</option>';
          rows.forEach(r=>{
            const opt=document.createElement('option');
            opt.value=String(r.id||'');
            opt.textContent=render(r);
            sel.appendChild(opt)
          });
          if([...sel.options].some(o=>o.value===current))sel.value=current
        }
        async function refreshHistorySelectors(){
          ensureFields();
          let rows=[];
          try{
            const r=await docBaseFetch('/coletas/api/coletas',{cache:'no-store'});
            if(r.ok)rows=await r.json()
          }catch{}
          if(!Array.isArray(rows))rows=[];

          const drivers=historyLatest(rows,'motorista');
          const senders=historyLatest(rows,'cliente');
          const recipients=historyLatest(rows,'destinatario');

          const sm=byId('historico_motorista'),sr=byId('historico_remetente'),sd=byId('historico_destinatario');
          window.__coletaHistoryProfiles={drivers,senders,recipients};
          fillHistorySelect(sm,drivers,'motorista',r=>{
            const cpf=formatCpf(r.motorista_cpf||'');
            return String(r.motorista||'')+(cpf?' • CPF '+cpf:'')
          });
          fillHistorySelect(sr,senders,'cliente',r=>String(r.cliente||'')+(r.endereco_coleta?' • '+r.endereco_coleta:''));
          fillHistorySelect(sd,recipients,'destinatario',r=>String(r.destinatario||'')+(r.endereco_entrega?' • '+r.endereco_entrega:''));

          if(sm&&!sm.dataset.historyBound){
            sm.dataset.historyBound='1';
            sm.addEventListener('change',()=>{
              const r=(window.__coletaHistoryProfiles?.drivers||[]).find(x=>String(x.id||'')===sm.value);if(!r)return;
              setField('motorista',r.motorista);
              setField('motorista_cpf',formatCpf(r.motorista_cpf||''));
              setField('telefone_motorista',r.telefone_motorista);
              setField('transportadora_agregado',r.transportadora_agregado)
            })
          }
          if(sr&&!sr.dataset.historyBound){
            sr.dataset.historyBound='1';
            sr.addEventListener('change',()=>{
              const r=(window.__coletaHistoryProfiles?.senders||[]).find(x=>String(x.id||'')===sr.value);if(!r)return;
              setField('cliente',r.cliente);
              setField('endereco_coleta',r.endereco_coleta)
            })
          }
          if(sd&&!sd.dataset.historyBound){
            sd.dataset.historyBound='1';
            sd.addEventListener('change',()=>{
              const r=(window.__coletaHistoryProfiles?.recipients||[]).find(x=>String(x.id||'')===sd.value);if(!r)return;
              setField('destinatario',r.destinatario);
              setField('endereco_entrega',r.endereco_entrega)
            })
          }
        }

        function addUpload(grid,id,label,statusId){
          let input=byId(id);if(input)return input;
          const box=document.createElement('label');box.className='doc-field form-wide';
          const title=document.createElement('span');title.className='doc-title';title.textContent=label;
          input=document.createElement('input');input.id=id;input.type='file';input.accept='.pdf,application/pdf,image/jpeg,image/png,image/webp,image/*';
          input.dataset.noTitlecase='true';
          const st=document.createElement('span');st.id=statusId;st.className='doc-status';st.textContent='PDF ou foto. O sistema tenta preencher os campos automaticamente.';
          box.append(title,input,st);grid.appendChild(box);return input
        }
        function setStatus(id,msg,kind=''){
          const el=byId(id);if(!el)return;
          el.className='doc-status'+(kind?' '+kind:'');el.innerHTML=msg
        }
        function fieldGrid(id){
          const el=byId(id);if(!el)return null;
          return el.closest('.coleta-form-grid')||el.closest('.coleta-form-card')?.querySelector('.coleta-form-grid')||el.closest('form')||el.parentElement?.parentElement||null
        }
        function ensureFields(){
          const motorCard=cardByTitle('Dados do Motorista'),truckCard=cardByTitle('Dados do Caminhão'),senderCard=cardByTitle('Coleta'),recipientCard=cardByTitle('Entrega');
          const senderGrid=fieldGrid('cliente')||fieldGrid('endereco_coleta')||senderCard?.querySelector('.coleta-form-grid');
          const recipientGrid=fieldGrid('destinatario')||fieldGrid('endereco_entrega')||recipientCard?.querySelector('.coleta-form-grid');
          const motorGrid=fieldGrid('motorista')||fieldGrid('telefone_motorista')||motorCard?.querySelector('.coleta-form-grid');
          const truckGrid=fieldGrid('placa')||fieldGrid('eixos')||truckCard?.querySelector('.coleta-form-grid');

          if(senderGrid){
            addHistorySelect(senderGrid,'historico_remetente','Escolher remetente já utilizado','Escolha um remetente do histórico')
          }
          if(recipientGrid){
            addHistorySelect(recipientGrid,'historico_destinatario','Escolher destinatário já utilizado','Escolha um destinatário do histórico')
          }
          if(motorGrid){
            addHistorySelect(motorGrid,'historico_motorista','Escolher motorista já utilizado','Escolha um motorista do histórico');
            const cpf=addInput(motorGrid,'motorista_cpf','CPF do motorista','text',{placeholder:'000.000.000-00',inputmode:'numeric',noTitlecase:true});
            cpf.maxLength=14;
            if(!cpf.dataset.docBound){cpf.dataset.docBound='1';cpf.addEventListener('input',()=>{cpf.value=formatCpf(cpf.value)})}
            const up=addUpload(motorGrid,'doc_motorista_file','Importar documento do motorista','doc_motorista_status');
            bindUpload(up,'motorista','doc_motorista_status')
          }
          if(truckGrid){
            const placa=byId('placa');if(placa){placa.dataset.noTitlecase='true';const s=placa.closest('label')?.querySelector('span');if(s)s.textContent='Placa do cavalo mecânico'}
            const total=byId('eixos');if(total){const s=total.closest('label')?.querySelector('span');if(s)s.textContent='Total de eixos';total.min='0';total.max='20'}
            const capC=addInput(truckGrid,'capacidade_carga_cavalo','Capacidade de carga do cavalo','text',{placeholder:'Ex.: 16.000 kg',noTitlecase:true});
            const eixC=addInput(truckGrid,'eixos_cavalo','Eixos do cavalo','number',{min:'0',max:'20',noTitlecase:true});
            const docC=addUpload(truckGrid,'doc_cavalo_file','Subir documento do cavalo mecânico','doc_cavalo_status');
            const placaT=addInput(truckGrid,'placa_carreta','Placa da carreta','text',{placeholder:'ABC1D23',noTitlecase:true});
            placaT.maxLength=8;
            const capT=addInput(truckGrid,'capacidade_carga_carreta','Capacidade de carga da carreta','text',{placeholder:'Ex.: 28.000 kg',noTitlecase:true});
            const eixT=addInput(truckGrid,'eixos_carreta','Eixos da carreta','number',{min:'0',max:'20',noTitlecase:true});
            const docT=addUpload(truckGrid,'doc_carreta_file','Subir documento da carreta','doc_carreta_status');
            if(!placaT.dataset.docBound){placaT.dataset.docBound='1';placaT.addEventListener('input',()=>{placaT.value=placaT.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)})}
            if(placa&&!placa.dataset.docPlateBound){placa.dataset.docPlateBound='1';placa.addEventListener('input',()=>{placa.value=placa.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)})}
            [eixC,eixT].forEach(x=>{if(x&&!x.dataset.sumBound){x.dataset.sumBound='1';x.addEventListener('input',sumAxes)}});
            bindUpload(docC,'cavalo','doc_cavalo_status');bindUpload(docT,'carreta','doc_carreta_status')
          }
          bindRefreshDocumentButton()
        }
        function sumAxes(){
          const a=Number(byId('eixos_cavalo')?.value||0),b=Number(byId('eixos_carreta')?.value||0);
          if((byId('eixos_cavalo')?.value||'')!==''||(byId('eixos_carreta')?.value||'')!==''){
            const total=byId('eixos');if(total)total.value=String(a+b)
          }
        }
        function loadScript(src,id){
          return new Promise((resolve,reject)=>{
            if(window[id])return resolve(window[id]);
            const prior=document.querySelector('script[data-doc-lib="'+id+'"]');
            if(prior){prior.addEventListener('load',()=>resolve(window[id]));prior.addEventListener('error',reject);return}
            const s=document.createElement('script');s.src=src;s.async=true;s.dataset.docLib=id;
            s.onload=()=>resolve(window[id]);s.onerror=()=>reject(new Error('Não foi possível carregar o leitor automático.'));
            document.head.appendChild(s)
          })
        }
        async function ensurePdf(){
          if(window.pdfjsLib)return window.pdfjsLib;
          await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js','pdfjsLib');
          window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
          return window.pdfjsLib
        }
        async function ensureOcr(){
          if(window.Tesseract)return window.Tesseract;
          await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
          return window.Tesseract
        }
        function fileDataUrl(file){
          return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));fr.readAsDataURL(file)})
        }
        async function storageDataUrl(file){
          if(file.type==='application/pdf'){
            if(file.size>7*1024*1024)throw new Error('PDF maior que 7 MB.');
            return fileDataUrl(file)
          }
          if(!String(file.type||'').startsWith('image/'))throw new Error('Use PDF ou imagem.');
          const src=await fileDataUrl(file);
          const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Imagem inválida.'));im.src=src});
          const max=2200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
          const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);
          return canvas.toDataURL('image/jpeg',.86)
        }
        async function ocrSource(source,statusId){
          const T=await ensureOcr();
          const result=await T.recognize(source,'por',{logger:m=>{
            if(m.status==='recognizing text')setStatus(statusId,'<span class="doc-reading">Lendo documento '+Math.round((m.progress||0)*100)+'%</span>')
          }});
          return result?.data?.text||''
        }
        async function extractText(file,statusId){
          if(file.type==='application/pdf'){
            const pdfjs=await ensurePdf(),buf=await file.arrayBuffer(),pdf=await pdfjs.getDocument({data:buf}).promise;
            let text='';
            const maxPages=Math.min(pdf.numPages,3);
            for(let n=1;n<=maxPages;n++){
              const page=await pdf.getPage(n),tc=await page.getTextContent();
              text+='\n'+tc.items.map(x=>x.str||'').join(' ')
            }
            if(norm(text).length>80)return text;
            for(let n=1;n<=Math.min(pdf.numPages,2);n++){
              const page=await pdf.getPage(n),vp=page.getViewport({scale:1.7}),canvas=document.createElement('canvas');
              canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
              await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
              text+='\n'+await ocrSource(canvas,statusId)
            }
            return text
          }
          return ocrSource(file,statusId)
        }
        function linesOf(text){return String(text||'').split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)}
        function parseCpf(text){
          const t=String(text||''),m=t.match(/\b(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})\b/);
          return m?m[1]+m[2]+m[3]+m[4]:''
        }
        function cleanPersonName(v){
          return String(v||'').replace(/^(NOME(?: E SOBRENOME)?|NOME DO CONDUTOR)\s*[:\-]?\s*/i,'').replace(/[^A-Za-zÀ-ÿ'\-\s]/g,' ').replace(/\s+/g,' ').trim()
        }
        function parseDriver(text){
          const lines=linesOf(text),cpf=parseCpf(text);let nome='';
          for(let i=0;i<lines.length;i++){
            const n=norm(lines[i]);
            if(/^(NOME|NOME E SOBRENOME|NOME DO CONDUTOR)\b/.test(n)&&!/PAI|MAE|FILIA/.test(n)){
              let cand=cleanPersonName(lines[i]);
              if(norm(cand)==='NOME'||norm(cand)==='NOME E SOBRENOME'||cand.length<5)cand=cleanPersonName(lines[i+1]||'');
              if(cand.split(' ').filter(Boolean).length>=2&&cand.length>=6){nome=titleCase(cand);break}
            }
          }
          return{nome,cpf}
        }
        function parsePlate(text){
          const lines=linesOf(text);
          for(let i=0;i<lines.length;i++){
            if(/PLACA/i.test(norm(lines[i]))){
              const s=(lines[i]+' '+(lines[i+1]||'')).toUpperCase().replace(/[^A-Z0-9]/g,' ');
              const m=s.match(/\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/);if(m)return m[0]
            }
          }
          const all=String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,' ');
          const m=all.match(/\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/);return m?m[0]:''
        }
        function parseAxes(text){
          const t=norm(text),m=t.match(/(?:QTD\.?\s*)?EIXOS?\s*[:\-]?\s*(\d{1,2})\b/);
          return m?Number(m[1]):null
        }
        function parseCapacity(text){
          const t=norm(text);
          const labels=['CAPACIDADE DE CARGA','CAPACIDADE CARGA','CAP CARGA','CARGA UTIL'];
          for(const label of labels){
            const p=t.indexOf(label);if(p<0)continue;
            const frag=t.slice(p+label.length,p+label.length+80);
            const m=frag.match(/([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]+)?)\s*(KG|T|TON|TONELADAS?)?/);
            if(m)return m[1]+(m[2]?' '+m[2]:'')
          }
          return''
        }
        function parseVehicle(text){return{placa:parsePlate(text),eixos:parseAxes(text),capacidade:parseCapacity(text)}}
        function applyDriver(d){
          if(d.nome&&byId('motorista'))byId('motorista').value=d.nome;
          if(d.cpf&&byId('motorista_cpf'))byId('motorista_cpf').value=formatCpf(d.cpf)
        }
        function applyVehicle(tipo,d){
          if(tipo==='cavalo'){
            if(d.placa&&byId('placa'))byId('placa').value=d.placa;
            if(d.capacidade&&byId('capacidade_carga_cavalo'))byId('capacidade_carga_cavalo').value=d.capacidade;
            if(d.eixos!==null&&byId('eixos_cavalo'))byId('eixos_cavalo').value=String(d.eixos)
          }else{
            if(d.placa&&byId('placa_carreta'))byId('placa_carreta').value=d.placa;
            if(d.capacidade&&byId('capacidade_carga_carreta'))byId('capacidade_carga_carreta').value=d.capacidade;
            if(d.eixos!==null&&byId('eixos_carreta'))byId('eixos_carreta').value=String(d.eixos)
          }
          sumAxes()
        }
        async function processDocumentFile(file,tipo,statusId){
          if(!file)return false;
          try{
            setStatus(statusId,'<span class="doc-reading">Lendo documento…</span>');
            const stored=await storageDataUrl(file);
            pendingDocs[tipo]={tipo,nome_arquivo:file.name||('documento-'+tipo),arquivo:stored};
            const text=await extractText(file,statusId);
            if(tipo==='motorista'){
              const d=parseDriver(text);applyDriver(d);
              const found=[d.nome?'nome':'',d.cpf?'CPF':''].filter(Boolean);
              setStatus(statusId,found.length?'✓ '+esc(found.join(' e '))+' preenchido(s). Confira antes de salvar.':'Documento anexado, mas nome/CPF não foram reconhecidos. Preencha manualmente.','ok');
              return found.length>0
            }else{
              const d=parseVehicle(text);applyVehicle(tipo,d);
              const found=[d.placa?'placa':'',d.capacidade?'capacidade':'',d.eixos!==null?'eixos':''].filter(Boolean);
              setStatus(statusId,found.length?'✓ '+esc(found.join(', '))+' preenchido(s). Confira antes de salvar.':'Documento anexado, mas os dados não foram reconhecidos. Preencha manualmente.','ok');
              return found.length>0
            }
          }catch(e){
            setStatus(statusId,'Documento selecionado. Leitura automática indisponível: '+esc(e.message)+'. Você pode preencher os campos manualmente e salvar.','err');
            try{pendingDocs[tipo]={tipo,nome_arquivo:file.name||('documento-'+tipo),arquivo:await storageDataUrl(file)}}catch{}
            return false
          }
        }
        function bindUpload(input,tipo,statusId){
          if(!input||input.dataset.boundDoc==='1')return;
          input.dataset.boundDoc='1';
          input.addEventListener('change',async()=>{
            const file=input.files?.[0];if(!file)return;
            await processDocumentFile(file,tipo,statusId)
          })
        }
        async function storedDocumentFile(tipo){
          const id=currentId();if(!id)return null;
          try{
            const r=await docBaseFetch('/api/painel/coletas-documentos/'+encodeURIComponent(id)+'/'+encodeURIComponent(tipo)+'?t='+Date.now(),{cache:'no-store'});
            if(!r.ok)return null;
            const blob=await r.blob();if(!blob.size)return null;
            let ext='bin';
            if(blob.type==='application/pdf')ext='pdf';
            else if(blob.type==='image/jpeg')ext='jpg';
            else if(blob.type==='image/png')ext='png';
            else if(blob.type==='image/webp')ext='webp';
            return new File([blob],'documento-'+tipo+'.'+ext,{type:blob.type||'application/octet-stream'})
          }catch{return null}
        }
        async function refreshDocumentData(){
          const btn=byId('doc_refresh_data'),status=byId('doc_refresh_status');
          if(status){status.className='doc-status';status.innerHTML='<span class="doc-reading">Preparando documentos…</span>'}
          const defs=[
            {input:byId('doc_motorista_file'),tipo:'motorista',status:'doc_motorista_status'},
            {input:byId('doc_cavalo_file'),tipo:'cavalo',status:'doc_cavalo_status'},
            {input:byId('doc_carreta_file'),tipo:'carreta',status:'doc_carreta_status'}
          ];
          if(btn){btn.disabled=true;btn.textContent='Atualizando dados…'}
          try{
            const items=[];
            for(const d of defs){
              let file=d.input?.files?.[0]||null;
              let origem='anexado agora';
              if(!file){
                file=await storedDocumentFile(d.tipo);
                origem='salvo na coleta'
              }
              if(file)items.push({...d,file,origem})
            }
            if(!items.length){
              if(status){
                status.className='doc-status err';
                status.textContent=currentId()
                  ?'Nenhum documento anexado ou salvo foi encontrado nesta coleta.'
                  :'Anexe pelo menos um documento do motorista, cavalo ou carreta antes de atualizar.'
              }
              return
            }
            if(status){status.className='doc-status';status.innerHTML='<span class="doc-reading">Lendo '+items.length+' documento(s)…</span>'}
            let ok=0;
            const erros=[];
            for(const item of items){
              try{
                if(await processDocumentFile(item.file,item.tipo,item.status))ok++
                else erros.push(item.tipo)
              }catch(e){erros.push(item.tipo)}
            }
            sumAxes();
            if(status){
              if(ok){
                status.className='doc-status ok';
                status.textContent='✓ Dados atualizados por '+ok+' documento(s). Confira nome, CPF, placas, capacidades e eixos antes de salvar.'
              }else{
                status.className='doc-status err';
                status.textContent='Os documentos foram encontrados, mas nenhum dado pôde ser reconhecido. Veja a mensagem exibida abaixo de cada documento.'
              }
            }
          }catch(e){
            if(status){status.className='doc-status err';status.textContent='Erro ao atualizar dados: '+String(e.message||e)}
          }finally{
            if(btn){btn.disabled=false;btn.textContent='↻ Atualizar dados dos documentos'}
          }
        }
        window.__refreshColetaDocumentData=refreshDocumentData;
        function bindRefreshDocumentButton(){
          const btn=byId('doc_refresh_data');
          if(!btn)return;
          btn.dataset.boundRefresh='1'
        }
        if(!window.__coletaDocRefreshDelegated){
          window.__coletaDocRefreshDelegated=true;
          document.addEventListener('click',e=>{
            const btn=e.target?.closest?.('#doc_refresh_data');
            if(!btn)return;
            e.preventDefault();
            e.stopPropagation();
            if(btn.dataset.refreshRunning==='1')return;
            btn.dataset.refreshRunning='1';
            Promise.resolve(refreshDocumentData()).finally(()=>{btn.dataset.refreshRunning='0'})
          },true)
        }
        async function saveExtras(id){
          const body={
            motorista_cpf:digits(byId('motorista_cpf')?.value||''),
            placa_carreta:byId('placa_carreta')?.value||'',
            capacidade_carga_cavalo:byId('capacidade_carga_cavalo')?.value||'',
            eixos_cavalo:byId('eixos_cavalo')?.value||'',
            capacidade_carga_carreta:byId('capacidade_carga_carreta')?.value||'',
            eixos_carreta:byId('eixos_carreta')?.value||'',
            eixos_total:byId('eixos')?.value||''
          };
          const r=await docBaseFetch('/api/painel/coletas-documentais/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Falha ao salvar dados dos documentos.')}
        }
        async function uploadPending(id){
          for(const tipo of ['motorista','cavalo','carreta']){
            const doc=pendingDocs[tipo];if(!doc)continue;
            const r=await docBaseFetch('/api/painel/coletas-documentos/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)});
            if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||('Falha ao salvar documento '+tipo+'.'))}
            const st=tipo==='motorista'?'doc_motorista_status':(tipo==='cavalo'?'doc_cavalo_status':'doc_carreta_status');
            setStatus(st,'✓ Documento salvo com a coleta.','ok')
          }
          pendingDocs={motorista:null,cavalo:null,carreta:null}
        }
        async function loadExistingDocs(id){
          if(!id)return;
          try{
            const r=await docBaseFetch('/api/painel/coletas-documentos/'+encodeURIComponent(id),{cache:'no-store'});
            const j=await r.json();if(!r.ok||!j.ok)return;
            (j.rows||[]).forEach(d=>{
              const st=d.tipo==='motorista'?'doc_motorista_status':(d.tipo==='cavalo'?'doc_cavalo_status':'doc_carreta_status');
              const href='/api/painel/coletas-documentos/'+encodeURIComponent(id)+'/'+encodeURIComponent(d.tipo);
              setStatus(st,'✓ Documento salvo: <a href="'+href+'" target="_blank" rel="noopener">'+esc(d.nome_arquivo||'Abrir documento')+'</a>','ok')
            })
          }catch{}
        }
        async function loadFields(){
          ensureFields();
          const modal=byId('modal');if(!modal?.open)return;
          const id=currentId(),key=String(Date.now())+'|'+id;
          lastOpenKey=key;pendingDocs={motorista:null,cavalo:null,carreta:null};
          ['doc_motorista_file','doc_cavalo_file','doc_carreta_file'].forEach(x=>{const el=byId(x);if(el)el.value=''});
          if(!id){
            ['motorista_cpf','placa_carreta','capacidade_carga_cavalo','eixos_cavalo','capacidade_carga_carreta','eixos_carreta'].forEach(x=>{const el=byId(x);if(el)el.value=''});
            setStatus('doc_motorista_status','PDF ou foto. O sistema tenta preencher nome e CPF automaticamente.');
            setStatus('doc_cavalo_status','PDF ou foto. O sistema tenta preencher placa, capacidade e eixos.');
            setStatus('doc_carreta_status','PDF ou foto. O sistema tenta preencher placa, capacidade e eixos.');
            return
          }
          try{
            const r=await docBaseFetch('/coletas/api/coletas',{cache:'no-store'}),rows=await r.json();
            const co=(Array.isArray(rows)?rows:[]).find(x=>String(x.id)===id);
            if(co){
              if(byId('motorista_cpf'))byId('motorista_cpf').value=formatCpf(co.motorista_cpf||'');
              if(byId('placa_carreta'))byId('placa_carreta').value=String(co.placa_carreta||'').toUpperCase();
              if(byId('capacidade_carga_cavalo'))byId('capacidade_carga_cavalo').value=co.capacidade_carga_cavalo||'';
              if(byId('eixos_cavalo'))byId('eixos_cavalo').value=co.eixos_cavalo??'';
              if(byId('capacidade_carga_carreta'))byId('capacidade_carga_carreta').value=co.capacidade_carga_carreta||'';
              if(byId('eixos_carreta'))byId('eixos_carreta').value=co.eixos_carreta??''
            }
          }catch{}
          await loadExistingDocs(id)
        }

        window.fetch=async function(input,init={}){
          const res=await docBaseFetch(input,init);
          try{
            const url=typeof input==='string'?input:(input?.url||'');
            const method=String(init?.method||'GET').toUpperCase();
            if(res.ok&&/^\/coletas\/api\/coletas(?:\/\d+)?$/.test(url)&&(method==='POST'||method==='PUT')){
              const data=await res.clone().json();
              if(data?.id){await saveExtras(data.id);await uploadPending(data.id)}
            }
          }catch(e){console.warn('Documentos da coleta:',e);alert('A coleta foi salva, mas houve problema ao salvar os dados/documentos: '+e.message)}
          return res
        };

        document.addEventListener('DOMContentLoaded',()=>{
          [50,150,350,700,1200].forEach(ms=>setTimeout(()=>{ensureFields();if(ms>=350)refreshHistorySelectors()},ms));
          const modal=byId('modal');
          if(modal){
            const obs=new MutationObserver(()=>{if(modal.open)setTimeout(()=>{loadFields();refreshHistorySelectors()},100)});
            obs.observe(modal,{attributes:true,attributeFilter:['open']})
          }
          setTimeout(refreshHistorySelectors,180);
          document.addEventListener('click',()=>{[40,150,400].forEach(ms=>setTimeout(()=>{ensureFields();if(byId('modal')?.open)refreshHistorySelectors()},ms))},true)
        })
      })();
      </script>`;

      const bodyClose=html.lastIndexOf('</body>');
      if(bodyClose>=0){
        html=html.slice(0,bodyClose)+recebimentoAddon+documentoAddon+html.slice(bodyClose);
      }
    }

    const newFront=zlib.gzipSync(Buffer.from(html,'utf8')).toString('base64');
    src=src.replace(fm[0],"const FRONTEND_B64='"+newFront+"'");
  }

  src=src.replaceAll("['Cliente',c.cliente||'-']","['Remetente',c.cliente||'-']");
  src=src.replaceAll("Cliente da entrega","Remetente");
}catch(e){
  console.error('Ajuste visual do módulo de coletas não aplicado:',e.message);
}

eval(src);
