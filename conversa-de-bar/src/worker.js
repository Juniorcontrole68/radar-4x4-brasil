const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const MODE={
  bar:"Converse em português do Brasil de forma natural, leve e descontraída, como uma boa conversa de bar. Seja atenta, espirituosa e breve.",
  apoio:"Ofereça apoio conversacional acolhedor. Ajude a organizar pensamentos e sentimentos sem diagnosticar, prescrever tratamento ou se apresentar como psicóloga ou terapeuta.",
  companhia:"Seja uma companhia virtual feminina, calorosa, bem-humorada e carinhosa. Você é uma IA; nunca finja ser humana, namorada real, nem incentive exclusividade ou dependência emocional."
};
const BASE=`Você é Clara, a companhia virtual do aplicativo Conversa de Bar. Responda em português brasileiro, de forma natural para ser ouvida em voz alta. Prefira respostas curtas, normalmente de 2 a 5 frases, e faça no máximo uma pergunta por vez. Não use markdown desnecessário. Não diga que é psicóloga. Em risco imediato de autoagressão, suicídio ou violência, priorize segurança e incentive ajuda humana/emergencial adequada. As mensagens recebidas servem somente para gerar a resposta desta requisição; este Worker não grava histórico de conversa.`;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
function cleanHistory(history){if(!Array.isArray(history))return[];return history.slice(-16).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,3000)}))}
export default{
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/health')return json({ok:true,service:'conversa-de-bar',ai:Boolean(env.AI)});
  if(url.pathname==='/api/chat'&&request.method==='POST'){
   try{
    const body=await request.json();const message=String(body?.message||'').trim().slice(0,4000);const mode=MODE[body?.mode]||MODE.bar;
    if(!message)return json({error:'Mensagem vazia.'},400);
    const messages=[{role:'system',content:`${BASE}\n\nModo atual: ${mode}`},...cleanHistory(body?.history),{role:'user',content:message}];
    const result=await env.AI.run('@cf/meta/llama-3.1-8b-instruct',{messages,max_tokens:350,temperature:0.72});
    const reply=String(result?.response||result?.result?.response||'').trim();
    if(!reply)return json({error:'A IA não retornou uma resposta.'},502);
    return json({reply});
   }catch(err){return json({error:'Não consegui gerar a resposta agora.',detail:String(err?.message||err)},500)}
  }
  if(url.pathname.startsWith('/api/'))return json({error:'Rota não encontrada.'},404);
  return env.ASSETS.fetch(request);
 }
};
