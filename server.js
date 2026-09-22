require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PIN = String(process.env.APP_PIN || "").trim();
const DIARIO_API_BASE = String(process.env.DIARIO_API_BASE || "").replace(/\/$/,"");
const DIARIO_API_KEY = String(process.env.DIARIO_API_KEY || "").trim();

app.use(express.json({ limit: "35mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requirePin(req,res,next){
  if(!APP_PIN) return next();
  const supplied=String(req.header("x-app-pin")||"");
  if(supplied!==APP_PIN) return res.status(401).json({error:"PIN inválido"});
  next();
}

async function remote(pathname, options={}){
  if(!DIARIO_API_BASE || !DIARIO_API_KEY) throw new Error("Sincronização online não configurada");
  const headers={"Content-Type":"application/json","x-diario-key":DIARIO_API_KEY,...(options.headers||{})};
  const r=await fetch(DIARIO_API_BASE+pathname,{...options,headers});
  const body=await r.text();
  let data={};
  try{data=body?JSON.parse(body):{};}catch{data={error:"Resposta inválida do servidor de dados"};}
  if(!r.ok) throw new Error(data.error||("Falha no servidor de dados ("+r.status+")"));
  return data;
}

app.get("/api/health",async(req,res)=>{
  try{
    const result=await remote("/health");
    res.json({ok:true,database:!!result.database,pinRequired:!!APP_PIN});
  }catch(e){
    res.status(503).json({ok:false,database:false,pinRequired:!!APP_PIN,error:e.message});
  }
});

app.use("/api",requirePin);

app.get("/api/state",async(req,res)=>{
  try{res.json(await remote("/state"));}
  catch(e){res.status(503).json({error:e.message});}
});

app.post("/api/sync",async(req,res)=>{
  try{res.json(await remote("/sync",{method:"POST",body:JSON.stringify(req.body||{})}));}
  catch(e){res.status(503).json({error:e.message});}
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>console.log("Diário de Bordo V2 rodando na porta "+PORT));
