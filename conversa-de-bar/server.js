import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const app=express();
const PORT=process.env.PORT||3000;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const MODEL=process.env.OPENAI_MODEL||'gpt-6-luna';

app.use(express.json({limit:'200kb'}));
app.use(express.static(path.join(__dirname,'public')));

const BASE=`Você é a voz do aplicativo Conversa de Bar. Fale sempre em português do Brasil, de forma natural, calorosa e breve, como numa conversa falada. Você é uma IA e nunca deve alegar ser humana, namorada real, psicóloga, terapeuta ou profissional de saúde. Não incentive dependência emocional, isolamento de pessoas reais ou exclusividade. Você pode ser carinhosa, bem-humorada e acolhedora. Evite listas longas: responda como fala. Quando houver indício de risco imediato de autoagressão, suicídio ou violência, priorize segurança, incentive procurar uma pessoa de confiança e ajuda de emergência local. Não faça diagnósticos.`;
const MODES={
  apoio:`Modo APOIO: escute sem julgamento, ajude a organizar pensamentos e sentimentos, faça no máximo uma pergunta por vez e ofereça sugestões práticas quando forem úteis. Não faça diagnóstico clínico.`,
  companhia:`Modo COMPANHIA: converse como uma companhia feminina carinhosa, leve e divertida. Pode demonstrar afeto e humor, mas deixe natural que você é uma companhia virtual, sem afirmar relacionamento real, exclusividade ou posse.`,
  bar:`Modo CONVERSA DE BAR: seja espontânea, descontraída, curiosa e bem-humorada. Converse sobre o assunto que o usuário trouxer e faça perguntas naturais quando couber.`
};

function cleanHistory(history){
  if(!Array.isArray(history)) return [];
  return history.slice(-16).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,2500)}));
}
function extractText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim()) return data.output_text.trim();
  for(const item of data?.output||[]) for(const part of item?.content||[]) if(typeof part?.text==='string'&&part.text.trim()) return part.text.trim();
  return '';
}

app.get('/health',(_req,res)=>res.json({ok:true,app:'Conversa de Bar',aiConfigured:Boolean(OPENAI_API_KEY)}));

app.post('/api/chat',async(req,res)=>{
  try{
    if(!OPENAI_API_KEY) return res.status(503).json({error:'A IA ainda não foi configurada no servidor. Adicione OPENAI_API_KEY.'});
    const message=String(req.body?.message||'').trim().slice(0,4000);
    const mode=['apoio','companhia','bar'].includes(req.body?.mode)?req.body.mode:'bar';
    if(!message) return res.status(400).json({error:'Fale ou escreva alguma coisa.'});
    const history=cleanHistory(req.body?.history);
    const input=[...history,{role:'user',content:message}];
    const r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'authorization':`Bearer ${OPENAI_API_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({model:MODEL,instructions:`${BASE}\n${MODES[mode]}`,input,max_output_tokens:500})
    });
    const data=await r.json();
    if(!r.ok){console.error('OpenAI error',r.status,data?.error?.message);return res.status(502).json({error:'Não consegui responder agora. Tente novamente em instantes.'});}
    const reply=extractText(data)||'Estou aqui. Pode continuar.';
    res.json({reply});
  }catch(err){console.error(err);res.status(500).json({error:'Falha temporária na conversa.'});}
});

app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`Conversa de Bar em http://0.0.0.0:${PORT}`));
