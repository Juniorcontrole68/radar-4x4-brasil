package br.com.movit.rotas;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.*;
import android.speech.RecognizerIntent;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.net.URLEncoder;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private static final int REQ_VOICE=10,REQ_LOC=11;
    private final ArrayList<JSONObject> stops=new ArrayList<>();
    private final ExecutorService exec=Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private EditText address;
    private TextView status,summary;
    private WebView map;
    private JSONObject start=null,lastPlan=null;
    private android.content.SharedPreferences prefs;
    private TextView account;
    private Button cloudSave,cloudRoutes;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);prefs=getSharedPreferences("rv2_account",MODE_PRIVATE);buildUi();renderList();renderMap(null);refreshAccount();
    }

    private void buildUi(){
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(18,20,18,18);
        TextView title=new TextView(this);title.setText("MOVIT");title.setTextSize(26);title.setTextColor(Color.rgb(22,20,47));title.setTypeface(null,1);
        TextView sub=new TextView(this);sub.setText("Autonomia, Renda e Movimento");sub.setTextSize(14);sub.setTextColor(Color.rgb(90,205,61));sub.setTypeface(null,1);sub.setPadding(0,2,0,4);
        TextView sub2=new TextView(this);sub2.setText("Crie sua rota digitando ou falando os endereços.");sub2.setTextSize(13);sub2.setPadding(0,0,0,12);

        LinearLayout accountRow=new LinearLayout(this);accountRow.setOrientation(LinearLayout.HORIZONTAL);
        account=new TextView(this);account.setText("Modo visitante");account.setTextSize(13);account.setPadding(0,8,8,8);
        Button login=new Button(this);login.setText("Conta");login.setOnClickListener(v->accountDialog());
        cloudSave=new Button(this);cloudSave.setText("☁ Salvar");cloudSave.setOnClickListener(v->saveCloud());
        cloudRoutes=new Button(this);cloudRoutes.setText("Minhas rotas");cloudRoutes.setOnClickListener(v->loadCloudRoutes());
        accountRow.addView(account,new LinearLayout.LayoutParams(0,-2,1));accountRow.addView(login);accountRow.addView(cloudSave);accountRow.addView(cloudRoutes);

        address=new EditText(this);address.setHint("Rua, número, bairro, cidade ou CEP");address.setSingleLine(true);address.setTextSize(16);

        LinearLayout addRow=new LinearLayout(this);addRow.setOrientation(LinearLayout.HORIZONTAL);
        Button voice=new Button(this);voice.setText("🎙️ Falar");voice.setOnClickListener(v->voice());
        Button loc=new Button(this);loc.setText("📍 Início");loc.setOnClickListener(v->useLocation());
        Button add=new Button(this);add.setText("+ Parada");add.setOnClickListener(v->addAddress(address.getText().toString()));
        addRow.addView(voice,new LinearLayout.LayoutParams(0,-2,1));addRow.addView(loc,new LinearLayout.LayoutParams(0,-2,1));addRow.addView(add,new LinearLayout.LayoutParams(0,-2,1));

        status=new TextView(this);status.setText("Adicione pelo menos duas paradas.");status.setTextSize(14);status.setPadding(0,10,0,8);
        summary=new TextView(this);summary.setText("0 paradas");summary.setTypeface(null,1);summary.setPadding(0,0,0,8);

        map=new WebView(this);map.getSettings().setJavaScriptEnabled(true);map.setBackgroundColor(Color.WHITE);
        root.addView(title);root.addView(sub);root.addView(sub2);root.addView(accountRow);root.addView(address);root.addView(addRow);root.addView(status);root.addView(summary);
        root.addView(map,new LinearLayout.LayoutParams(-1,360));

        LinearLayout actions=new LinearLayout(this);actions.setOrientation(LinearLayout.HORIZONTAL);
        Button optimize=new Button(this);optimize.setText("Otimizar");optimize.setOnClickListener(v->optimize());
        Button navigate=new Button(this);navigate.setText("Navegar");navigate.setOnClickListener(v->navigateFirst());
        Button clear=new Button(this);clear.setText("Limpar");clear.setOnClickListener(v->{stops.clear();lastPlan=null;renderList();renderMap(null);});
        actions.addView(optimize,new LinearLayout.LayoutParams(0,-2,1));actions.addView(navigate,new LinearLayout.LayoutParams(0,-2,1));actions.addView(clear,new LinearLayout.LayoutParams(0,-2,1));
        root.addView(actions);

        ScrollView sv=new ScrollView(this);list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);sv.addView(list);
        root.addView(sv,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(root);
    }

    private void voice(){
        Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"pt-BR");
        i.putExtra(RecognizerIntent.EXTRA_PROMPT,"Fale o endereço completo");
        try{startActivityForResult(i,REQ_VOICE);}catch(Exception e){status.setText("Reconhecimento de voz indisponível.");}
    }

    @Override protected void onActivityResult(int req,int res,Intent data){
        super.onActivityResult(req,res,data);
        if(req==REQ_VOICE&&res==RESULT_OK&&data!=null){
            ArrayList<String> out=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if(out!=null&&!out.isEmpty()){address.setText(out.get(0));status.setText("Endereço reconhecido. Toque em + Parada.");}
        }
    }

    private void useLocation(){
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_LOC);return;
        }
        try{
            LocationManager lm=(LocationManager)getSystemService(LOCATION_SERVICE);
            Location l=lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if(l==null)l=lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if(l==null){status.setText("Ainda não há posição disponível. Abra o GPS e tente novamente.");return;}
            start=new JSONObject();start.put("lat",l.getLatitude());start.put("lon",l.getLongitude());start.put("label","Minha localização");
            status.setText("Ponto de início definido pela sua localização.");
        }catch(Exception e){status.setText("Não foi possível usar sua localização.");}
    }

    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==REQ_LOC&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)useLocation();
    }

    private void addAddress(String raw){
        raw=raw.trim();if(raw.length()<5){status.setText("Informe um endereço mais completo.");return;}
        final String q=raw;status.setText("Localizando endereço…");
        exec.execute(()->{
            try{
                JSONObject j=Api.get("/api/public-router/geocode?q="+URLEncoder.encode(q,"UTF-8"));
                JSONArray rows=j.optJSONArray("rows");if(rows==null||rows.length()==0)throw new Exception("Endereço não encontrado.");
                JSONObject p=rows.getJSONObject(0);JSONObject s=new JSONObject();
                s.put("lat",p.getDouble("lat"));s.put("lon",p.getDouble("lon"));s.put("label",q);s.put("resolved",p.optString("label",q));
                stops.add(s);
                runOnUiThread(()->{address.setText("");status.setText("Parada adicionada.");renderList();renderMap(null);});
            }catch(Exception e){runOnUiThread(()->status.setText("Erro: "+e.getMessage()));}
        });
    }

    private void optimize(){
        if(stops.size()<2){status.setText("Adicione pelo menos duas paradas.");return;}
        status.setText("Otimizando pelas vias reais…");
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();JSONArray arr=new JSONArray();
                for(JSONObject s:stops)arr.put(new JSONObject(s.toString()));
                body.put("stops",arr);if(start!=null)body.put("start",start);
                JSONObject j=Api.post("/api/public-router/optimize",body);lastPlan=j;
                JSONArray order=j.getJSONArray("order");ArrayList<JSONObject> ordered=new ArrayList<>();
                JSONArray points=j.getJSONArray("points");
                for(int i=0;i<order.length();i++)ordered.add(points.getJSONObject(order.getInt(i)));
                stops.clear();stops.addAll(ordered);
                runOnUiThread(()->{status.setText("Rota otimizada.");summary.setText(stops.size()+" paradas • "+fmtKm(j.optDouble("distanceMeters",0))+" • "+fmtTime(j.optDouble("durationSeconds",0)));renderList();renderMap(j);});
            }catch(Exception e){runOnUiThread(()->status.setText("Erro: "+e.getMessage()));}
        });
    }

    private String fmtKm(double m){return String.format(Locale.forLanguageTag("pt-BR"),"%.1f km",m/1000d);}
    private String fmtTime(double sec){long min=Math.round(sec/60d);return min>=60?(min/60+"h "+min%60+"min"):(min+" min");}

    private void renderList(){
        list.removeAllViews();summary.setText(stops.size()+" paradas");
        for(int i=0;i<stops.size();i++){
            final int idx=i;JSONObject s=stops.get(i);
            LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setPadding(4,10,4,10);
            TextView t=new TextView(this);t.setText((i+1)+". "+s.optString("label","Parada"));t.setTextSize(15);
            Button up=new Button(this);up.setText("↑");up.setOnClickListener(v->{if(idx>0){Collections.swap(stops,idx,idx-1);lastPlan=null;renderList();}});
            Button del=new Button(this);del.setText("✕");del.setOnClickListener(v->{stops.remove(idx);lastPlan=null;renderList();renderMap(null);});
            row.addView(t,new LinearLayout.LayoutParams(0,-2,1));row.addView(up);row.addView(del);list.addView(row);
        }
    }

    private void navigateFirst(){
        if(stops.isEmpty()){status.setText("Nenhuma parada.");return;}
        JSONObject s=stops.get(0);String d=s.optDouble("lat")+","+s.optDouble("lon");
        Intent i=new Intent(Intent.ACTION_VIEW,Uri.parse("google.navigation:q="+Uri.encode(d)+"&mode=d"));
        i.setPackage("com.google.android.apps.maps");
        try{startActivity(i);}catch(Exception e){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://www.google.com/maps/dir/?api=1&destination="+Uri.encode(d)+"&travelmode=driving")));}
    }

    private void renderMap(JSONObject plan){
        String points="[]",geometry="null";
        try{
            JSONArray a=new JSONArray();
            for(JSONObject s:stops){JSONArray p=new JSONArray();p.put(s.getDouble("lat"));p.put(s.getDouble("lon"));a.put(p);}
            points=a.toString();
            if(plan!=null&&plan.optJSONObject("geometry")!=null)geometry=plan.getJSONObject("geometry").toString();
        }catch(Exception ignored){}
        String html="<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"+
        "<link rel='stylesheet' href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'><style>html,body,#m{height:100%;margin:0}</style></head><body><div id='m'></div>"+
        "<script src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'></script><script>var m=L.map('m').setView([-22.8,-47.2],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);"+
        "var pts="+points+";pts.forEach((p,i)=>L.marker(p).addTo(m).bindTooltip(String(i+1)));var g="+geometry+";if(g&&g.coordinates){var ll=g.coordinates.map(x=>[x[1],x[0]]);L.polyline(ll,{weight:5}).addTo(m);if(ll.length)m.fitBounds(ll,{padding:[20,20]});}else if(pts.length)m.fitBounds(pts,{padding:[30,30]});</script></body></html>";
        map.loadDataWithBaseURL("https://app.local/",html,"text/html","UTF-8",null);
    }

    private String token(){return prefs.getString("token","");}
    private String userName(){return prefs.getString("name","");}
    private String userPlan(){return prefs.getString("plan","free");}

    private void refreshAccount(){
        String t=token();
        if(t.isEmpty()){
            account.setText("Modo visitante • entre para salvar na nuvem");
            cloudSave.setEnabled(false);cloudRoutes.setEnabled(false);return;
        }
        account.setText(userName()+" • plano "+userPlan());
        cloudSave.setEnabled(true);cloudRoutes.setEnabled(true);
        exec.execute(()->{
            try{
                JSONObject j=Api.getAuth("/api/router-app/me",t),u=j.getJSONObject("user");
                prefs.edit().putString("name",u.optString("name",userName())).putString("plan",u.optString("plan","free")).apply();
                int usage=u.optInt("usage",0);JSONObject lim=u.optJSONObject("limits");int max=lim==null?0:lim.optInt("routesPerMonth",0);
                runOnUiThread(()->account.setText(userName()+" • "+userPlan()+" • "+usage+"/"+max+" rotas/mês"));
            }catch(Exception e){
                if(String.valueOf(e.getMessage()).toLowerCase().contains("sessão")){
                    prefs.edit().clear().apply();runOnUiThread(this::refreshAccount);
                }
            }
        });
    }

    private void accountDialog(){
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(30,12,30,0);
        EditText name=new EditText(this);name.setHint("Nome (para criar conta)");
        EditText email=new EditText(this);email.setHint("E-mail");email.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText pass=new EditText(this);pass.setHint("Senha");pass.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(name);box.addView(email);box.addView(pass);
        AlertDialog d=new AlertDialog.Builder(this).setTitle(token().isEmpty()?"Entrar ou criar conta":"Minha conta").setView(box)
            .setNegativeButton("Cancelar",null)
            .setNeutralButton(token().isEmpty()?"Criar conta":"Sair",null)
            .setPositiveButton(token().isEmpty()?"Entrar":"OK",null).create();
        d.setOnShowListener(x->{
            if(token().isEmpty()){
                d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->auth(email.getText().toString(),pass.getText().toString(),"",false,d));
                d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->auth(email.getText().toString(),pass.getText().toString(),name.getText().toString(),true,d));
            }else{
                name.setVisibility(View.GONE);email.setVisibility(View.GONE);pass.setVisibility(View.GONE);
                TextView info=new TextView(this);info.setText("Logado como "+userName()+"\nPlano: "+userPlan());info.setPadding(8,18,8,18);box.addView(info);
                d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{prefs.edit().clear().apply();d.dismiss();refreshAccount();});
            }
        });
        d.show();
    }

    private void auth(String email,String password,String name,boolean register,AlertDialog dialog){
        email=email.trim().toLowerCase();name=name.trim();
        if(email.isEmpty()||password.length()<6){status.setText("Informe e-mail e senha com pelo menos 6 caracteres.");return;}
        status.setText(register?"Criando conta…":"Entrando…");
        final String e=email,p=password,n=name;
        exec.execute(()->{
            try{
                JSONObject b=new JSONObject();b.put("email",e);b.put("password",p);if(register)b.put("name",n);
                JSONObject j=Api.post(register?"/api/router-app/register":"/api/router-app/login",b);
                JSONObject u=j.getJSONObject("user");
                prefs.edit().putString("token",j.getString("token")).putString("name",u.optString("name","Usuário")).putString("plan",u.optString("plan","free")).apply();
                runOnUiThread(()->{dialog.dismiss();status.setText(register?"Conta criada. Suas rotas agora podem ser salvas na nuvem.":"Login realizado.");refreshAccount();});
            }catch(Exception ex){runOnUiThread(()->status.setText("Conta: "+ex.getMessage()));}
        });
    }

    private JSONObject currentRouteData()throws Exception{
        JSONObject data=new JSONObject();JSONArray arr=new JSONArray();
        for(JSONObject s:stops)arr.put(new JSONObject(s.toString()));
        data.put("stops",arr);if(start!=null)data.put("start",new JSONObject(start.toString()));
        if(lastPlan!=null){
            data.put("distanceMeters",lastPlan.optDouble("distanceMeters",0));
            data.put("durationSeconds",lastPlan.optDouble("durationSeconds",0));
        }
        return data;
    }

    private void saveCloud(){
        if(token().isEmpty()){accountDialog();return;}
        if(stops.isEmpty()){status.setText("Adicione uma rota antes de salvar.");return;}
        final EditText input=new EditText(this);input.setHint("Nome da rota");input.setText("Rota "+new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(new Date()));
        new AlertDialog.Builder(this).setTitle("Salvar na nuvem").setView(input).setNegativeButton("Cancelar",null).setPositiveButton("Salvar",(d,w)->{
            final String name=input.getText().toString().trim();
            exec.execute(()->{
                try{
                    JSONObject b=new JSONObject();b.put("name",name.isEmpty()?"Minha rota":name);b.put("route_data",currentRouteData());
                    Api.postAuth("/api/router-app/routes",b,token());
                    runOnUiThread(()->{status.setText("Rota salva na nuvem.");refreshAccount();});
                }catch(Exception e){runOnUiThread(()->status.setText("Salvar: "+e.getMessage()));}
            });
        }).show();
    }

    private void loadCloudRoutes(){
        if(token().isEmpty()){accountDialog();return;}
        status.setText("Carregando suas rotas…");
        exec.execute(()->{
            try{
                JSONObject j=Api.getAuth("/api/router-app/routes",token());JSONArray rows=j.optJSONArray("rows");
                if(rows==null||rows.length()==0){runOnUiThread(()->status.setText("Você ainda não tem rotas salvas na nuvem."));return;}
                final String[] names=new String[rows.length()];final JSONObject[] items=new JSONObject[rows.length()];
                for(int i=0;i<rows.length();i++){items[i]=rows.getJSONObject(i);names[i]=items[i].optString("name","Rota")+" • "+items[i].optString("updated_at","").replace("T"," ").replace("Z","");}
                runOnUiThread(()->new AlertDialog.Builder(this).setTitle("Minhas rotas").setItems(names,(d,which)->openCloudRoute(items[which])).setNegativeButton("Fechar",null).show());
            }catch(Exception e){runOnUiThread(()->status.setText("Rotas: "+e.getMessage()));}
        });
    }

    private void openCloudRoute(JSONObject row){
        try{
            JSONObject data=row.optJSONObject("route_data");if(data==null)return;
            JSONArray arr=data.optJSONArray("stops");stops.clear();
            if(arr!=null)for(int i=0;i<arr.length();i++)stops.add(arr.getJSONObject(i));
            start=data.optJSONObject("start");lastPlan=null;
            status.setText("Rota “"+row.optString("name","") +"” aberta. Toque em Otimizar para atualizar o trajeto.");
            renderList();renderMap(null);
        }catch(Exception e){status.setText("Não foi possível abrir a rota.");}
    }

}
