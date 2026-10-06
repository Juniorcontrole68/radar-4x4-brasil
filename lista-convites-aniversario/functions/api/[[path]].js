const KEY='lista-convites-aniversario:v1';
const IMAGE_KEY='lista-convites-aniversario:invite-image:v1';
const EMPTY={event:{title:'Nosso Aniversário',date:'',time:'',venue:'',address:'',message:'Vai ser muito legal ter você conosco!',canvaUrl:'',hasInviteImage:false},guests:[]};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
async function load(env){const data=await env.STATE.get(KEY,'json');return data||structuredClone(EMPTY)}
async function save(env,data){await env.STATE.put(KEY,JSON.stringify(data))}
function guestPublic(g){return{id:g.id,name:g.name,invited:g.invited,status:g.status,confirmed:g.confirmed}}
function decodeBase64(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes}
export async function onRequest({request,env,params}){
 try{
  if(!env.STATE)return json({error:'Binding KV STATE não configurado na Cloudflare.'},500);
  const method=request.method.toUpperCase();
  const path=Array.isArray(params.path)?params.path:String(params.path||'').split('/').filter(Boolean);

  if(method==='GET'&&path.length===1&&path[0]==='invite-image'){
    const img=await env.STATE.get(IMAGE_KEY,'json');if(!img)return new Response('Imagem não encontrada',{status:404});
    return new Response(decodeBase64(img.base64),{headers:{'content-type':img.mime||'image/jpeg','cache-control':'no-store'}});
  }

  const data=await load(env);
  data.event={...EMPTY.event,...(data.event||{})};
  if(method==='GET'&&path.length===1&&path[0]==='data')return json(data);

  if(method==='PUT'&&path.length===1&&path[0]==='event'){
    const body=await request.json();
    if(body.inviteImageData){
      const m=String(body.inviteImageData).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if(!m)return json({error:'Imagem inválida'},400);
      await env.STATE.put(IMAGE_KEY,JSON.stringify({mime:m[1],base64:m[2]}));
      data.event.hasInviteImage=true;
    }
    if(body.removeInviteImage){await env.STATE.delete(IMAGE_KEY);data.event.hasInviteImage=false}
    const clean={...body};delete clean.inviteImageData;delete clean.removeInviteImage;
    data.event={...data.event,...clean};
    await save(env,data);return json(data.event);
  }

  if(path[0]==='guests'){
    if(method==='POST'&&path.length===1){
      const body=await request.json();const guest={id:crypto.randomUUID(),name:String(body.name||'').trim(),phone:String(body.phone||'').replace(/\D/g,''),invited:Math.max(1,Number(body.invited||1)),confirmed:null,status:'pendente',sentAt:null,answeredAt:null,note:String(body.note||'').trim()};
      if(!guest.name)return json({error:'Nome obrigatório'},400);data.guests.push(guest);await save(env,data);return json(guest,201);
    }
    const id=path[1];const guest=data.guests.find(g=>g.id===id);if(!guest)return json({error:'Convidado não encontrado'},404);
    if(method==='PUT'&&path.length===2){
      const body=await request.json();Object.assign(guest,body);
      if(body.phone!==undefined)guest.phone=String(body.phone).replace(/\D/g,'');
      if(body.invited!==undefined)guest.invited=Math.max(1,Number(body.invited||1));
      await save(env,data);return json(guest);
    }
    if(method==='DELETE'&&path.length===2){data.guests=data.guests.filter(g=>g.id!==id);await save(env,data);return json({ok:true})}
    if(method==='POST'&&path.length===3&&path[2]==='mark-sent'){if(guest.status==='pendente')guest.status='enviado';guest.sentAt=new Date().toISOString();await save(env,data);return json(guest)}
  }

  if(path[0]==='invite'){
    const id=path[1];const guest=data.guests.find(g=>g.id===id);if(!guest)return json({error:'Convite não encontrado'},404);
    if(method==='GET'&&path.length===2)return json({event:data.event,guest:guestPublic(guest)});
    if(method==='POST'&&path.length===3&&path[2]==='respond'){
      const body=await request.json();
      let response=body.response;
      if(!response&&typeof body.going==='boolean')response=body.going?'yes':'no';
      if(response==='yes'){
        guest.status='confirmado';guest.confirmed=Math.max(1,Number(body.confirmed||1));guest.invited=guest.confirmed;
      }else if(response==='maybe'){
        guest.status='enviado';guest.confirmed=null;
      }else if(response==='no'){
        guest.status='nao-vai';guest.confirmed=0;
      }else return json({error:'Resposta inválida'},400);
      guest.answeredAt=new Date().toISOString();await save(env,data);return json({ok:true,guest});
    }
  }
  return json({error:'Rota não encontrada'},404);
 }catch(e){return json({error:e?.message||'Erro interno'},500)}
}