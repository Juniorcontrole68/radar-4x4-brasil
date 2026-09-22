async function queueDelete(entity,entityId){await put("deletes",{id:uid(),entity,entityId,createdAt:Date.now()})}
window.deleteItem=async(entity,id)=>{
  if(!confirm("Excluir este registro?"))return;
  const storeName={place:"places",expense:"expenses",trip:"trips",gps:"gps"}[entity];
  await del(storeName,id);await queueDelete(entity,id);await refresh();syncNow(true)
};

function currentActiveTripOrWarn(){if(!activeTrip){toast("Inicie uma viagem primeiro.");return null}return activeTrip}
async function createTrip(){
  const name=$("tripName").value.trim();if(!name)return;
  const t={id:uid(),name,vehicle:$("tripVehicle").value.trim(),startKm:Number($("tripStartKm").value||0)||null,notes:$("tripNotes").value.trim(),startedAt:Date.now(),finishedAt:null,updatedAt:Date.now()};
  await put("trips",t);activeTrip=t;selectedTripId=t.id;$("tripForm").reset();$("tripDialog").close();await refresh();syncNow(true);toast("Viagem iniciada.")
}
async function finishTrip(){
  if(!activeTrip||!confirm("Encerrar a viagem ativa?"))return;stopTracking();activeTrip.finishedAt=Date.now();activeTrip.updatedAt=Date.now();await put("trips",activeTrip);selectedTripId=activeTrip.id;activeTrip=null;await refresh();syncNow(true);toast("Viagem encerrada.")
}

function capturePosition(){return new Promise((res,rej)=>{if(!navigator.geolocation)return rej(new Error("GPS indisponível."));navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,ts:Date.now()}),e=>rej(new Error(e.message||"Falha no GPS")),{enableHighAccuracy:true,timeout:15000,maximumAge:4000})})}
async function startTracking(){
  const trip=currentActiveTripOrWarn();if(!trip)return;if(gpsWatchId!==null)return;
  $("startGpsBtn").disabled=true;$("stopGpsBtn").disabled=false;$("trackingBadge").className="status on";$("trackingBadge").textContent="Rastreando";
  gpsWatchId=navigator.geolocation.watchPosition(async p=>{
    const pt={id:uid(),tripId:trip.id,lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,ts:Date.now(),updatedAt:Date.now()};
    const last=gpsPoints[gpsPoints.length-1];let save=true;
    if(last){const d=haversine(last,pt),sec=(pt.ts-last.ts)/1000;if(d<.005&&sec<20)save=false}
    updateLastPosition(pt);
    if(save&&pt.accuracy<=100){gpsPoints.push(pt);await put("gps",pt);await refresh(false);if(gpsPoints.length%5===0)syncNow(true)}
  },e=>{toast("GPS: "+e.message);stopTracking()},{enableHighAccuracy:true,maximumAge:3000,timeout:15000})
}
function stopTracking(){if(gpsWatchId!==null){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;syncNow(true)}$("startGpsBtn").disabled=false;$("stopGpsBtn").disabled=true;$("trackingBadge").className="status off";$("trackingBadge").textContent="Parado"}
function updateLastPosition(p){$("lastPosition").textContent=`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} • ±${Math.round(p.accuracy||0)}m`;$("gpsAccuracy").textContent=`Precisão: ±${Math.round(p.accuracy||0)} m`;$("mapLink").href=`https://www.google.com/maps?q=${p.lat},${p.lon}`;$("mapLink").classList.remove("hidden")}

async function fileData(file,max=1500,q=.8){
  if(!file)return null;const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});
  return new Promise(res=>{const img=new Image();img.onload=()=>{let w=img.width,h=img.height,r=Math.min(1,max/Math.max(w,h));w=Math.round(w*r);h=Math.round(h*r);const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(img,0,0,w,h);res(c.toDataURL("image/jpeg",q))};img.src=raw})
}
async function savePlace(){
  const trip=currentActiveTripOrWarn();if(!trip)return;const name=$("placeName").value.trim();if(!name)return;
  const photos=[];for(const f of [...$("placePhotos").files].slice(0,10))photos.push(await fileData(f,1500,.8));
  const p={id:uid(),tripId:trip.id,name,date:$("placeDate").value,time:$("placeTime").value,notes:$("placeNotes").value.trim(),rating:$("placeRating").value?Number($("placeRating").value):null,photos,lat:placeLocation?.lat||null,lon:placeLocation?.lon||null,createdAt:Date.now(),updatedAt:Date.now()};
  await put("places",p);$("placeForm").reset();placeLocation=null;$("placeLocationText").textContent="Sem localização";$("placeDialog").close();selectedTripId=trip.id;await refresh();syncNow(true);toast("Lugar salvo.")
}

function brNumber(s){
  s=String(s||"").replace(/[^\d,.\-]/g,"");
  if(!s)return null;
  if(s.includes(",")&&s.includes(".")){
    s=s.lastIndexOf(",")>s.lastIndexOf(".")?s.replace(/\./g,"").replace(",","."):s.replace(/,/g,"");
  }else if(s.includes(","))s=s.replace(",",".");
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}

function parseReceipt(text){
  const raw=String(text||"");
  const t=raw.replace(/\s+/g," ");
  const out={amount:null,liters:null,unitPrice:null,date:null,fuelType:null};

  const totalPatterns=[
    /(?:valor\s*total|total\s*a\s*pagar|valor\s*a\s*pagar|total\s*geral|vl\.?\s*total)\s*[:\-]?\s*(?:r\$)?\s*([\d.,]+)/i,
    /(?:total)\s*(?:r\$)?\s*[:\-]?\s*([\d.,]+)/i,
    /(?:r\$)\s*([\d.,]+)\s*(?:total|a\s*pagar)?/i
  ];
  for(const re of totalPatterns){
    const m=t.match(re);
    if(m){
      const n=brNumber(m[1]);
      if(n&&n>1&&n<10000){out.amount=n;break;}
    }
  }

  const literPatterns=[
    /(?:litros?|volume|quantidade\s*(?:de\s*combust[ií]vel)?|qtd\.?|qtde\.?)\s*[:\-]?\s*([\d.,]+)\s*(?:l|lt|litros?)?/i,
    /([\d.,]+)\s*(?:l|lt|litros?)\b/i
  ];
  for(const re of literPatterns){
    const m=t.match(re);
    if(m){
      const n=brNumber(m[1]);
      if(n&&n>=0.5&&n<500){out.liters=n;break;}
    }
  }

  const unitPatterns=[
    /(?:pre[cç]o\s*(?:unit[aá]rio)?|valor\s*(?:unit[aá]rio)?|vl\.?\s*unit[aá]rio|r\$\s*\/\s*l|pre[cç]o\s*\/\s*l)\s*[:\-]?\s*(?:r\$)?\s*([\d.,]+)/i,
    /(?:unit[aá]rio)\s*(?:r\$)?\s*([\d.,]+)/i
  ];
  for(const re of unitPatterns){
    const m=t.match(re);
    if(m){
      const n=brNumber(m[1]);
      if(n&&n>1&&n<30){out.unitPrice=n;break;}
    }
  }

  // Formato comum em abastecimentos: 42,350 X 5,899
  const mult=t.match(/([\d]{1,3}[.,][\d]{2,3})\s*[xX*]\s*(?:r\$\s*)?([\d]{1,2}[.,][\d]{2,3})/);
  if(mult){
    const q=brNumber(mult[1]), u=brNumber(mult[2]);
    if(!out.liters&&q>=0.5&&q<500)out.liters=q;
    if(!out.unitPrice&&u>1&&u<30)out.unitPrice=u;
    if(!out.amount&&q&&u){
      const product=q*u;
      if(product>1&&product<10000)out.amount=product;
    }
  }

  const dateMatch=t.match(/\b([0-3]\d)[\/\-.]([01]\d)[\/\-.](20\d{2})\b/);
  if(dateMatch)out.date=`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

  const fuelMatch=t.match(/\b(DIESEL\s*S\s*-?\s*10|DIESEL\s*S\s*-?\s*500|GASOLINA\s*COMUM|GASOLINA\s*ADITIVADA|ETANOL(?:\s*HIDRATADO)?)\b/i);
  if(fuelMatch)out.fuelType=fuelMatch[1].replace(/\s+/g," ").toUpperCase();

  if(!out.unitPrice&&out.amount&&out.liters)out.unitPrice=out.amount/out.liters;
  if(!out.amount&&out.liters&&out.unitPrice)out.amount=out.liters*out.unitPrice;

  return out;
}

async function prepareOcrSource(file){
  const data=await new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
  const img=await new Promise((resolve,reject)=>{
    const i=new Image();
    i.onload=()=>resolve(i);
    i.onerror=reject;
    i.src=data;
  });

  const max=1900;
  const scale=Math.min(1,max/Math.max(img.width,img.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(img.width*scale));
  canvas.height=Math.max(1,Math.round(img.height*scale));
  const ctx=canvas.getContext("2d");
  ctx.drawImage(img,0,0,canvas.width,canvas.height);

  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  const d=image.data;
  for(let i=0;i<d.length;i+=4){
    const gray=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const contrast=Math.max(0,Math.min(255,(gray-128)*1.35+128));
    d[i]=d[i+1]=d[i+2]=contrast;
  }
  ctx.putImageData(image,0,0);
  return canvas;
}

async function runOCR(file){
  if(!file)return toast("Tire ou selecione uma foto da NF primeiro.");
  $("ocrBox").classList.remove("hidden");
  $("ocrProgress").value=0;
  $("ocrStatus").textContent="Preparando...";
  $("readReceiptBtn").disabled=true;

  try{
    if(!window.Tesseract)throw new Error("Leitor OCR indisponível");
    const source=await prepareOcrSource(file);
    $("ocrStatus").textContent="Lendo...";
    const r=await Tesseract.recognize(source,"por",{
      logger:m=>{
        if(m.status==="recognizing text"){
          $("ocrProgress").value=m.progress||0;
          $("ocrStatus").textContent=`${Math.round((m.progress||0)*100)}%`;
        }
      }
    });

    const p=parseReceipt(r.data.text||"");
    if(p.amount)$("expenseAmount").value=p.amount.toFixed(2);
    if(p.liters)$("fuelLiters").value=p.liters.toFixed(3);
    if(p.unitPrice)$("fuelUnitPrice").value=p.unitPrice.toFixed(3);
    if(p.date)$("expenseDate").value=p.date;
    if(p.fuelType&&!$("expenseDescription").value.trim())$("expenseDescription").value=p.fuelType;

    const found=[];
    if(p.amount)found.push("valor "+money(p.amount));
    if(p.liters)found.push(num(p.liters,3)+" L");
    if(p.unitPrice)found.push(money(p.unitPrice)+"/L");

    $("ocrStatus").textContent="Concluído";
    $("ocrProgress").value=1;
    $("ocrHint").textContent=found.length
      ? "Encontrado: "+found.join(" • ")+". Confira os campos antes de salvar."
      : "Não consegui identificar os valores com segurança. Tente outra foto mais próxima e bem iluminada.";
    toast(found.length?"NF lida. Confira os valores preenchidos.":"Não consegui ler os valores da NF.");
  }catch(e){
    $("ocrStatus").textContent="Falha";
    $("ocrHint").textContent="Não foi possível ler a foto. Tente novamente com a nota inteira, sem sombra e com boa luz.";
    toast("Falha ao ler a NF.");
  }finally{
    $("readReceiptBtn").disabled=!$("receiptPhoto").files[0];
  }
}

function resetReceiptReader(){
  $("ocrBox").classList.add("hidden");
  $("ocrProgress").value=0;
  $("ocrStatus").textContent="Aguardando";
  $("ocrHint").textContent="Tentarei identificar valor total, litros e preço por litro.";
  $("receiptPreviewBox").classList.add("hidden");
  $("receiptPreview").removeAttribute("src");
  $("receiptFileName").textContent="";
  $("readReceiptBtn").disabled=true;
}

function showReceiptPreview(file){
  if(!file)return resetReceiptReader();
  const url=URL.createObjectURL(file);
  $("receiptPreview").src=url;
  $("receiptPreview").onload=()=>URL.revokeObjectURL(url);
  $("receiptFileName").textContent=file.name||"Foto da NF";
  $("receiptPreviewBox").classList.remove("hidden");
  $("readReceiptBtn").disabled=false;
}
async function saveExpense(){
  const trip=currentActiveTripOrWarn();if(!trip)return;const amount=Number($("expenseAmount").value||0);if(amount<0)return;
  const file=$("receiptPhoto").files[0],receipt=file?await fileData(file,1500,.78):null;
  const e={id:uid(),tripId:trip.id,category:$("expenseCategory").value,description:$("expenseDescription").value.trim(),amount,date:$("expenseDate").value,liters:Number($("fuelLiters").value||0)||null,unitPrice:Number($("fuelUnitPrice").value||0)||null,notes:$("expenseNotes").value.trim(),receipt,createdAt:Date.now(),updatedAt:Date.now()};
  await put("expenses",e);$("expenseForm").reset();$("ocrBox").classList.add("hidden");$("expenseDialog").close();selectedTripId=trip.id;await refresh();syncNow(true);toast("Gasto registrado.")
}

function setView(v){
  document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id===v));document.querySelectorAll(".nav-btn").forEach(x=>x.classList.toggle("active",x.dataset.view===v));
  if(v==="route")setTimeout(()=>routeMap?.invalidateSize(),100);window.scrollTo({top:0,behavior:"smooth"})
}

async function exportJSON(){const data={version:2,exportedAt:new Date().toISOString(),...(await snapshot())};delete data.deletes;downloadBlob(JSON.stringify(data,null,2),"diario-de-bordo-v2-backup.json","application/json")}
async function exportCSV(){const rows=(await tripData()).expenses,head=["data","categoria","descricao","valor","litros","preco_litro","observacoes"];const csv=[head.join(";"),...rows.map(e=>[e.date,categoryLabel(e.category),e.description,e.amount,e.liters||"",e.unitPrice||"",e.notes||""].map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";"))].join("\n");downloadBlob("\uFEFF"+csv,"gastos-viagem.csv","text/csv;charset=utf-8")}
function downloadBlob(c,n,t){const b=new Blob([c],{type:t}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000)}
async function importJSON(file){
  try{
    const d=JSON.parse(await file.text());
    for(const n of ["trips","places","expenses","gps"])for(const x of (d[n]||[])){x.updatedAt=x.updatedAt||Date.now();await put(n,x)}
    await refresh();await syncNow(true);toast("Backup importado.")
  }catch{toast("Backup inválido.")}
}

async function generatePDF(){
  const {trip,places,expenses,gps}=await tripData();if(!trip)return toast("Nenhuma viagem selecionada.");
  const {jsPDF}=window.jspdf||{};if(!jsPDF)return toast("Gerador de PDF indisponível.");
  const doc=new jsPDF({unit:"mm",format:"a4"}),W=210,margin=15;let y=20;
  const dist=calcDistance(gps),total=expenses.reduce((s,e)=>s+Number(e.amount||0),0),fuel=expenses.filter(e=>e.category==="combustivel"),liters=fuel.reduce((s,e)=>s+Number(e.liters||0),0);
  const line=(txt,size=11,bold=false)=>{doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);const lines=doc.splitTextToSize(txt,W-margin*2);if(y+lines.length*5>285){doc.addPage();y=18}doc.text(lines,margin,y);y+=lines.length*5+2};
  doc.setFillColor(23,63,42);doc.rect(0,0,W,45,"F");doc.setTextColor(255);doc.setFontSize(22);doc.setFont("helvetica","bold");doc.text("Diário de Bordo",margin,20);doc.setFontSize(14);doc.text(trip.name,margin,31);doc.setTextColor(20);
  y=56;line(`Veículo: ${trip.vehicle||"Não informado"}   |   Início: ${new Date(trip.startedAt).toLocaleString("pt-BR")}`,10);
  line(`Distância GPS: ${num(dist,1)} km   |   KM inicial: ${trip.startKm?num(trip.startKm,1):"não informado"}   |   Gasto total: ${money(total)}`,10);
  line(`Combustível: ${num(liters,2)} L   |   Média geral: ${liters?num(dist/liters,2)+" km/L":"—"}`,10);
  if(trip.notes){y+=3;line("Observações",13,true);line(trip.notes,10)}
  y+=3;line("Gastos por categoria",13,true);const sums={};expenses.forEach(e=>sums[e.category]=(sums[e.category]||0)+Number(e.amount||0));for(const [k,v] of Object.entries(sums).sort((a,b)=>b[1]-a[1]))line(`${categoryLabel(k)}: ${money(v)}`,10);
  y+=4;line("Lugares visitados",13,true);
  for(const p of [...places].sort((a,b)=>a.createdAt-b.createdAt)){
    if(y>245){doc.addPage();y=18}
    line(`${p.name}${p.date?` — ${p.date}`:""}`,12,true);if(p.notes)line(p.notes,9);
    const img=(p.photos||[])[0];if(img){try{doc.addImage(img,"JPEG",margin,y,55,42);y+=47}catch{}}
  }
  doc.save(`diario-${trip.name.replace(/[^\w\-]+/g,"-").toLowerCase()}.pdf`)
}

$("pinBtn").onclick=async()=>{
  const value=$("pinInput").value.trim();sessionStorage.setItem("diario_pin",value);
  try{await api("/api/state");$("loginOverlay").classList.add("hidden");toast("Acesso liberado.");await syncNow(true)}
  catch(e){sessionStorage.removeItem("diario_pin");toast("PIN inválido.")}
};
$("syncBtn").onclick=()=>syncNow(false);
$("newTripBtn").onclick=()=>{$("tripDialog").showModal()};
$("saveTripBtn").onclick=e=>{e.preventDefault();createTrip()};
$("finishTripBtn").onclick=finishTrip;
$("startGpsBtn").onclick=startTracking;$("stopGpsBtn").onclick=stopTracking;
$("tripSelector").onchange=e=>{selectedTripId=e.target.value||null;refresh()};
$("addPlaceBtn").onclick=()=>{if(!currentActiveTripOrWarn())return;$("placeDate").value=today();$("placeTime").value=nowTime();placeLocation=null;$("placeLocationText").textContent="Sem localização";$("placeDialog").showModal()};
$("addPlaceFromGpsBtn").onclick=async()=>{if(!currentActiveTripOrWarn())return;$("addPlaceBtn").click();try{placeLocation=await capturePosition();$("placeLocationText").textContent=`${placeLocation.lat.toFixed(5)}, ${placeLocation.lon.toFixed(5)}`}catch(e){toast(e.message)}};
$("capturePlaceLocation").onclick=async()=>{try{placeLocation=await capturePosition();$("placeLocationText").textContent=`${placeLocation.lat.toFixed(5)}, ${placeLocation.lon.toFixed(5)} • ±${Math.round(placeLocation.accuracy)}m`}catch(e){toast(e.message)}};
$("savePlaceBtn").onclick=e=>{e.preventDefault();savePlace()};
$("addExpenseBtn").onclick=async()=>{const t=currentActiveTripOrWarn();if(!t)return;$("expenseForm").reset();$("expenseCategory").value="combustivel";$("expenseDate").value=today();$("fuelFields").style.display="block";resetReceiptReader();const d=calcDistance(gpsPoints);$("fuelEstimatedKm").textContent=t.startKm?`${num(Number(t.startKm)+d,1)} km`:"KM inicial não informado";$("expenseDialog").showModal()};
$("expenseCategory").onchange=e=>{$("fuelFields").style.display=e.target.value==="combustivel"?"block":"none"};
$("receiptPhoto").onchange=e=>{
  const file=e.target.files[0];
  showReceiptPreview(file);
  if(file&&$("expenseCategory").value==="combustivel")runOCR(file);
};
$("readReceiptBtn").onclick=()=>runOCR($("receiptPhoto").files[0]);
$("saveExpenseBtn").onclick=e=>{e.preventDefault();saveExpense()};
$("expenseFilter").onchange=()=>refresh(false);
$("exportJsonBtn").onclick=exportJSON;$("exportCsvBtn").onclick=exportCSV;$("importJsonInput").onchange=e=>e.target.files[0]&&importJSON(e.target.files[0]);$("pdfBtn").onclick=generatePDF;
$("fitMapBtn").onclick=()=>refresh(true);
$("closePhotoViewer").onclick=()=>{$("photoViewer").classList.add("hidden");$("photoViewerImg").src=""};
$("photoViewer").onclick=e=>{if(e.target.id==="photoViewer")$("closePhotoViewer").click()};
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>setView(b.dataset.view));

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installBtn").classList.remove("hidden")});
$("installBtn").onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("installBtn").classList.add("hidden")};
window.addEventListener("online",async()=>{await health();syncNow(true)});window.addEventListener("offline",()=>setSyncBadge("offline"));

(async()=>{
  await openDB();await health();await refresh();
  if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
  if(serverReady && (!pinRequired || pin())) syncNow(true);
})();
